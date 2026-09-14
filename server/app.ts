import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomUUID, randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { ZodError, z } from 'zod';
import { pool } from './db.js';
import { collaboration, invitations } from './collaboration.js';
import {
  registerInput,
  loginInput,
  tripInput,
  dateOnly,
  orderInput,
  uuid,
  addDate,
  placeSelect,
  regions,
} from './domain.js';
import { getTrend, addTrendBadges } from './trend-store.js';
import { costInput, estimateCosts } from './costs.js';
import { computeSegment } from './providers.js';
import { forecast } from './providers.js';

import { placeDetails, photoUrl } from './place-details.js';
import { recommend, themes } from './recommendations.js';
import { routeSegment } from './routing.js';
import { checkedWebsite } from './website-check.js';
import { parsePlaceSearch } from './place-search.js';
import { dedupePlaces, dedupedPlaceCte } from './place-dedupe.js';
import { admin } from './admin.js';
import { alternatives } from './weather-alternatives.js';
import { dayAlternatives } from './day-alternatives.js';
import { requireRevision } from './itinerary-version.js';
import { reviewRecommendations } from './review-recommendations.js';
import { searchAssist } from './search-assist.js';
export const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use('/api', (req, res, next) => {
  res.locals.requestId = randomUUID();
  res.set('X-Request-ID', res.locals.requestId);
  res.set('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '24kb' }));
app.use(cookieParser());
app.use(
  '/api',
  rateLimit({
    windowMs: 60000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { code: 'RATE_LIMITED', error: '요청이 많습니다. 잠시 후 다시 시도해주세요.' },
  }),
);
app.use((req, res, next) => {
  const origin = req.get('origin');
  const allowed = (
    process.env.APP_ORIGINS ||
    'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000'
  ).split(',');
  if (origin && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !allowed.includes(origin))
    return res.status(403).json({ error: '허용되지 않은 요청 출처입니다.' });
  next();
});
const wrap =
  (handler: (req: Request, res: Response) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(handler(req, res)).catch(next);
const auth = wrap(async (req, res) => {
  const token = req.cookies.kita_session;
  if (!token) return res.status(401).json({ error: '로그인이 필요합니다.' });
  const result = await pool.query(
    "SELECT u.id,u.email,u.display_name AS name,u.role,u.status FROM planner.session s JOIN planner.app_user u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.status='ACTIVE'",
    [hash(token)],
  );
  if (!result.rowCount) return res.status(401).json({ error: '로그인이 만료됐습니다.' });
  res.locals.user = result.rows[0];
});
function requireAuth(req: Request, res: Response, next: NextFunction) {
  Promise.resolve(auth(req, res, next))
    .then(() => {
      if (!res.headersSent && res.locals.user) next();
    })
    .catch(next);
}
function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
function passwordHash(value: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(value, salt, 64).toString('hex')}`;
}
function verifyPassword(value: string, stored: string) {
  const [salt, digest] = stored.split(':');
  return timingSafeEqual(Buffer.from(digest!, 'hex'), scryptSync(value, salt!, 64));
}
async function setSession(res: Response, userId: string) {
  const token = randomBytes(32).toString('hex');
  await pool.query(
    "INSERT INTO planner.session(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')",
    [hash(token), userId],
  );
  res.cookie('kita_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 86400000,
    path: '/',
  });
}
app.use('/api/admin', requireAuth, admin);
app.use(
  '/api',
  (req, res, next) =>
    /^\/(notifications|invitations)(\/|$)/.test(req.path) ? requireAuth(req, res, next) : next(),
  invitations,
);
app.delete(
  '/api/auth/me',
  requireAuth,
  rateLimit({
    windowMs: 15 * 60000,
    limit: 10,
    keyGenerator: (_req, res) => res.locals.user.id,
    message: { error: '탈퇴 확인 시도가 많습니다. 잠시 후 다시 시도해주세요.' },
  }),
  wrap(async (req, res) => {
    const { password } = z.object({ password: z.string().min(1).max(128) }).parse(req.body);
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query("SELECT pg_advisory_xact_lock(hashtext('bookhaedo-account-deletion'))");
      const user = (
        await db.query('SELECT * FROM planner.app_user WHERE id=$1 FOR UPDATE', [
          res.locals.user.id,
        ])
      ).rows[0];
      if (!user || !verifyPassword(password, user.password_hash)) {
        await db.query('ROLLBACK');
        return res.status(403).json({ error: '비밀번호가 일치하지 않아요.' });
      }
      if (user.role === 'ADMIN') {
        await db.query('ROLLBACK');
        return res
          .status(409)
          .json({ error: '관리자는 다른 관리자를 통해 회원 역할로 변경한 후 탈퇴해주세요.' });
      }
      await db.query('DELETE FROM planner.app_user WHERE id=$1', [user.id]);
      await db.query('COMMIT');
      res.clearCookie('kita_session', { path: '/' });
      res.status(204).end();
    } catch (e) {
      await db.query('ROLLBACK');
      throw e;
    } finally {
      db.release();
    }
  }),
);
app.get(
  '/api/health',
  wrap(async (_req, res) => {
    const q = await pool.query('SELECT count(*)::int AS count FROM geo_data.place');
    res.json({ status: 'ok', database: 'connected', places: q.rows[0].count });
  }),
);
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
const authLimit = rateLimit({
  windowMs: 15 * 60000,
  limit: 50,
  message: { error: '시도 횟수가 많습니다. 잠시 후 다시 시도해주세요.' },
});
app.post(
  '/api/auth/register',
  authLimit,
  wrap(async (req, res) => {
    const input = registerInput.parse(req.body);
    const id = randomUUID();
    try {
      await pool.query(
        'INSERT INTO planner.app_user(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)',
        [id, input.email, input.name, passwordHash(input.password)],
      );
    } catch (e: any) {
      if (e.code === '23505') return res.status(409).json({ error: '이미 가입된 이메일입니다.' });
      throw e;
    }
    await setSession(res, id);
    res.status(201).json({
      user: { id, email: input.email, name: input.name, role: 'MEMBER', status: 'ACTIVE' },
    });
  }),
);
app.post(
  '/api/auth/login',
  authLimit,
  wrap(async (req, res) => {
    const input = loginInput.parse(req.body);
    const q = await pool.query('SELECT * FROM planner.app_user WHERE email=$1', [input.email]);
    const user = q.rows[0];
    if (!user || user.status !== 'ACTIVE' || !verifyPassword(input.password, user.password_hash))
      return res.status(401).json({ error: '이메일 또는 비밀번호를 확인해주세요.' });
    await setSession(res, user.id);
    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.display_name,
        role: user.role,
        status: user.status,
      },
    });
  }),
);
app.get('/api/auth/me', requireAuth, (_req, res) => res.json({ user: res.locals.user }));
app.post(
  '/api/auth/logout',
  wrap(async (req, res) => {
    if (req.cookies.kita_session)
      await pool.query('DELETE FROM planner.session WHERE token_hash=$1', [
        hash(req.cookies.kita_session),
      ]);
    res.clearCookie('kita_session', { path: '/' });
    res.status(204).end();
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
const discoveryLimit = rateLimit({
  windowMs: 60000,
  limit: 20,
  message: { error: '추천 조회가 많아요. 잠시 후 다시 확인해주세요.' },
});
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
const detailLimit = rateLimit({
  windowMs: 60000,
  limit: 15,
  message: { error: '상세 조회가 많아요. 잠시 후 다시 확인해주세요.' },
});
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
app.use('/api/trips', requireAuth);
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
      await db.query('ROLLBACK');
      throw e;
    } finally {
      db.release();
    }
  }),
);
// Only the owner and accepted collaborators may access trip subresources.
app.use('/api/trips/:id', (req, res, next) => {
  Promise.resolve()
    .then(async () => {
      const id = uuid.parse(req.params.id);
      const q = await pool.query(
        'SELECT id,title,(user_id=$2) AS "isOwner",transport_mode AS "transportMode",cost_settings AS "costSettings" FROM planner.trip WHERE id=$1 AND (user_id=$2 OR EXISTS(SELECT 1 FROM planner.trip_member m WHERE m.trip_id=planner.trip.id AND m.user_id=$2))',
        [id, res.locals.user.id],
      );
      if (!q.rowCount) return res.status(404).json({ error: '여행을 찾을 수 없습니다.' });
      res.locals.trip = q.rows[0];
      next();
    })
    .catch(next);
});
app.use('/api/trips/:id', collaboration);
app.get(
  '/api/trips/:id',
  wrap(async (req, res) => {
    const days = await pool.query(
      'SELECT id,visit_date::text AS date,revision FROM planner.trip_day WHERE trip_id=$1 ORDER BY visit_date',
      [req.params.id],
    );
    const items = await pool.query(
      `SELECT i.id AS "itemId",i.day_id AS "dayId",i.position,i.note,i.estimated_cost AS "estimatedCost",p.id,p.region_id AS "regionId",p.category,p.name_ja AS "nameJa",p.name_ko AS "nameKo",COALESCE(p.name_ko,p.name_ja) AS name,p.latitude,p.longitude,p.address,p.website,p.opening_hours AS "openingHours",p.osm_tags AS tags FROM planner.itinerary_item i JOIN planner.trip_day d ON d.id=i.day_id JOIN geo_data.place p ON p.id=i.place_id WHERE d.trip_id=$1 ORDER BY i.position`,
      [req.params.id],
    );
    res.json({
      data: {
        ...res.locals.trip,
        days: days.rows.map((day) => ({
          ...day,
          items: items.rows.filter((i) => i.dayId === day.id),
        })),
      },
    });
  }),
);
app.post(
  '/api/trips/:id/days',
  wrap(async (req, res) => {
    const { date: requested } = z.object({ date: dateOnly.optional() }).parse(req.body || {}),
      db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query('SELECT id FROM planner.trip WHERE id=$1 FOR UPDATE', [req.params.id]);
      const count = await db.query(
        'SELECT count(*)::int AS count,max(visit_date)::text AS last FROM planner.trip_day WHERE trip_id=$1',
        [req.params.id],
      );
      const date = requested || addDate(count.rows[0].last, 1);
      if (count.rows[0].count >= 30) {
        await db.query('ROLLBACK');
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
      await db.query('ROLLBACK');
      if (e.code === '23505') return res.status(409).json({ error: '이미 추가된 날짜입니다.' });
      throw e;
    } finally {
      db.release();
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
      const day = await db.query(
        'SELECT id,revision FROM planner.trip_day WHERE trip_id=$1 AND visit_date=$2 FOR UPDATE',
        [req.params.id, date],
      );
      if (!day.rowCount) {
        await db.query('ROLLBACK');
        return res.status(404).json({ error: '여행 날짜를 찾을 수 없습니다.' });
      }
      if (!requireRevision(req.body, day.rows[0].revision, res)) {
        await db.query('ROLLBACK');
        return;
      }
      const valid = await db.query('SELECT id FROM geo_data.place WHERE id=ANY($1::text[])', [
        input.placeIds,
      ]);
      if (valid.rowCount !== input.placeIds.length) {
        await db.query('ROLLBACK');
        return res.status(400).json({ error: '존재하지 않는 장소가 포함되어 있습니다.' });
      }
      const notes = await db.query(
        'SELECT place_id,note,estimated_cost FROM planner.itinerary_item WHERE day_id=$1',
        [day.rows[0].id],
      );
      await db.query('DELETE FROM planner.itinerary_item WHERE day_id=$1', [day.rows[0].id]);
      for (const [position, placeId] of input.placeIds.entries())
        await db.query(
          'INSERT INTO planner.itinerary_item(id,day_id,place_id,position,note,estimated_cost) VALUES($1,$2,$3,$4,$5,$6)',
          [
            randomUUID(),
            day.rows[0].id,
            placeId,
            position,
            notes.rows.find((n) => n.place_id === placeId)?.note || '',
            notes.rows.find((n) => n.place_id === placeId)?.estimated_cost ?? null,
          ],
        );
      await db.query('UPDATE planner.trip_day SET revision=revision+1 WHERE id=$1', [
        day.rows[0].id,
      ]);
      await db.query('UPDATE planner.trip SET updated_at=now() WHERE id=$1', [req.params.id]);
      await db.query('COMMIT');
      res.json({ saved: true, count: input.placeIds.length, revision: day.rows[0].revision + 1 });
    } catch (e) {
      await db.query('ROLLBACK');
      throw e;
    } finally {
      db.release();
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
    await pool.query(
      'UPDATE planner.trip SET title=$1,transport_mode=$2,cost_settings=COALESCE($3::jsonb,cost_settings),updated_at=now() WHERE id=$4',
      [input.title, input.transportMode, input.costSettings ?? null, req.params.id],
    );
    res.json({ saved: true });
  }),
);
app.patch(
  '/api/trips/:id/cost-settings',
  wrap(async (req, res) => {
    const input = costInput.parse(req.body);
    await pool.query('UPDATE planner.trip SET cost_settings=$1,updated_at=now() WHERE id=$2', [
      input,
      req.params.id,
    ]);
    res.json({ saved: true });
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
      const day = await db.query(
        'SELECT id,revision FROM planner.trip_day WHERE trip_id=$1 AND visit_date=$2 FOR UPDATE',
        [req.params.id, date],
      );
      if (!day.rowCount) {
        await db.query('ROLLBACK');
        return res.status(404).json({ error: '날짜를 찾을 수 없어요.' });
      }
      if (!requireRevision(req.body, day.rows[0].revision, res)) {
        await db.query('ROLLBACK');
        return;
      }
      const result = await db.query(
        'UPDATE planner.itinerary_item SET note=$1 WHERE day_id=$2 AND place_id=$3',
        [note, day.rows[0].id, placeId],
      );
      if (!result.rowCount) {
        await db.query('ROLLBACK');
        return res.status(404).json({ error: '일정 장소를 찾을 수 없어요.' });
      }
      await db.query('UPDATE planner.trip_day SET revision=revision+1 WHERE id=$1', [
        day.rows[0].id,
      ]);
      await db.query('COMMIT');
      res.json({ saved: true, revision: day.rows[0].revision + 1 });
    } catch (e) {
      await db.query('ROLLBACK');
      throw e;
    } finally {
      db.release();
    }
  }),
);
app.post(
  '/api/trips/:id/days/:date/items',
  wrap(async (req, res) => {
    const date = dateOnly.parse(req.params.date),
      { placeId } = z.object({ placeId: uuid }).parse(req.body),
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
      if (!(await db.query('SELECT id FROM geo_data.place WHERE id=$1', [placeId])).rowCount) {
        await db.query('ROLLBACK');
        return res.status(404).json({ error: '장소를 찾을 수 없어요.' });
      }
      const items = await db.query(
        'SELECT place_id,position FROM planner.itinerary_item WHERE day_id=$1 ORDER BY position',
        [day.rows[0].id],
      );
      if (items.rows.some((p) => p.place_id === placeId)) {
        await db.query('ROLLBACK');
        return res
          .status(409)
          .json({ code: 'DUPLICATE_PLACE', error: '이미 이 날짜에 담긴 장소예요.' });
      }
      if (items.rows.length >= 30) {
        await db.query('ROLLBACK');
        return res.status(400).json({ error: '하루에 최대 30곳을 담을 수 있어요.' });
      }
      await db.query(
        'INSERT INTO planner.itinerary_item(id,day_id,place_id,position) VALUES($1,$2,$3,$4)',
        [randomUUID(), day.rows[0].id, placeId, items.rows.length],
      );
      await db.query('UPDATE planner.trip_day SET revision=revision+1 WHERE id=$1', [
        day.rows[0].id,
      ]);
      await db.query('UPDATE planner.trip SET updated_at=now() WHERE id=$1', [req.params.id]);
      await db.query('COMMIT');
      res.status(201).json({ saved: true, revision: day.rows[0].revision + 1 });
    } catch (e) {
      await db.query('ROLLBACK');
      throw e;
    } finally {
      db.release();
    }
  }),
);
app.delete(
  '/api/trips/:id',
  wrap(async (req, res) => {
    if (!res.locals.trip.isOwner)
      return res.status(403).json({ error: '여행 삭제는 소유자만 할 수 있어요.' });
    await pool.query('DELETE FROM planner.trip WHERE id=$1', [req.params.id]);
    res.status(204).end();
  }),
);
const providerLimit = rateLimit({
  windowMs: 60000,
  limit: 30,
  // These routes have already passed authentication/ownership checks.
  keyGenerator: (_req, res) => res.locals.user.id,
  // Saving a previously previewed itinerary does not call an external provider.
  skip: (req) => req.method !== 'GET',
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    code: 'PROVIDER_RATE_LIMITED',
    error: '외부 정보 조회가 많습니다. 잠시 후 다시 조회해주세요.',
  },
});
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
    const segments = [];
    for (let i = 1; i < q.rows.length; i++)
      segments.push(
        await routeSegment(
          q.rows[i - 1],
          q.rows[i],
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
      for (const mode of i.google === 'drive' ? ['DRIVE'] : ['TRANSIT', 'DRIVE']) {
        const r = await computeSegment(a, b, mode, fetch, departureTime);
        options.push({
          ...r,
          mode: mode === 'DRIVE' ? 'GOOGLE_DRIVE' : mode,
          costs:
            mode === 'DRIVE' && r.source === 'google'
              ? estimateCosts(r.distanceMeters, r.durationSeconds, res.locals.trip.costSettings)
              : null,
        });
      }
    } else
      for (const mode of ['DRIVE', 'WALK', 'BICYCLE'])
        options.push({ ...(await routeSegment(a, b, mode)), mode });
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
app.use('/api', (_req, res) => res.status(404).json({ error: 'API 경로를 찾을 수 없습니다.' }));
app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof ZodError)
    return res.status(400).json({
      error: '입력 형식을 확인해주세요.',
      details: error.issues.map((x) => ({ path: x.path, message: x.message })),
    });
  if (error.type === 'entity.parse.failed')
    return res.status(400).json({ error: 'JSON 형식을 확인해주세요.' });
  if (error.type === 'entity.too.large')
    return res.status(413).json({ code: 'PAYLOAD_TOO_LARGE', error: '요청 내용이 너무 큽니다.' });
  console.error(
    JSON.stringify({
      event: 'API_ERROR',
      requestId: res.locals.requestId,
      code: error.code || error.name,
    }),
  );
  res.status(500).json({
    code: 'INTERNAL_ERROR',
    requestId: res.locals.requestId,
    error: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.',
  });
});
