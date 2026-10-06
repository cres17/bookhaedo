import { recommendationRequestBudget } from '../operation-budget.js';
import { replaceDayItems } from '../itinerary-write.js';
import { lockTripForWrite } from '../trip-write.js';
import { tripSnapshot } from '../trip-snapshot.js';
import { operation } from '../observability/metrics.js';
import { rollback, release } from '../transactions.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { collaboration } from '../collaboration.js';
import { costInput } from '../costs.js';
import { pool } from '../db.js';
import { addDate, dateOnly, orderInput, tripInput, uuid } from '../domain.js';

import { requireRevision } from '../itinerary-version.js';
import { nearbyPosition } from '../placement.js';

import { Router } from 'express';
import { wrap } from '../http/async-handler.js';
const app = Router();
app.get(
  '/api/trips',
  wrap(async (_req, res) => {
    const q = await pool.query(
      `SELECT t.id,t.title,(t.user_id=$1) AS "isOwner",t.transport_mode AS "transportMode",min(d.visit_date)::text AS "startDate",max(d.visit_date)::text AS "endDate",count(d.id)::int AS days FROM planner.trip t LEFT JOIN planner.trip_day d ON d.trip_id=t.id WHERE t.user_id=$1 OR EXISTS(SELECT 1 FROM planner.trip_member m WHERE m.trip_id=t.id AND m.user_id=$1) GROUP BY t.id ORDER BY t.updated_at DESC`,
      [res.locals.user.id],
    );
    res.json({ data: q.rows });
  }),
);
app.post(
  '/api/trips',
  wrap(async (req, res) => {
    const input = tripInput.parse(req.body),
      id = randomUUID(),
      db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query(
        'INSERT INTO planner.trip(id,user_id,title,transport_mode) VALUES($1,$2,$3,$4)',
        [id, res.locals.user.id, input.title, input.transportMode],
      );
      for (let i = 0; i < input.days; i++)
        await db.query('INSERT INTO planner.trip_day(id,trip_id,visit_date) VALUES($1,$2,$3)', [
          randomUUID(),
          id,
          addDate(input.startDate, i),
        ]);
      await db.query('COMMIT');
      res.status(201).json({ data: { id } });
    } catch (e) {
      await rollback(db);
      throw e;
    } finally {
      release(db);
    }
  }),
);
app.use('/api/trips/:id', collaboration);
app.get(
  '/api/trips/:id',
  operation('tripRead'),
  wrap(async (req, res) => {
    const budget = recommendationRequestBudget(req, res);
    const data = await budget.run(() =>
      tripSnapshot(pool, String(req.params.id), res.locals.user.id, budget.signal),
    );
    if (!data) return res.status(404).json({ error: '여행을 찾을 수 없습니다.' });
    res.json({ data });
  }),
);
app.post(
  '/api/trips/:id/days',
  wrap(async (req, res) => {
    const { date: requested } = z.object({ date: dateOnly.optional() }).parse(req.body || {}),
      db = await pool.connect();
    try {
      await db.query('BEGIN');
      await lockTripForWrite(db, String(req.params.id), res.locals.user.id);
      const count = await db.query(
        'SELECT count(*)::int AS count,max(visit_date)::text AS last FROM planner.trip_day WHERE trip_id=$1',
        [req.params.id],
      );
      const date = requested || addDate(count.rows[0].last, 1);
      if (count.rows[0].count >= 30) {
        await rollback(db);
        return res.status(400).json({ error: '여행 하나에 최대 30일까지 추가할 수 있어요.' });
      }
      await db.query('INSERT INTO planner.trip_day(id,trip_id,visit_date) VALUES($1,$2,$3)', [
        randomUUID(),
        req.params.id,
        date,
      ]);
      await db.query('COMMIT');
      res.status(201).json({ date });
    } catch (e: any) {
      await rollback(db);
      if (e.code === '23505') return res.status(409).json({ error: '이미 추가된 날짜입니다.' });
      throw e;
    } finally {
      release(db);
    }
  }),
);
app.put(
  '/api/trips/:id/days/:date/items',
  wrap(async (req, res) => {
    const date = dateOnly.parse(req.params.date),
      input = orderInput.parse(req.body),
      db = await pool.connect();
    try {
      await db.query('BEGIN');
      await lockTripForWrite(db, String(req.params.id), res.locals.user.id);
      const day = await db.query(
        'SELECT id,revision FROM planner.trip_day WHERE trip_id=$1 AND visit_date=$2 FOR UPDATE',
        [req.params.id, date],
      );
      if (!day.rowCount) {
        await rollback(db);
        return res.status(404).json({ error: '여행 날짜를 찾을 수 없습니다.' });
      }
      if (!requireRevision(req.body, day.rows[0].revision, res)) {
        await rollback(db);
        return;
      }
      const valid = await db.query('SELECT id FROM geo_data.place WHERE id=ANY($1::text[])', [
        input.placeIds,
      ]);
      if (valid.rowCount !== input.placeIds.length) {
        await rollback(db);
        return res.status(400).json({ error: '존재하지 않는 장소가 포함되어 있습니다.' });
      }
      await replaceDayItems(db, day.rows[0].id, input.placeIds);
      await db.query('UPDATE planner.trip_day SET revision=revision+1 WHERE id=$1', [
        day.rows[0].id,
      ]);
      await db.query('UPDATE planner.trip SET updated_at=now() WHERE id=$1', [req.params.id]);
      await db.query('COMMIT');
      res.json({ saved: true, count: input.placeIds.length, revision: day.rows[0].revision + 1 });
    } catch (e) {
      await rollback(db);
      throw e;
    } finally {
      release(db);
    }
  }),
);
app.patch(
  '/api/trips/:id',
  wrap(async (req, res) => {
    const input = z
      .object({
        title: z.string().trim().min(1).max(100),
        transportMode: z.enum(['DRIVE', 'TAXI', 'TRANSIT', 'WALK', 'BICYCLE']),
        costSettings: costInput.optional(),
      })
      .parse(req.body);
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await lockTripForWrite(db, String(req.params.id), res.locals.user.id);
      await db.query(
        'UPDATE planner.trip SET title=$1,transport_mode=$2,cost_settings=COALESCE($3::jsonb,cost_settings),updated_at=now() WHERE id=$4',
        [input.title, input.transportMode, input.costSettings ?? null, req.params.id],
      );
      await db.query('COMMIT');
      res.json({ saved: true });
    } catch (e) {
      await rollback(db);
      throw e;
    } finally {
      release(db);
    }
  }),
);
app.patch(
  '/api/trips/:id/cost-settings',
  wrap(async (req, res) => {
    const input = costInput.parse(req.body);
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await lockTripForWrite(db, String(req.params.id), res.locals.user.id);
      await db.query('UPDATE planner.trip SET cost_settings=$1,updated_at=now() WHERE id=$2', [
        input,
        req.params.id,
      ]);
      await db.query('COMMIT');
      res.json({ saved: true });
    } catch (e) {
      await rollback(db);
      throw e;
    } finally {
      release(db);
    }
  }),
);
app.patch(
  '/api/trips/:id/days/:date/items/:placeId/note',
  wrap(async (req, res) => {
    const date = dateOnly.parse(req.params.date),
      placeId = uuid.parse(req.params.placeId),
      { note } = z.object({ note: z.string().max(2000) }).parse(req.body),
      db = await pool.connect();
    try {
      await db.query('BEGIN');
      await lockTripForWrite(db, String(req.params.id), res.locals.user.id);
      const day = await db.query(
        'SELECT id,revision FROM planner.trip_day WHERE trip_id=$1 AND visit_date=$2 FOR UPDATE',
        [req.params.id, date],
      );
      if (!day.rowCount) {
        await rollback(db);
        return res.status(404).json({ error: '날짜를 찾을 수 없어요.' });
      }
      if (!requireRevision(req.body, day.rows[0].revision, res)) {
        await rollback(db);
        return;
      }
      const result = await db.query(
        'UPDATE planner.itinerary_item SET note=$1 WHERE day_id=$2 AND place_id=$3',
        [note, day.rows[0].id, placeId],
      );
      if (!result.rowCount) {
        await rollback(db);
        return res.status(404).json({ error: '일정 장소를 찾을 수 없어요.' });
      }
      await db.query('UPDATE planner.trip_day SET revision=revision+1 WHERE id=$1', [
        day.rows[0].id,
      ]);
      await db.query('COMMIT');
      res.json({ saved: true, revision: day.rows[0].revision + 1 });
    } catch (e) {
      await rollback(db);
      throw e;
    } finally {
      release(db);
    }
  }),
);
app.patch(
  '/api/trips/:id/days/:date/items/:placeId/schedule',
  wrap(async (req, res) => {
    const date = dateOnly.parse(req.params.date),
      placeId = uuid.parse(req.params.placeId),
      input = z
        .object({
          startMinute: z.number().int().min(0).max(1439).nullable(),
          endMinute: z.number().int().min(1).max(1440).nullable(),
        })
        .refine(
          (v) =>
            (v.startMinute === null && v.endMinute === null) ||
            (v.startMinute !== null && v.endMinute !== null && v.endMinute > v.startMinute),
          '종료 시간은 시작 시간보다 늦어야 해요.',
        )
        .parse(req.body),
      db = await pool.connect();
    try {
      await db.query('BEGIN');
      await lockTripForWrite(db, String(req.params.id), res.locals.user.id);
      const day = await db.query(
        'SELECT id,revision FROM planner.trip_day WHERE trip_id=$1 AND visit_date=$2 FOR UPDATE',
        [req.params.id, date],
      );
      if (!day.rowCount) {
        await rollback(db);
        return res.status(404).json({ error: '날짜를 찾을 수 없어요.' });
      }
      if (!requireRevision(req.body, day.rows[0].revision, res)) {
        await rollback(db);
        return;
      }
      const result = await db.query(
        'UPDATE planner.itinerary_item SET start_minute=$1,end_minute=$2 WHERE day_id=$3 AND place_id=$4',
        [input.startMinute, input.endMinute, day.rows[0].id, placeId],
      );
      if (!result.rowCount) {
        await rollback(db);
        return res.status(404).json({ error: '일정 장소를 찾을 수 없어요.' });
      }
      await db.query('UPDATE planner.trip_day SET revision=revision+1 WHERE id=$1', [
        day.rows[0].id,
      ]);
      await db.query('COMMIT');
      res.json({ saved: true, revision: day.rows[0].revision + 1 });
    } catch (e) {
      await rollback(db);
      throw e;
    } finally {
      release(db);
    }
  }),
);
app.post(
  '/api/trips/:id/days/:date/items',
  wrap(async (req, res) => {
    const date = dateOnly.parse(req.params.date),
      { placeId, placement } = z
        .object({ placeId: uuid, placement: z.enum(['APPEND', 'NEARBY']).default('APPEND') })
        .parse(req.body),
      db = await pool.connect();
    try {
      await db.query('BEGIN');
      await lockTripForWrite(db, String(req.params.id), res.locals.user.id);
      const day = await db.query(
        'SELECT id,revision FROM planner.trip_day WHERE trip_id=$1 AND visit_date=$2 FOR UPDATE',
        [req.params.id, date],
      );
      if (!day.rowCount) {
        await rollback(db);
        return res.status(404).json({ error: '여행 날짜를 찾을 수 없어요.' });
      }
      const place = await db.query('SELECT id,latitude,longitude FROM geo_data.place WHERE id=$1', [
        placeId,
      ]);
      if (!place.rowCount) {
        await rollback(db);
        return res.status(404).json({ error: '장소를 찾을 수 없어요.' });
      }
      const items = await db.query(
        'SELECT i.place_id,i.position,p.latitude,p.longitude FROM planner.itinerary_item i JOIN geo_data.place p ON p.id=i.place_id WHERE i.day_id=$1 ORDER BY i.position',
        [day.rows[0].id],
      );
      if (items.rows.some((p) => p.place_id === placeId)) {
        await rollback(db);
        return res
          .status(409)
          .json({ code: 'DUPLICATE_PLACE', error: '이미 이 날짜에 담긴 장소예요.' });
      }
      if (items.rows.length >= 30) {
        await rollback(db);
        return res.status(400).json({ error: '하루에 최대 30곳을 담을 수 있어요.' });
      }
      const position =
        placement === 'NEARBY' ? nearbyPosition(items.rows, place.rows[0]) : items.rows.length;
      // Shift backwards to preserve the unique (day_id, position) constraint.
      for (const item of [...items.rows].reverse())
        if (item.position >= position)
          await db.query(
            'UPDATE planner.itinerary_item SET position=position+1 WHERE day_id=$1 AND place_id=$2',
            [day.rows[0].id, item.place_id],
          );
      await db.query(
        'INSERT INTO planner.itinerary_item(id,day_id,place_id,position) VALUES($1,$2,$3,$4)',
        [randomUUID(), day.rows[0].id, placeId, position],
      );
      await db.query('UPDATE planner.trip_day SET revision=revision+1 WHERE id=$1', [
        day.rows[0].id,
      ]);
      await db.query('UPDATE planner.trip SET updated_at=now() WHERE id=$1', [req.params.id]);
      await db.query('COMMIT');
      res.status(201).json({ saved: true, revision: day.rows[0].revision + 1 });
    } catch (e) {
      await rollback(db);
      throw e;
    } finally {
      release(db);
    }
  }),
);
app.delete(
  '/api/trips/:id',
  wrap(async (req, res) => {
    if (!res.locals.trip.isOwner)
      return res.status(403).json({ error: '여행 삭제는 소유자만 할 수 있어요.' });
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await lockTripForWrite(db, String(req.params.id), res.locals.user.id, true);
      await db.query('DELETE FROM planner.trip WHERE id=$1', [req.params.id]);
      await db.query('COMMIT');
      res.status(204).end();
    } catch (e) {
      await rollback(db);
      throw e;
    } finally {
      release(db);
    }
  }),
);

export { app as tripRoutes };
