import { rollback, release } from './transactions.js';
import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { pool } from './db.js';
import { dateOnly, orderInput, placeSelect, straightDistance } from './domain.js';
import { forecast } from './providers.js';
import { routeSegment } from './routing.js';
import { mapConcurrent } from './provider-cache.js';
import { dedupePlaces } from './place-dedupe.js';
import { adverseWeather, indoorEvidence, isOutdoor } from '../shared/weather-policy.js';
import { requireRevision } from './itinerary-version.js';
import {
  eligibleRecommendationPlace,
  sameRecommendationFacility,
} from './recommendation-policy.js';
import { summarizeRecommendationRoutes } from './recommendation-preview.js';
import { readQuery } from './read-query.js';
import { recommendationRequestBudget, abortable } from './operation-budget.js';

export const dayAlternatives = Router({ mergeParams: true });
const wrap = (fn: any) => (req: any, res: any, next: any) =>
  Promise.resolve(fn(req, res)).catch(next);
export const dayStrategies = ['AUTO', 'INDOOR', 'NEARBY'] as const;
type Strategy = (typeof dayStrategies)[number];
type Point = { latitude: number; longitude: number };

function quality(p: any) {
  return (
    (p.nameKo ? 4 : 0) +
    (p.website ? 3 : 0) +
    (p.openingHours ? 2 : 0) +
    (p.tags?.wikidata ? 2 : 0) +
    (p.tags?.wikipedia ? 1 : 0)
  );
}
export function center(items: any[]): Point {
  return {
    latitude: items.reduce((n, p) => n + p.latitude, 0) / items.length,
    longitude: items.reduce((n, p) => n + p.longitude, 0) / items.length,
  };
}
export function nearestOrder(places: any[], anchor: Point) {
  const left = [...places],
    ordered: any[] = [];
  let cursor = anchor;
  while (left.length) {
    let best = 0;
    for (let i = 1; i < left.length; i++)
      if (straightDistance(cursor, left[i]) < straightDistance(cursor, left[best])) best = i;
    const [next] = left.splice(best, 1);
    ordered.push(next);
    cursor = next;
  }
  return ordered;
}
function takeVariety(candidates: any[], count: number) {
  const result: any[] = [],
    used = new Set<string>();
  for (const category of ['ATTRACTION', 'RESTAURANT', 'ATTRACTION', 'RESTAURANT']) {
    const found = candidates.find((p) => p.category === category && !used.has(p.id));
    if (found) {
      result.push(found);
      used.add(found.id);
    }
    if (result.length === count) return result;
  }
  for (const p of candidates)
    if (!used.has(p.id)) {
      result.push(p);
      used.add(p.id);
      if (result.length === count) break;
    }
  return result;
}
function label(strategy: Strategy, bad: boolean) {
  if (strategy === 'AUTO') return bad ? '날씨 맞춤 실내 코스' : '날씨 맞춤 균형 코스';
  return strategy === 'INDOOR' ? '실내 중심 코스' : '가까운 곳 중심 코스';
}
export function buildDayPlans(candidates: any[], items: any[], weather: any, count = 4) {
  const anchor = center(items),
    current = new Set(items.map((p) => p.id));
  const usable = dedupePlaces(candidates.filter(eligibleRecommendationPlace)).filter(
    (p) => !current.has(p.id) && !items.some((i) => sameRecommendationFacility(i, p)),
  );
  const byQuality = [...usable].sort(
    (a, b) =>
      quality(b) - quality(a) ||
      straightDistance(anchor, a) - straightDistance(anchor, b) ||
      a.id.localeCompare(b.id),
  );
  const nearby = [...usable].sort(
    (a, b) =>
      straightDistance(anchor, a) - straightDistance(anchor, b) ||
      quality(b) - quality(a) ||
      a.id.localeCompare(b.id),
  );
  const indoor = byQuality.filter(indoorEvidence);
  const bad = adverseWeather(weather);
  const source: Record<Strategy, any[]> = {
    AUTO: bad
      ? indoor
      : byQuality.filter((p) => p.category === 'RESTAURANT' || isOutdoor(p) || indoorEvidence(p)),
    INDOOR: indoor,
    NEARBY: nearby,
  };
  return dayStrategies
    .map((strategy) => {
      const selected = takeVariety(source[strategy], count);
      if (selected.length < 2) return null;
      const places = nearestOrder(selected, anchor);
      const distanceMeters = places.reduce(
        (n, p, i) => (i ? n + straightDistance(places[i - 1], p) : n + straightDistance(anchor, p)),
        0,
      );
      const reason =
        strategy === 'AUTO'
          ? bad
            ? '비·눈·바람 가능성을 반영해 실내 근거가 있는 장소로 구성했어요.'
            : weather?.available
              ? '현재 예보와 장소 종류를 참고해 구성했어요.'
              : '예보 없이 거리와 장소 종류로 구성한 기본 코스예요.'
          : strategy === 'INDOOR'
            ? 'OSM에서 실내 이용 근거가 확인된 장소를 우선했어요.'
            : '현재 일정의 중심에서 가까운 후보부터 묶었어요.';
      return {
        id: strategy,
        label:
          strategy === 'AUTO' && !weather?.available
            ? '예보 미제공 기본 코스'
            : label(strategy, bad),
        reason,
        places,
        distanceMeters,
      };
    })
    .filter(Boolean);
}

