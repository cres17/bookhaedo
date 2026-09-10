import { versioned } from './versioned-request';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { adverseWeather, indoorEvidence, isOutdoor } from '../shared/weather-policy';
vi.mock('../server/providers', async (original) => ({
  ...(await original<any>()),
  forecast: vi.fn(async () => ({
    available: true,
    description: '비',
    precipitationMm: 10,
    source: 'Open-Meteo',
  })),
}));
vi.mock('../server/routing', async (original) => ({
  ...(await original<any>()),
  routeSegment: vi.fn(async (a: any, b: any) => ({
    from: a.id,
    to: b.id,
    source: 'valhalla',
    distanceMeters: 1000,
    durationSeconds: 600,
  })),
}));
import { forecast } from '../server/providers';
import { routeSegment } from '../server/routing';
import { rankAlternatives } from '../server/weather-alternatives';
import { app } from '../server/app';
import { pool, migrate } from '../server/db';
const user = request.agent(app),
  other = request.agent(app),
  emails = [`weather-${randomUUID()}@example.test`, `weather-${randomUUID()}@example.test`];
let tripId = '',
  park: any,
  museum: any,
  extra: any;
const base = () => `/api/trips/${tripId}/days/2026-09-10/weather-alternatives`;
beforeAll(async () => {
  await migrate();
  for (const [i, a] of [user, other].entries())
    expect(
      (
        await a
          .post('/api/auth/register')
          .send({ email: emails[i], name: '대안 추천 QA', password: 'weather-test-password' })
      ).status,
    ).toBe(201);
  const q = await pool.query(
    `SELECT a.id,a.latitude,a.longitude,a.osm_tags AS tags,b.id AS replacement FROM geo_data.place a JOIN geo_data.place b ON ST_DWithin(a.location,b.location,10000) WHERE a.osm_tags->>'leisure'='park' AND b.osm_tags->>'tourism'='museum' AND COALESCE(b.osm_tags->>'indoor','')<>'no' AND COALESCE(b.osm_tags->>'access','') NOT IN ('private','no') LIMIT 1`,
  );
  park = q.rows[0];
  expect(park).toBeTruthy();
  museum = { id: park.replacement };
  extra = (
    await pool.query('SELECT id FROM geo_data.place WHERE id<>ALL($1::text[]) LIMIT 1', [
      [park.id, museum.id],
    ])
  ).rows[0];
  tripId = (
    await user
      .post('/api/trips')
      .send({ title: '대안 추천 테스트', startDate: '2026-09-10', days: 1 })
  ).body.data.id;
  await versioned(user, 'put', `/api/trips/${tripId}/days/2026-09-10/items`, {
    placeIds: [park.id, extra.id],
  });
});
afterAll(async () => {
  await pool.query('DELETE FROM planner.app_user WHERE email=ANY($1::text[])', [emails]);
  await pool.end();
});
describe('화이트박스: 날씨·실내·순위', () => {
  it.each([
    { description: '비' },
    { description: '눈' },
    { description: '뇌우' },
    { windSpeedKmh: 40 },
    { precipitationProbability: 70 },
  ])('기준 예보를 감지한다 %j', (w) =>
    expect(adverseWeather({ available: true, ...w })).toBe(true),
  );
  it('예보 없음·맑음은 악천후로 생성하지 않는다', () => {
    expect(adverseWeather({ available: false, description: '비' })).toBe(false);
    expect(adverseWeather({ available: true, description: '맑음', windSpeedKmh: 10 })).toBe(false);
    expect(
      adverseWeather({
        available: true,
        windSpeedKmh: 39,
        precipitationProbability: 69,
        precipitationMm: 4.9,
        snowfallCm: 0.9,
      }),
    ).toBe(false);
  });
  it('음식점 전체를 실내라고 가정하지 않고 반대 태그·폐업을 제외한다', () => {
    expect(indoorEvidence({ category: 'RESTAURANT' })).toBeNull();
    expect(indoorEvidence({ tags: { tourism: 'museum', indoor: 'no' } })).toBeNull();
    expect(indoorEvidence({ tags: { indoor: 'yes', disused: 'yes' } })).toBeNull();
    expect(isOutdoor({ tags: { leisure: 'park' } })).toBe(true);
  });
  it('중복 일정·반경 밖 후보를 제외한다', () => {
    const t = { id: 't', latitude: 43, longitude: 141, tags: { leisure: 'park' } },
      p = { id: 'a', nameJa: 'A', latitude: 43.01, longitude: 141, tags: { tourism: 'museum' } };
    expect(
      rankAlternatives([p, { ...p, id: 'far', latitude: 45 }], [t], t).map((p) => p.id),
    ).toEqual(['a']);
    expect(rankAlternatives([p], [t, p], t)).toEqual([]);
  });
});
describe('블랙박스: 실제 DB·REST, 외부 예보/경로 통제', () => {
  it('미인증 및 타인의 추천·교체 요청을 차단한다', async () => {
    expect((await request(app).get(base()).query({ targetId: park.id })).status).toBe(401);
    expect((await other.get(base()).query({ targetId: park.id })).status).toBe(404);
    expect((await versioned(other, 'patch', base(), {})).status).toBe(404);
  });
  it('입력 오류 및 없는 날짜를 처리한다', async () => {
    expect((await user.get(base()).query({ targetId: 'bad' })).status).toBe(400);
    expect(
      (await user.get(base().replace('09-10', '09-11')).query({ targetId: park.id })).status,
    ).toBe(404);
  });
  it('야외 장소 주변의 실내 후보 3개 이하를 실제 DB에서 제공한다', async () => {
    const r = await user.get(base()).query({ targetId: park.id });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('READY');
    expect(r.body.data.length).toBeGreaterThan(0);
    expect(r.body.data.length).toBeLessThanOrEqual(3);
    expect(
      r.body.data.every(
        (p: any) =>
          indoorEvidence(p) && p.distanceMeters <= 20000 && !r.body.expectedPlaceIds.includes(p.id),
      ),
    ).toBe(true);
    museum = r.body.data[0];
  });
  it('미리보기는 저장하지 않고 실제 경로 합계를 제공한다', async () => {
    const r = await user.get(base()).query({ targetId: park.id, previewId: museum.id });
    expect(r.body.preview.before.durationSeconds).toBe(600);
    expect(r.body.preview.after.durationSeconds).toBe(600);
    expect((await user.get('/api/trips/' + tripId)).body.data.days[0].items[0].id).toBe(park.id);
  });
  it('경로 실패 시 시간을 만들지 않는다', async () => {
    vi.mocked(routeSegment).mockResolvedValueOnce({
      source: 'straight-line',
      distanceMeters: 1000,
      durationSeconds: null,
    } as any);
    const r = await user.get(base()).query({ targetId: park.id, previewId: museum.id });
    expect(r.body.preview.durationDeltaSeconds).toBeNull();
  });
  it('예보 없음·맑음·실내 대상은 구분한다', async () => {
    vi.mocked(forecast).mockResolvedValueOnce({ available: false, notice: '예보 없음' });
    expect((await user.get(base()).query({ targetId: park.id })).body.status).toBe('NO_FORECAST');
    vi.mocked(forecast).mockResolvedValueOnce({ available: true, description: '맑음' } as any);
    expect((await user.get(base()).query({ targetId: park.id })).body.status).toBe('FAIR_WEATHER');
  });
  it('주변 후보가 없으면 빈 결과를 안내하고 저장하지 않는다', async () => {
    const original = pool.query.bind(pool);
    const spy = vi
      .spyOn(pool, 'query')
      .mockImplementation(((sql: any, ...args: any[]) =>
        typeof sql === 'string' && sql.includes('ST_DWithin(location')
          ? Promise.resolve({ rows: [], rowCount: 0 })
          : (original as any)(sql, ...args)) as any);
    try {
      const r = await user.get(base()).query({ targetId: park.id });
      expect(r.status).toBe(200);
      expect(r.body.status).toBe('NO_CANDIDATES');
      expect(r.body.data).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
  it('오래된 목록·중복·잘못된 후보는 일정 보존 후 거절한다', async () => {
    expect(
      (
        await versioned(user, 'patch', base(), {
          placeIds: [park.id],
          targetId: park.id,
          replacementId: museum.id,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await versioned(user, 'patch', base(), {
          placeIds: [park.id, extra.id],
          targetId: park.id,
          replacementId: extra.id,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await versioned(user, 'patch', base(), {
          placeIds: [park.id, extra.id],
          targetId: park.id,
          replacementId: randomUUID(),
        })
      ).status,
    ).toBe(400);
  });
  it('교체를 영속화하고 다른 장소 메모·순서를 보존한다', async () => {
    await versioned(user, 'patch', `/api/trips/${tripId}/days/2026-09-10/items/${extra.id}/note`, {
      note: '유지할 메모',
    });
    expect(
      (
        await versioned(user, 'patch', base(), {
          placeIds: [park.id, extra.id],
          targetId: park.id,
          replacementId: museum.id,
        })
      ).status,
    ).toBe(200);
    const items = (await user.get('/api/trips/' + tripId)).body.data.days[0].items;
    expect(items.map((p: any) => p.id)).toEqual([museum.id, extra.id]);
    expect(items[1].note).toBe('유지할 메모');
    expect(items[0].note).toBe('');
    expect((await user.get(base()).query({ targetId: museum.id })).body.status).toBe('NOT_OUTDOOR');
  });
});
