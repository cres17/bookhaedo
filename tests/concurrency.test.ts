import { beforeAll, afterAll, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { app } from '../server/app';
import { pool, migrate } from '../server/db';
const user = request.agent(app),
  other = request.agent(app),
  ids = [randomUUID(), randomUUID(), randomUUID()];
const emails = [
  `reliability-${randomUUID()}@example.test`,
  `reliability-${randomUUID()}@example.test`,
];
let trip = '',
  path = '';
it('잘못된 JSON·큰 요청·없는 API도 추적 가능한 JSON 오류로 응답한다', async () => {
  const responses = [
    await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{'),
    await request(app)
      .post('/api/auth/login')
      .send({ value: 'x'.repeat(25000) }),
    await request(app).get('/api/nonexistent-endpoint'),
  ];
  expect(responses.map((r) => r.status)).toEqual([400, 413, 404]);
  for (const response of responses) {
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.error).toBeTruthy();
  }
});
beforeAll(async () => {
  await migrate();
  for (const [i, id] of ids.entries())
    await pool.query(
      `INSERT INTO geo_data.place(id,region_id,category,name_ja,normalized_name,latitude,longitude,location,region_distance_km,osm_tags) VALUES($1,'sapporo','ATTRACTION',$2,$2,$3,141.35,ST_SetSRID(ST_MakePoint(141.35,$3),4326)::geography,0,'{"tourism":"museum"}')`,
      [id, '検証専用' + id, 43.06 + i * 0.001],
    );
  for (const [i, a] of [user, other].entries())
    expect(
      (
        await a
          .post('/api/auth/register')
          .send({ email: emails[i], name: '검증 계정', password: 'reliability-password' })
      ).status,
    ).toBe(201);
  const r = await user
    .post('/api/trips')
    .send({ title: '동시성 검증', startDate: '2026-09-10', days: 2 });
  trip = r.body.data.id;
  path = `/api/trips/${trip}/days/2026-09-10/items`;
});
afterAll(async () => {
  await pool.query('DELETE FROM planner.app_user WHERE email=ANY($1::text[])', [emails]);
  await pool.query('DELETE FROM geo_data.place WHERE id=ANY($1::text[])', [ids]);
  await pool.end();
});
it('버전 없는 전체 저장은 428, 타인 요청은 404로 거절한다', async () => {
  expect((await user.put(path).send({ placeIds: [ids[0]] })).status).toBe(428);
  expect((await other.post(path).send({ placeId: ids[0] })).status).toBe(404);
});
it('동시 장소 추가는 서로를 잃지 않고 중복은 409로 구분한다', async () => {
  const r = await Promise.all(ids.slice(0, 2).map((placeId) => user.post(path).send({ placeId })));
  expect(r.map((x) => x.status)).toEqual([201, 201]);
  const day = (await user.get('/api/trips/' + trip)).body.data.days[0];
  expect(day.items.map((p) => p.id).sort()).toEqual(ids.slice(0, 2).sort());
  expect(day.revision).toBe(2);
  expect((await user.post(path).send({ placeId: ids[0] })).status).toBe(409);
});
it('동일 버전의 두 전체 저장 중 하나만 성공하고 다른 하나는 409다', async () => {
  const r = await Promise.all(
    [[ids[0]], [ids[1]]].map((placeIds) => user.put(path).send({ placeIds, expectedRevision: 2 })),
  );
  expect(r.map((x) => x.status).sort()).toEqual([200, 409]);
  const day = (await user.get('/api/trips/' + trip)).body.data.days[0];
  expect(day.revision).toBe(3);
  expect(day.items).toHaveLength(1);
});
it('메모 저장도 버전을 올려 오래된 화면과 대안 확정을 차단한다', async () => {
  const day = (await user.get('/api/trips/' + trip)).body.data.days[0];
  const placeId = day.items[0].id;
  expect(
    (
      await user
        .patch(path + '/' + placeId + '/note')
        .send({ note: '보존할 메모', expectedRevision: 3 })
    ).status,
  ).toBe(200);
  expect((await user.put(path).send({ placeIds: [ids[2]], expectedRevision: 3 })).status).toBe(409);
  const next = (await user.get('/api/trips/' + trip)).body.data.days[0];
  expect(next.items[0].note).toBe('보존할 메모');
  expect(next.revision).toBe(4);
  expect(
    (
      await user
        .patch(path.replace('/items', '/day-alternatives'))
        .send({ placeIds: ids.slice(0, 2), expectedPlaceIds: [placeId], expectedRevision: 3 })
    ).status,
  ).toBe(409);
});
it('여행 설정의 잘못된 비용 입력은 이름·이동방법도 바꾸지 않는다', async () => {
  expect(
    (
      await user.patch('/api/trips/' + trip).send({
        title: '잘못 저장되면 안됨',
        transportMode: 'WALK',
        costSettings: { fuelEfficiency: 0 },
      })
    ).status,
  ).toBe(400);
  const r = (await user.get('/api/trips/' + trip)).body.data;
  expect(r.title).toBe('동시성 검증');
  expect(r.transportMode).toBe('DRIVE');
});
it('조회 제한은 회원별로 적용하고 외부 호출 없는 확정을 막지 않는다', async () => {
  for (let i = 0; i < 30; i++)
    expect((await user.get('/api/weather?date=invalid')).status).toBe(400);
  const limited = await user.get('/api/weather?date=invalid');
  expect(limited.status).toBe(429);
  expect(limited.headers['retry-after']).toBeTruthy();
  expect((await other.get('/api/weather?date=invalid')).status).toBe(400);
  const save = await user.patch(path.replace('/items', '/day-alternatives')).send({
    placeIds: ids.slice(0, 2),
    expectedPlaceIds: [ids[0]],
    expectedRevision: 0,
  });
  expect(save.status).toBe(409);
  expect(save.body.code).toBe('STALE_ITINERARY');
});
