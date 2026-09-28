import { z } from 'zod';
import { estimateCosts } from '../costs.js';
import { pool } from '../db.js';
import { dateOnly, uuid } from '../domain.js';
import { computeSegment, forecast } from '../providers.js';

import { dayAlternatives } from '../day-alternatives.js';
import { routeSegment } from '../routing.js';
import { mapConcurrent } from '../provider-cache.js';
import { alternatives } from '../weather-alternatives.js';

import { Router } from 'express';
import { requireAuth } from '../auth/session.js';
import { wrap } from '../http/async-handler.js';
import { rateLimits } from '../http/rate-limit.js';
const app = Router();
const providerLimit = rateLimits.provider();
app.use('/api/trips/:id/days/:date/weather-alternatives', providerLimit, alternatives);
app.use('/api/trips/:id/days/:date/day-alternatives', providerLimit, dayAlternatives);
app.get(
  '/api/trips/:id/days/:date/routes',
  providerLimit,
  wrap(async (req, res) => {
    const date = dateOnly.parse(req.params.date);
    const days = await pool.query(
      'SELECT id FROM planner.trip_day WHERE trip_id=$1 AND visit_date=$2',
      [req.params.id, date],
    );
    if (!days.rowCount) return res.status(404).json({ error: '여행 날짜를 찾을 수 없습니다.' });
    const q = await pool.query(
      'SELECT p.id,p.latitude,p.longitude FROM planner.itinerary_item i JOIN geo_data.place p ON p.id=i.place_id WHERE i.day_id=$1 ORDER BY i.position',
      [days.rows[0].id],
    );
    const segments = await mapConcurrent(q.rows.slice(1), 3, (point, index) =>
      routeSegment(
        q.rows[index],
        point,
        res.locals.trip.transportMode,
        fetch,
        new Date(date + 'T09:00:00+09:00').toISOString(),
      ),
    );
    res.set('Cache-Control', 'no-store').json({
      segments,
      mode: res.locals.trip.transportMode,
      departureNotice: '각 구간은 해당 여행일 오전 9시(JST) 출발을 가정합니다.',
    });
  }),
);
app.get(
  '/api/trips/:id/days/:date/route-options',
  providerLimit,
  wrap(async (req, res) => {
    const date = dateOnly.parse(req.params.date),
      i = z
        .object({
          from: uuid,
          to: uuid,
          departure: z
            .string()
            .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
            .default('09:00'),
          google: z.enum(['true', 'false', 'drive']).default('false'),
        })
        .parse(req.query);
    const q = await pool.query(
      'SELECT p.id,p.latitude,p.longitude FROM planner.itinerary_item i JOIN planner.trip_day d ON d.id=i.day_id JOIN geo_data.place p ON p.id=i.place_id WHERE d.trip_id=$1 AND d.visit_date=$2 ORDER BY i.position',
      [req.params.id, date],
    );
    const index = q.rows.findIndex((p) => p.id === i.from);
    if (index < 0 || q.rows[index + 1]?.id !== i.to)
      return res.status(404).json({ error: '같은 날짜의 연속된 장소만 비교할 수 있어요.' });
    const a = q.rows[index],
      b = q.rows[index + 1],
      departureTime = new Date(date + 'T' + i.departure + ':00+09:00').toISOString(),
      options: any[] = [];
    if (i.google !== 'false') {
      options.push(
        ...(await mapConcurrent(
          i.google === 'drive' ? ['DRIVE'] : ['TRANSIT', 'DRIVE'],
          2,
          async (mode) => {
            const r = await computeSegment(a, b, mode, fetch, departureTime);
            return {
              ...r,
              mode: mode === 'DRIVE' ? 'GOOGLE_DRIVE' : mode,
              costs:
                mode === 'DRIVE' && r.source === 'google'
                  ? estimateCosts(r.distanceMeters, r.durationSeconds, res.locals.trip.costSettings)
                  : null,
            };
          },
        )),
      );
    } else
      options.push(
        ...(await mapConcurrent(['DRIVE', 'WALK', 'BICYCLE'], 3, async (mode) => ({
          ...(await routeSegment(a, b, mode)),
          mode,
        }))),
      );
    res.set('Cache-Control', 'no-store').json({
      options,
      departureTime,
      notice: '교통수단별 별도 경로입니다. Google 통행료·연료비는 Google 자동차 경로에만 해당해요.',
    });
  }),
);
app.get(
  '/api/weather',
  requireAuth,
  providerLimit,
  wrap(async (req, res) => {
    const input = z
      .object({
        latitude: z.coerce.number().min(41).max(46.1),
        longitude: z.coerce.number().min(137).max(147),
        date: dateOnly,
      })
      .parse(req.query);
    res.json(await forecast(input.latitude, input.longitude, input.date));
  }),
);

export { app as providerRoutes };