export async function dayContext(
  tripId: string,
  date: string,
  lock = false,
  db: any = pool,
  signal?: AbortSignal,
) {
  if (lock)
    await db.query(
      'SELECT id FROM planner.trip_day WHERE trip_id=$1 AND visit_date=$2 FOR UPDATE',
      [tripId, date],
    );
  // One statement snapshot binds the revision, transport mode, and ordered items. Writes additionally lock the day row.
  const sql = `SELECT d.id,d.revision,t.transport_mode AS "transportMode",
    (SELECT COALESCE(jsonb_agg(item ORDER BY item.position),'[]'::jsonb) FROM (
      SELECT p.*,i.note,i.position FROM (SELECT ${placeSelect} FROM geo_data.place) p
      JOIN planner.itinerary_item i ON i.place_id=p.id WHERE i.day_id=d.id
    ) item) AS items
    FROM planner.trip_day d JOIN planner.trip t ON t.id=d.trip_id WHERE d.trip_id=$1 AND d.visit_date=$2${lock ? ' FOR UPDATE OF d' : ''}`;
  const result = signal
    ? await readQuery(sql, [tripId, date], signal, db)
    : await db.query(sql, [tripId, date]);
  const row = result.rows[0];
  return row
    ? { dayId: row.id, revision: row.revision, items: row.items, transportMode: row.transportMode }
    : null;
}
export async function candidatesAround(anchor: Point, db: any = pool, signal?: AbortSignal) {
  const query = (sql: string, values: unknown[]) =>
    signal ? readQuery(sql, values, signal, db) : db.query(sql, values);
  const q = await query(
    `SELECT ${placeSelect} FROM geo_data.place WHERE ST_DWithin(location,ST_SetSRID(ST_MakePoint($1,$2),4326)::geography,20000) AND COALESCE(osm_tags->>'access','') NOT IN ('private','no') AND COALESCE(osm_tags->>'disused','')<>'yes' AND COALESCE(osm_tags->>'abandoned','')<>'yes' AND COALESCE(opening_hours,'')<>'closed' AND COALESCE(osm_tags->>'opening_hours','')<>'closed' ORDER BY location <-> ST_SetSRID(ST_MakePoint($1,$2),4326)::geography,(name_ko IS NOT NULL) DESC,(osm_tags ? 'wikidata') DESC,(website IS NOT NULL) DESC,id LIMIT 600`,
    [anchor.longitude, anchor.latitude],
  );
  return q.rows;
}
async function previewPlan(plan: any, mode: string, date: string, signal?: AbortSignal) {
  const segments = await mapConcurrent<
    Point & { id: string },
    Awaited<ReturnType<typeof routeSegment>>
  >(plan.places.slice(1), 3, (point, index) =>
    routeSegment(
      plan.places[index],
      point,
      mode,
      fetch,
      new Date(date + 'T09:00:00+09:00').toISOString(),
      signal,
    ),
  );
  return { plan, segments, ...summarizeRecommendationRoutes(segments, mode, date) };
}

dayAlternatives.get(
  '/',
  wrap(async (req: any, res: any) => {
    const budget = recommendationRequestBudget(req, res);
    res.set('Cache-Control', 'no-store');
    const date = dateOnly.parse(req.params.date),
      query = z
        .object({
          strategy: z.enum(dayStrategies).optional(),
          count: z.coerce.number().int().min(3).max(6).default(4),
        })
        .parse(req.query);
    const context = await dayContext(req.params.id, date, false, pool, budget.signal);
    if (!context) return res.status(404).json({ error: '여행 날짜를 찾을 수 없어요.' });
    if (!context.items.length)
      return res.json({
        status: 'NEEDS_ANCHOR',
        weather: {
          available: false,
          notice: '첫 장소를 담으면 그 지역을 기준으로 하루 코스를 만들 수 있어요.',
        },
        expectedPlaceIds: [],
        plans: [],
        preview: null,
        notice: '추천 지역을 정할 첫 장소가 필요해요.',
      });
    const anchor = center(context.items),
      weather = await abortable(
        () => forecast(anchor.latitude, anchor.longitude, date, fetch, budget.signal),
        budget.signal,
      ),
      candidates = await candidatesAround(anchor, pool, budget.signal);
    const plans = buildDayPlans(candidates, context.items, weather, query.count);
    let preview = null;
    if (query.strategy) {
      const plan = plans.find((p: any) => p.id === query.strategy);
      if (!plan)
        return res
          .status(409)
          .json({ error: '선택한 코스를 다시 만들 수 없어요. 다른 코스를 확인해주세요.' });
      preview = await abortable(
        () => previewPlan(plan, context.transportMode, date, budget.signal),
        budget.signal,
      );
    }
    res.json({
      tripId: req.params.id,
      date,
      expectedRevision: context.revision,
      transportMode: context.transportMode,
      status: plans.length ? 'READY' : 'NO_CANDIDATES',
      weather,
      weatherMode: adverseWeather(weather) ? 'ADVERSE' : weather.available ? 'FAIR' : 'UNKNOWN',
      expectedPlaceIds: context.items.map((p: any) => p.id),
      plans,
      preview,
      notice:
        '현재 일정 중심에서 직선 20km 이내의 장소를 조합합니다. 실제 운영 여부와 최적 동선을 보장하지 않으며 확정 전까지 일정은 바뀌지 않아요.',
    });
  }),
);

