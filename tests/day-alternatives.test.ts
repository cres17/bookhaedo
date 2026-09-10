import { versioned } from './versioned-request';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
vi.mock('../server/providers', async (original) => ({
  ...(await original<any>()),
  forecast: vi.fn(async () => ({
    available: true,
    description: '맑음',
    high: 20,
    low: 10,
    precipitationProbability: 10,
    source: 'Open-Meteo',
  })),
}));
vi.mock('../server/routing', async (original) => ({
  ...(await original<any>()),
  routeSegment: vi.fn(async (a: any, b: any) => ({
    from: a.id,
    to: b.id,
    source: 'valhalla',
    distanceMeters: 1200,
    durationSeconds: 720,
    coordinates: [
      [a.longitude, a.latitude],
      [b.longitude, b.latitude],
    ],
  })),
}));
import { forecast } from '../server/providers';
import { buildDayPlans } from '../server/day-alternatives';
import { app } from '../server/app';
import { pool, migrate } from '../server/db';

const user = request.agent(app),
  other = request.agent(app),
  emails = [`day-plan-${randomUUID()}@example.test`, `day-plan-${randomUUID()}@example.test`];
let tripId = '',
  emptyTripId = '',
  currentIds: string[] = [];
const base = () => `/api/trips/${tripId}/days/2026-09-10/day-alternatives`;
beforeAll(async () => {
  await migrate();
  for (const [i, a] of [user, other].entries())
    expect(
      (
        await a
          .post('/api/auth/register')
          .send({ email: emails[i], name: '하루 코스 QA', password: 'day-plan-password' })
      ).status,
    ).toBe(201);
  const q = await pool.query(
    `SELECT id FROM geo_data.place WHERE region_id='sapporo' AND category='ATTRACTION' ORDER BY (name_ko IS NOT NULL) DESC LIMIT 2`,
  );
  currentIds = q.rows.map((p) => p.id);
  expect(currentIds).toHaveLength(2);
  tripId = (
    await user
      .post('/api/trips')
      .send({ title: '하루 코스 테스트', startDate: '2026-09-10', days: 1 })
  ).body.data.id;
  emptyTripId = (
    await user.post('/api/trips').send({ title: '빈 일정', startDate: '2026-09-10', days: 1 })
  ).body.data.id;
  await versioned(user, 'put', `/api/trips/${tripId}/days/2026-09-10/items`, {
    placeIds: currentIds,
  });
});
afterAll(async () => {
  await pool.query('DELETE FROM planner.app_user WHERE email=ANY($1::text[])', [emails]);
  await pool.end();
});

describe('화이트박스: 하루 코스 구성', () => {
  const anchor = {
    id: 'old',
    nameJa: '기존',
    nameKo: '기존',
    category: 'ATTRACTION',
    latitude: 43.06,
    longitude: 141.35,
    tags: { leisure: 'park' },
  };
  const candidates = [
    {
      id: 'm1',
      nameJa: '박물관1',
      nameKo: '박물관1',
      category: 'ATTRACTION',
      latitude: 43.061,
      longitude: 141.351,
      tags: { tourism: 'museum' },
    },
    {
      id: 'm2',
      nameJa: '박물관2',
      nameKo: '박물관2',
      category: 'ATTRACTION',
      latitude: 43.062,
      longitude: 141.352,
      tags: { indoor: 'yes' },
    },
    {
      id: 'r1',
      nameJa: '식당',
      nameKo: '식당',
      category: 'RESTAURANT',
      latitude: 43.063,
      longitude: 141.353,
      tags: { indoor: 'yes' },
    },
    {
      id: 'p1',
      nameJa: '공원',
      nameKo: '공원',
      category: 'ATTRACTION',
      latitude: 43.064,
      longitude: 141.354,
      tags: { leisure: 'park' },
    },
  ];
  it('맑은 날에도 3가지 전략을 만들고 실내 전략은 실내 근거만 사용한다', () => {
    const plans = buildDayPlans(candidates, [anchor], { available: true, description: '맑음' }, 3);
    expect(plans.map((p: any) => p.id)).toEqual(['AUTO', 'INDOOR', 'NEARBY']);
    expect(plans.find((p: any) => p.id === 'INDOOR').places.every((p: any) => p.id !== 'p1')).toBe(
      true,
    );
  });
  it('악천후에는 자동 전략도 실내 장소로 구성한다', () => {
    const plan = buildDayPlans(
      candidates,
      [anchor],
      { available: true, description: '비' },
      3,
    ).find((p: any) => p.id === 'AUTO');
    expect(plan.label).toContain('실내');
    expect(plan.places.every((p: any) => p.id !== 'p1')).toBe(true);
  });
});

