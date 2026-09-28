import { z } from 'zod';
import { pool } from '../db.js';
import { dateOnly, placeSelect, regions, uuid } from '../domain.js';
import { forecast } from '../providers.js';
import { addTrendBadges, getTrend } from '../trend-store.js';

import { dedupePlaces, dedupedPlaceCte } from '../place-dedupe.js';
import { photoUrl, placeDetails } from '../place-details.js';
import { parsePlaceSearch } from '../place-search.js';
import { recommend, themes } from '../recommendations.js';
import { reviewRecommendations } from '../review-recommendations.js';
import { searchAssist } from '../search-assist.js';
import { checkedWebsite } from '../website-check.js';

import { Router } from 'express';
import { requireAuth } from '../auth/session.js';
import { wrap } from '../http/async-handler.js';
import { rateLimits } from '../http/rate-limit.js';
const app = Router();
app.get(
  '/api/regions',
  wrap(async (_req, res) => {
    const q = await pool.query(
      'SELECT region_id,count(*)::int AS count FROM geo_data.place GROUP BY region_id',
    );
    res.json({
      data: regions.map((r) => ({
        ...r,
        count: q.rows.find((x) => x.region_id === r.id)?.count || 0,
      })),
    });
  }),
);
app.get(
  '/api/places',
  wrap(async (req, res) => {
    const input = z
      .object({
        q: z.string().max(100).optional(),
        regionId: z.string().optional(),
        category: z.enum(['ATTRACTION', 'RESTAURANT', 'LODGING']).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(40),
        offset: z.coerce.number().int().min(0).max(20000).default(0),
      })
      .parse(req.query);
    const terms: string[] = [],
      args: any[] = [];
    const add = (sql: string, value: any) => {
      args.push(value);
      terms.push(sql.replace('?', `$${args.length}`));
    };
    if (input.regionId && !regions.some((r) => r.id === input.regionId))
      return res.status(400).json({ error: '지역을 확인해주세요.' });
    const parsed = parsePlaceSearch(input.q || '', input.regionId);
    if (parsed.regionIds.length) add('region_id=ANY(?::text[])', parsed.regionIds);
    if (parsed.kinds.length) terms.push('(' + parsed.kinds.map((k) => k.sql).join(' OR ') + ')');
    if (input.category) add('category=?', input.category);
    if (parsed.text) {
      args.push('%' + parsed.text.replace(/[\\%_]/g, '\\$&') + '%');
      const k = `$${args.length}`;
      terms.push(
        `(name_ja ILIKE ${k} OR name_ko ILIKE ${k} OR name_en ILIKE ${k} OR municipality_name ILIKE ${k})`,
      );
    }
    const where = terms.length ? ' WHERE ' + terms.join(' AND ') : '';
    const cte = dedupedPlaceCte(where);
    const count = await pool.query(
      cte + ' SELECT count(*)::int AS count FROM ranked WHERE duplicate_rank=1',
      args,
    );
    args.push(input.limit, input.offset);
    const q = await pool.query(
      `${cte} SELECT ${placeSelect} FROM ranked WHERE duplicate_rank=1 ORDER BY (name_ko IS NOT NULL) DESC,(osm_tags ? 'wikidata') DESC,(website IS NOT NULL) DESC,name_ja,id LIMIT $${args.length - 1} OFFSET $${args.length}`,
      args,
    );
    res.json({
      data: await addTrendBadges(q.rows),
      count: count.rows[0].count,
      limit: input.limit,
      offset: input.offset,
      filters: {
        regions: parsed.regionIds,
        types: parsed.kinds.map((k) => k.label),
        keyword: parsed.text,
      },
      notice: parsed.kinds.length
        ? '장소 분류·음식 종류 태그를 기준으로 검색합니다. 분류 정보가 없는 장소는 결과에서 빠질 수 있습니다.'
        : '',
    });
  }),
);
const discoveryLimit = rateLimits.discovery();
app.get(
  '/api/places/search-assist',
  requireAuth,
  discoveryLimit,
  wrap(async (req, res) => {
    const input = z
      .object({ q: z.string().trim().min(2).max(100), regionId: z.string().optional() })
      .parse(req.query);
    if (input.regionId && !regions.some((r) => r.id === input.regionId))
      return res.status(400).json({ error: '지역을 확인해주세요.' });
    res.json(await searchAssist(input.q, input.regionId));
  }),
);
app.get(
  '/api/discover',
  requireAuth,
  discoveryLimit,
  wrap(async (req, res) => {
    const i = z
      .object({
        theme: z.enum(themes),
        regionId: z.string().optional(),
        category: z.enum(['ATTRACTION', 'RESTAURANT', 'LODGING']).optional(),
        q: z.string().max(100).optional(),
        date: dateOnly,
        tripId: uuid.optional(),
        latitude: z.coerce.number().min(41).max(46.1).optional(),
        longitude: z.coerce.number().min(137).max(147).optional(),
        limit: z.coerce.number().int().min(1).max(40).default(20),
      })
      .parse(req.query);
    if (i.regionId && !regions.some((r) => r.id === i.regionId))
      return res.status(400).json({ error: '지역을 확인해주세요.' });
    let anchor: any,
      exclude: string[] = [];
    const notices: string[] = [];
    if (i.tripId) {
      const owner = await pool.query(
        'SELECT id FROM planner.trip WHERE id=$1 AND (user_id=$2 OR EXISTS(SELECT 1 FROM planner.trip_member m WHERE m.trip_id=planner.trip.id AND m.user_id=$2))',
        [i.tripId, res.locals.user.id],
      );
      if (!owner.rowCount)
        return res.status(404).json({ error: '추천에 사용할 여행을 찾을 수 없어요.' });
      const saved = await pool.query(
        'SELECT p.id,p.latitude,p.longitude FROM planner.itinerary_item i JOIN planner.trip_day d ON d.id=i.day_id JOIN geo_data.place p ON p.id=i.place_id WHERE d.trip_id=$1 AND d.visit_date=$2 ORDER BY i.position',
        [i.tripId, i.date],
      );
      exclude = saved.rows.map((p) => p.id);
    }
    if (i.theme === 'nearby' && i.latitude !== undefined && i.longitude !== undefined)
      anchor = { latitude: i.latitude, longitude: i.longitude };
    if (i.theme === 'nearby' && !anchor)
      return res.json({
        data: [],
        count: 0,
        notice: '위치 권한을 허용하면 주변 후보를 찾을 수 있어요.',
      });
    const parsed = parsePlaceSearch(i.q || '', i.regionId);
    const args: any[] = [],
      conditions: string[] = [];
    if (parsed.regionIds.length) {
      args.push(parsed.regionIds);
      conditions.push('region_id=ANY($' + args.length + '::text[])');
    }
    if (parsed.kinds.length)
      conditions.push('(' + parsed.kinds.map((k) => k.sql).join(' OR ') + ')');
    if (i.category) {
      args.push(i.category);
      conditions.push('category=$' + args.length);
    }
    const q = await pool.query(
      `SELECT ${placeSelect} FROM geo_data.place ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''} ORDER BY id`,
      args,
    );
    const r = regions.find((r) => r.id === (parsed.regionIds[0] || i.regionId)),
      weather =
        i.theme === 'weather' && r ? await forecast(r.latitude, r.longitude, i.date) : undefined;
    if (i.theme === 'weather' && !r)
      notices.push('날씨 기반 추천은 도시를 선택하면 예보를 반영해요.');
    const candidates = dedupePlaces(q.rows).filter(
      (p) =>
        !parsed.text ||
        [p.name, p.nameJa, p.nameEn, p.municipality].some((v) =>
          v?.toLowerCase().includes(parsed.text),
        ),
    );
    const ranked = recommend(candidates, {
      theme: i.theme,
      date: i.date,
      anchor,
      exclude,
      weather,
    });
    if (i.theme === 'japanese') {
      const result = await reviewRecommendations(ranked as any[], (p, signal) =>
        placeDetails(p as any, fetch, { signal, reviewOnly: true }),
      );
      return res.json({
        ...result,
        data: result.data.slice(0, i.limit),
        count: result.data.length,
        filters: {
          regions: parsed.regionIds,
          types: parsed.kinds.map((k) => k.label),
          keyword: parsed.text,
        },
      });
    }
    res.set('Cache-Control', 'no-store').json({
      data: ranked.slice(0, i.limit),
      count: ranked.length,
      filters: {
        regions: parsed.regionIds,
        types: parsed.kinds.map((k) => k.label),
        keyword: parsed.text,
      },
      weather,
      notice: notices.join(' '),
    });
  }),
);
app.get(
  '/api/places/:id/trend',
  wrap(async (req, res) => {
    const id = uuid.parse(req.params.id);
    if (!(await pool.query('SELECT id FROM geo_data.place WHERE id=$1', [id])).rowCount)
      return res.status(404).json({ error: '장소를 찾을 수 없습니다.' });
    res.json(await getTrend(id));
  }),
);
app.get(
  '/api/places/:id',
  wrap(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const q = await pool.query(`SELECT ${placeSelect} FROM geo_data.place WHERE id=$1`, [id]);
    if (!q.rowCount) return res.status(404).json({ error: '장소를 찾을 수 없습니다.' });
    const sources = await pool.query(
      'SELECT source_code AS source,source_url AS url,license FROM geo_data.place_source WHERE place_id=$1',
      [id],
    );
    res.json({
      data: {
        ...q.rows[0],
        website: await checkedWebsite(q.rows[0].website),
        sources: sources.rows,
        operatingPeriod: null,
        seasonNotice: '계절별 운영기간은 방문 전 공식 웹사이트에서 확인해주세요.',
      },
    });
  }),
);
const detailLimit = rateLimits.discovery();
app.get(
  '/api/places/:id/enrichment',
  requireAuth,
  detailLimit,
  wrap(async (req, res) => {
    const id = uuid.parse(req.params.id),
      q = await pool.query(`SELECT ${placeSelect} FROM geo_data.place WHERE id=$1`, [id]);
    if (!q.rowCount) return res.status(404).json({ error: '장소를 찾을 수 없습니다.' });
    const detail = await placeDetails(q.rows[0]);
    if (detail.available && detail.googlePlaceId)
      await pool.query(
        'INSERT INTO planner.google_place_link(place_id,google_place_id) VALUES($1,$2) ON CONFLICT(place_id) DO UPDATE SET google_place_id=excluded.google_place_id,matched_at=now()',
        [id, detail.googlePlaceId],
      );
    res.set('Cache-Control', 'no-store').json(detail);
  }),
);
app.get(
  '/api/place-photo',
  requireAuth,
  detailLimit,
  wrap(async (req, res) => {
    try {
      const token = z.string().max(8000).parse(req.query.token);
      res.set('Cache-Control', 'no-store').redirect(await photoUrl(token));
    } catch {
      res.status(404).end();
    }
  }),
);

export { app as catalogRoutes };