dayAlternatives.patch(
  '/',
  wrap(async (req: any, res: any) => {
    const date = dateOnly.parse(req.params.date),
      input = orderInput
        .extend({
          expectedPlaceIds: z.array(z.string().uuid()).max(30),
          expectedTransportMode: z.enum(['DRIVE', 'TAXI', 'TRANSIT', 'WALK', 'BICYCLE']).optional(),
        })
        .parse(req.body);
    if (input.placeIds.length < 2 || input.placeIds.length > 6)
      return res.status(400).json({ error: '하루 코스는 2곳부터 6곳까지 저장할 수 있어요.' });
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const context = await dayContext(req.params.id, date, true, db);
      if (!context) {
        await rollback(db);
        return res.status(404).json({ error: '여행 날짜를 찾을 수 없어요.' });
      }
      if (!requireRevision(req.body, context.revision, res)) {
        await rollback(db);
        return;
      }
      if (input.expectedTransportMode && input.expectedTransportMode !== context.transportMode) {
        await rollback(db);
        return res.status(409).json({
          code: 'RECOMMENDATION_CONTEXT_CHANGED',
          error: '이동 수단이 변경됐어요. 코스를 다시 확인해주세요.',
        });
      }
      const actual = context.items.map((p: any) => p.id);
      if (JSON.stringify(actual) !== JSON.stringify(input.expectedPlaceIds)) {
        await rollback(db);
        return res
          .status(409)
          .json({ error: '일정이 변경됐어요. 새로운 코스를 다시 확인해주세요.' });
      }
      const places = await db.query(
        `SELECT ${placeSelect} FROM geo_data.place WHERE id=ANY($1::text[])`,
        [input.placeIds],
      );
      if (places.rowCount !== input.placeIds.length) {
        await rollback(db);
        return res.status(400).json({ error: '존재하지 않는 장소가 포함되어 있어요.' });
      }
      if (
        places.rows.some((p) => !eligibleRecommendationPlace(p)) ||
        places.rows.some((p, i) =>
          places.rows.slice(i + 1).some((other) => sameRecommendationFacility(p, other)),
        )
      ) {
        await rollback(db);
        return res.status(400).json({
          code: 'PLACE_INELIGIBLE',
          error: '이용할 수 없거나 같은 시설이 중복된 코스예요. 추천을 다시 확인해주세요.',
        });
      }
      const oldCenter = context.items.length ? center(context.items) : center(places.rows);
      if (places.rows.some((p: any) => straightDistance(oldCenter, p) > 25000)) {
        await rollback(db);
        return res
          .status(400)
          .json({ error: '기존 일정과 너무 멀리 떨어진 장소가 포함되어 있어요.' });
      }
      const notes = new Map(context.items.map((p: any) => [p.id, p.note || '']));
      const budgets = new Map(
        (
          await db.query(
            'SELECT place_id,estimated_cost,start_minute,end_minute FROM planner.itinerary_item WHERE day_id=$1',
            [context.dayId],
          )
        ).rows.map((p) => [p.place_id, p]),
      );
      await db.query('DELETE FROM planner.itinerary_item WHERE day_id=$1', [context.dayId]);
      for (const [position, placeId] of input.placeIds.entries())
        await db.query(
          'INSERT INTO planner.itinerary_item(id,day_id,place_id,position,note,estimated_cost,start_minute,end_minute) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [
            randomUUID(),
            context.dayId,
            placeId,
            position,
            notes.get(placeId) || '',
            budgets.get(placeId)?.estimated_cost ?? null,
            budgets.get(placeId)?.start_minute ?? null,
            budgets.get(placeId)?.end_minute ?? null,
          ],
        );
      await db.query('UPDATE planner.trip_day SET revision=revision+1 WHERE id=$1', [
        context.dayId,
      ]);
      await db.query('UPDATE planner.trip SET updated_at=now() WHERE id=$1', [req.params.id]);
      await db.query('COMMIT');
      res.json({ saved: true, count: input.placeIds.length, revision: context.revision + 1 });
    } catch (e: any) {
      await rollback(db);
      if (e.code === '23505')
        return res.status(409).json({ error: '같은 장소가 중복된 코스예요.' });
      throw e;
    } finally {
      release(db);
    }
  }),
);