describe('블랙박스: 하루 전체 추천·미리보기·확정', () => {
  it('미인증과 다른 회원의 접근을 차단한다', async () => {
    expect((await request(app).get(base())).status).toBe(401);
    expect((await other.get(base())).status).toBe(404);
    expect((await versioned(other, 'patch', base(), {})).status).toBe(404);
  });
  it('빈 날짜는 기준 장소가 필요하다고 안내한다', async () => {
    const r = await user.get(`/api/trips/${emptyTripId}/days/2026-09-10/day-alternatives`);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('NEEDS_ANCHOR');
  });
  it('맑은 날에도 날씨 맞춤·실내·근거리 코스를 반환한다', async () => {
    const r = await user.get(base()).query({ count: 4 });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('READY');
    expect(r.body.weatherMode).toBe('FAIR');
    expect(r.body.plans.map((p: any) => p.id)).toEqual(
      expect.arrayContaining(['AUTO', 'INDOOR', 'NEARBY']),
    );
    expect(r.body.plans.every((p: any) => p.places.length >= 2 && p.places.length <= 4)).toBe(true);
  });
  it('예보가 없거나 악천후여도 코스 추천은 계속 제공한다', async () => {
    vi.mocked(forecast).mockResolvedValueOnce({ available: false, notice: '예보 범위 밖' } as any);
    expect((await user.get(base())).body.plans.length).toBeGreaterThan(0);
    vi.mocked(forecast).mockResolvedValueOnce({
      available: true,
      description: '눈',
      snowfallCm: 3,
    } as any);
    const bad = await user.get(base());
    expect(bad.body.weatherMode).toBe('ADVERSE');
    expect(bad.body.plans.find((p: any) => p.id === 'AUTO').label).toContain('실내');
  });
  it('미리보기는 실제 경로 합계를 반환하지만 저장하지 않는다', async () => {
    const before = (await user.get('/api/trips/' + tripId)).body.data.days[0].items.map(
      (p: any) => p.id,
    );
    const r = await user.get(base()).query({ strategy: 'NEARBY', count: 3 });
    expect(r.status).toBe(200);
    expect(r.body.preview.complete).toBe(true);
    expect(r.body.preview.durationSeconds).toBe((r.body.preview.plan.places.length - 1) * 720);
    expect(
      (await user.get('/api/trips/' + tripId)).body.data.days[0].items.map((p: any) => p.id),
    ).toEqual(before);
  });
  it('오래된 일정은 보존하고 사용자가 확정한 코스만 원자적으로 저장한다', async () => {
    const proposal = await user.get(base()).query({ strategy: 'NEARBY', count: 3 });
    const ids = proposal.body.preview.plan.places.map((p: any) => p.id);
    expect(
      (await versioned(user, 'patch', base(), { placeIds: ids, expectedPlaceIds: [currentIds[0]] }))
        .status,
    ).toBe(409);
    expect(
      (await user.get('/api/trips/' + tripId)).body.data.days[0].items.map((p: any) => p.id),
    ).toEqual(currentIds);
    expect(
      (await versioned(user, 'patch', base(), { placeIds: ids, expectedPlaceIds: currentIds }))
        .status,
    ).toBe(200);
    expect(
      (await user.get('/api/trips/' + tripId)).body.data.days[0].items.map((p: any) => p.id),
    ).toEqual(ids);
  });
});
