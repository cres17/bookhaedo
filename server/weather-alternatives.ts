import { Router } from 'express';
import { z } from 'zod';
import { pool } from './db.js';
import { dateOnly, uuid, placeSelect, straightDistance, orderInput } from './domain.js';
import { forecast } from './providers.js';
import { routeSegment } from './routing.js';
import { dedupePlaces } from './place-dedupe.js';
import { adverseWeather, indoorEvidence, isOutdoor } from '../shared/weather-policy.js';
import { requireRevision } from './itinerary-version.js';

export const alternatives = Router({ mergeParams: true });
const wrap = (fn: any) => (req: any, res: any, next: any) =>
  Promise.resolve(fn(req, res)).catch(next);
const itemsSQL = `SELECT ${placeSelect} FROM geo_data.place WHERE id IN (SELECT place_id FROM planner.itinerary_item WHERE day_id=$1) ORDER BY (SELECT position FROM planner.itinerary_item WHERE day_id=$1 AND place_id=geo_data.place.id)`;
async function context(tripId: string, date: string) {
  const day = await pool.query(
    'SELECT id,revision FROM planner.trip_day WHERE trip_id=$1 AND visit_date=$2',
    [tripId, date],
  );
  if (!day.rowCount) return null;
  return {
    items: (await pool.query(itemsSQL, [day.rows[0].id])).rows,
    revision: day.rows[0].revision,
  };
}
export function rankAlternatives(places: any[], items: any[], target: any) {
  const index = items.findIndex((p) => p.id === target.id),
    before = items[index - 1],
    after = items[index + 1];
  const length = (p: any) =>
    (before ? straightDistance(before, p) : 0) + (after ? straightDistance(p, after) : 0);
  return dedupePlaces(places)
    .filter(
      (p) =>
        indoorEvidence(p) &&
        !items.some(
          (i) => i.id === p.id || (straightDistance(i, p) < 100 && i.nameJa === p.nameJa),
        ) &&
        straightDistance(target, p) <= 20000,
    )
    .map((p) => ({
      ...p,
      indoorEvidence: indoorEvidence(p),
      distanceMeters: straightDistance(target, p),
      detourMeters: length(p) - length(target),
      operationNotice: '운영시간·실내 이용 범위는 방문 전 확인해주세요.',
    }))
    .sort(
      (a, b) =>
        a.detourMeters - b.detourMeters ||
        a.distanceMeters - b.distanceMeters ||
        a.id.localeCompare(b.id),
    )
    .slice(0, 3);
}
async function legs(items: any[], index: number, p: any, mode: string, date: string) {
  const pairs: any[] = [];
  if (items[index - 1]) pairs.push([items[index - 1], p]);
  if (items[index + 1]) pairs.push([p, items[index + 1]]);
  const segments = await Promise.all(
    pairs.map(([a, b]) =>
      routeSegment(a, b, mode, fetch, new Date(date + 'T09:00:00+09:00').toISOString()),
    ),
  );
  const complete = segments.every(
    (s) => s.source !== 'straight-line' && s.durationSeconds !== null && s.distanceMeters !== null,
  );
  return {
    segments,
    complete,
    distanceMeters: complete ? segments.reduce((n, s) => n + (s.distanceMeters || 0), 0) : null,
    durationSeconds: complete ? segments.reduce((n, s) => n + (s.durationSeconds || 0), 0) : null,
  };
}
alternatives.get(
  '/',
  wrap(async (req: any, res: any) => {
    res.set('Cache-Control', 'no-store');
    const date = dateOnly.parse(req.params.date),
      query = z.object({ targetId: uuid, previewId: uuid.optional() }).parse(req.query);
    const state = await context(req.params.id, date);
    if (!state) return res.status(404).json({ error: '여행 날짜를 찾을 수 없어요.' });
    const { items } = state;
    const target = items.find((p) => p.id === query.targetId);
    if (!target) return res.status(404).json({ error: '현재 일정의 장소를 선택해주세요.' });
    const weather = await forecast(target.latitude, target.longitude, date);
    const base = {
      tripId: req.params.id,
      date,
      expectedRevision: state.revision,
      weather,
      target,
      expectedPlaceIds: items.map((p) => p.id),
      data: [],
      preview: null,
    };
    if (!weather.available)
      return res.json({ ...base, status: 'NO_FORECAST', notice: weather.notice });
    if (!adverseWeather(weather))
      return res.json({
        ...base,
        status: 'FAIR_WEATHER',
        notice:
          '현재 예보는 대안 추천 기준에 해당하지 않아요. 기존 일정을 유지해도 됩니다. 안전을 보장하는 판단은 아니에요.',
      });
    if (!isOutdoor(target))
      return res.json({
        ...base,
        status: 'NOT_OUTDOOR',
        notice: '야외 장소로 확인된 일정에서 대안을 찾을 수 있어요.',
      });
    const q = await pool.query(
      `SELECT ${placeSelect} FROM geo_data.place WHERE ST_DWithin(location,ST_SetSRID(ST_MakePoint($1,$2),4326)::geography,20000) AND (osm_tags->>'indoor'='yes' OR osm_tags->>'tourism' IN ('museum','gallery','aquarium'))`,
      [target.longitude, target.latitude],
    );
    const data = rankAlternatives(q.rows, items, target);
    let preview: any = null;
    if (query.previewId) {
      const candidate = data.find((p) => p.id === query.previewId);
      if (!candidate)
        return res.status(409).json({ error: '추천 후보가 변경됐어요. 다시 선택해주세요.' });
      const index = items.findIndex((p) => p.id === target.id);
      const [before, after] = await Promise.all([
        legs(items, index, target, res.locals.trip.transportMode, date),
        legs(items, index, candidate, res.locals.trip.transportMode, date),
      ]);
      preview = {
        candidate,
        before,
        after,
        durationDeltaSeconds:
          before.complete && after.complete
            ? after.durationSeconds! - before.durationSeconds!
            : null,
      };
    }
    res.set('Cache-Control', 'no-store').json({
      ...base,
      status: data.length ? 'READY' : 'NO_CANDIDATES',
      data,
      preview,
      notice:
        '직선 20km 이내 실내 분류 후보입니다. 앞뒤 장소와의 직선 동선 변화로 정렬하며 실제 경로는 미리보기에서 확인합니다. 예보는 여행일 전체 기준으로, 이동 안전·휴업 여부를 보장하지 않습니다.',
    });
  }),
);
alternatives.patch(
  '/',
  wrap(async (req: any, res: any) => {
    const date = dateOnly.parse(req.params.date),
      input = orderInput.extend({ targetId: uuid, replacementId: uuid }).parse(req.body),
      db = await pool.connect();
    try {
      await db.query('BEGIN');
      const day = await db.query(
        'SELECT id,revision FROM planner.trip_day WHERE trip_id=$1 AND visit_date=$2 FOR UPDATE',
        [req.params.id, date],
      );
      if (!day.rowCount) {
        await db.query('ROLLBACK');
        return res.status(404).json({ error: '여행 날짜를 찾을 수 없어요.' });
      }
      if (!requireRevision(req.body, day.rows[0].revision, res)) {
        await db.query('ROLLBACK');
        return;
      }
      const rows = await db.query(
        'SELECT place_id FROM planner.itinerary_item WHERE day_id=$1 ORDER BY position',
        [day.rows[0].id],
      );
      if (
        JSON.stringify(rows.rows.map((p) => p.place_id)) !== JSON.stringify(input.placeIds) ||
        !input.placeIds.includes(input.targetId) ||
        input.placeIds.includes(input.replacementId)
      ) {
        await db.query('ROLLBACK');
        return res
          .status(409)
          .json({ error: '일정이 변경됐거나 이미 포함된 장소예요. 일정을 새로 확인해주세요.' });
      }
      const places = await db.query(
        `SELECT ${placeSelect} FROM geo_data.place WHERE id=ANY($1::text[])`,
        [[input.targetId, input.replacementId]],
      );
      const target = places.rows.find((p) => p.id === input.targetId),
        replacement = places.rows.find((p) => p.id === input.replacementId);
      if (
        !target ||
        !replacement ||
        !isOutdoor(target) ||
        !indoorEvidence(replacement) ||
        straightDistance(target, replacement) > 20000
      ) {
        await db.query('ROLLBACK');
        return res.status(400).json({ error: '주변 실내 대체 장소를 선택해주세요.' });
      }
      await db.query(
        "UPDATE planner.itinerary_item SET place_id=$1,note='',estimated_cost=NULL WHERE day_id=$2 AND place_id=$3",
        [input.replacementId, day.rows[0].id, input.targetId],
      );
      await db.query('UPDATE planner.trip_day SET revision=revision+1 WHERE id=$1', [
        day.rows[0].id,
      ]);
      await db.query('UPDATE planner.trip SET updated_at=now() WHERE id=$1', [req.params.id]);
      await db.query('COMMIT');
      res.json({ saved: true, revision: day.rows[0].revision + 1 });
    } catch (e: any) {
      await db.query('ROLLBACK');
      if (e.code === '23505')
        return res.status(409).json({ error: '이미 일정에 포함된 장소예요.' });
      throw e;
    } finally {
      db.release();
    }
  }),
);
