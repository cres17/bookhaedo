import { versioned } from './versioned-request';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { app } from '../server/app';
import { pool, migrate } from '../server/db';
const user = request.agent(app),
  outsider = request.agent(app);
let tripId = '',
  placeIds: string[] = [];
const emails = [`qa-${randomUUID()}@example.test`, `qa-${randomUUID()}@example.test`];
beforeAll(async () => {
  await migrate();
});
afterAll(async () => {
  await pool.query('DELETE FROM planner.app_user WHERE email=ANY($1::text[])', [emails]);
  await pool.end();
});
describe('블랙박스: REST API와 실제 PostgreSQL', () => {
  it('DB 연결과 확장된 실제 장소 데이터가 적재됐는지 확인한다', async () => {
    const r = await request(app).get('/api/health');
    expect(r.status).toBe(200);
    expect(r.body.places).toBeGreaterThanOrEqual(20800);
  });
  it('실제 장소 검색, 필터, 페이지네이션, 한글 검색이 동작한다', async () => {
    const r = await request(app).get('/api/places?regionId=sapporo&category=ATTRACTION&limit=3');
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(3);
    placeIds = r.body.data.map((p: any) => p.id);
    const q = await pool.query('SELECT name_ja FROM geo_data.place WHERE id=$1', [placeIds[0]]);
    expect(r.body.data[0].nameJa).toBe(q.rows[0].name_ja);
    const s = await request(app).get('/api/places').query({ q: '오도리' });
    expect(s.body.data.some((p: any) => p.name === '오도리 공원')).toBe(true);
    const next = await request(app).get(
      '/api/places?regionId=sapporo&category=ATTRACTION&limit=3&offset=3',
    );
    expect(next.body.data.map((p: any) => p.id)).not.toEqual(placeIds);
  });
  it('SQL 주입과 잘못된 파라미터가 DB에 영향을 주지 않는다', async () => {
    const r = await request(app).get('/api/places').query({ q: "'; DROP TABLE geo_data.place;--" });
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(0);
    expect((await request(app).get('/api/places?limit=-1')).status).toBe(400);
    expect((await request(app).get('/api/places?category=INVALID')).status).toBe(400);
  });
  it('출처를 포함하는 장소 상세가 존재한다', async () => {
    const r = await request(app).get('/api/places/' + placeIds[0]);
    expect(r.status).toBe(200);
    expect(r.body.data.sources.length).toBeGreaterThan(0);
    expect((await request(app).get('/api/places/' + randomUUID())).status).toBe(404);
  });
  it('미인증 사용자의 여행 조회를 거절한다', async () => {
    expect((await request(app).get('/api/trips')).status).toBe(401);
  });
  it('회원가입, 세션, 중복 가입과 로그인 실패를 검증한다', async () => {
    for (const [i, a] of [user, outsider].entries()) {
      const r = await a
        .post('/api/auth/register')
        .send({ email: emails[i], password: 'test-password-42', name: 'QA 여행자' });
      expect(r.status).toBe(201);
      expect(r.headers['set-cookie'][0]).toContain('HttpOnly');
    }
    expect((await user.get('/api/auth/me')).body.user.email).toBe(emails[0]);
    expect(
      (
        await request(app)
          .post('/api/auth/register')
          .send({ email: emails[0], password: 'test-password-42', name: 'QA' })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .post('/api/auth/login')
          .send({ email: emails[0], password: 'wrong-password' })
      ).status,
    ).toBe(401);
  });
  it('3일 여행을 만들고 월말 날짜도 저장한다', async () => {
    const r = await user
      .post('/api/trips')
      .send({ title: 'QA 홋카이도', startDate: '2026-09-30', days: 3 });
    expect(r.status).toBe(201);
    tripId = r.body.data.id;
    const trip = await user.get('/api/trips/' + tripId);
    expect(trip.body.data.days.map((d: any) => d.date)).toEqual([
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
    ]);
  });
  it('날짜별로 장소를 저장하고 재정렬·삭제를 영속화한다', async () => {
    const path = `/api/trips/${tripId}/days/2026-09-30/items`;
    expect((await versioned(user, 'put', path, { placeIds })).status).toBe(200);
    let q = await user.get('/api/trips/' + tripId);
    expect(q.body.data.days[0].items.map((x: any) => x.id)).toEqual(placeIds);
    expect(q.body.data.days[1].items).toHaveLength(0);
    const reordered = [placeIds[2], placeIds[0]];
    expect((await versioned(user, 'put', path, { placeIds: reordered })).status).toBe(200);
    q = await user.get('/api/trips/' + tripId);
    expect(q.body.data.days[0].items.map((x: any) => x.id)).toEqual(reordered);
  });
  it('존재하지 않는 장소·중복 장소를 거절하고 기존 일정을 보존한다', async () => {
    const path = `/api/trips/${tripId}/days/2026-09-30/items`;
    expect((await versioned(user, 'put', path, { placeIds: [randomUUID()] })).status).toBe(400);
    expect(
      (await versioned(user, 'put', path, { placeIds: [placeIds[0], placeIds[0]] })).status,
    ).toBe(400);
    const q = await user.get('/api/trips/' + tripId);
    expect(q.body.data.days[0].items).toHaveLength(2);
  });
  it('계정 간 조회·수정·삭제·경로 계산을 모두 차단한다', async () => {
    expect((await outsider.get('/api/trips/' + tripId)).status).toBe(404);
    expect(
      (
        await versioned(outsider, 'put', `/api/trips/${tripId}/days/2026-09-30/items`, {
          placeIds: [],
        })
      ).status,
    ).toBe(404);
    expect((await outsider.get(`/api/trips/${tripId}/days/2026-09-30/routes`)).status).toBe(404);
    expect((await outsider.delete('/api/trips/' + tripId)).status).toBe(404);
  });
  it('날짜 추가·중복 날짜·날씨 범위를 처리한다', async () => {
    const added = await user.post(`/api/trips/${tripId}/days`).send({});
    expect(added.status).toBe(201);
    expect(added.body.date).toBe('2026-10-03');
    expect((await user.post(`/api/trips/${tripId}/days`).send({ date: '2026-10-03' })).status).toBe(
      409,
    );
    const w = await user.get('/api/weather?latitude=43.06&longitude=141.35&date=2099-01-01');
    expect(w.status).toBe(200);
    expect(w.body.available).toBe(false);
  });
  it('추천은 이유를 표시하고 다른 계정의 여행을 참조하지 않는다', async () => {
    const r = await user.get('/api/discover?theme=nature&regionId=sapporo&date=2026-10-01');
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBeGreaterThan(0);
    expect(r.body.data.every((p: any) => p.recommendationReasons.length > 0)).toBe(true);
    expect(
      (await outsider.get('/api/discover').query({ theme: 'nearby', date: '2026-09-30', tripId }))
        .status,
    ).toBe(404);
    expect((await request(app).get('/api/places/' + placeIds[0] + '/enrichment')).status).toBe(401);
  });
  it('택시·도보·자전거를 허용한다', async () => {
    expect(
      (
        await versioned(user, 'patch', '/api/trips/' + tripId, {
          title: 'QA',
          transportMode: 'TAXI',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await versioned(user, 'patch', '/api/trips/' + tripId, {
          title: 'QA',
          transportMode: 'WALK',
        })
      ).status,
    ).toBe(200);
  });
  it('메모는 재정렬 후에도 보존되며 타인은 수정하지 못한다', async () => {
    const base = `/api/trips/${tripId}/days/2026-09-30/items`,
      path = base + '/' + placeIds[0] + '/note';
    expect((await versioned(user, 'patch', path, { note: '예약 14:00' })).status).toBe(200);
    expect((await versioned(outsider, 'patch', path, { note: '침입' })).status).toBe(404);
    expect(
      (await versioned(user, 'put', base, { placeIds: [placeIds[0], placeIds[2]] })).status,
    ).toBe(200);
    expect((await user.get('/api/trips/' + tripId)).body.data.days[0].items[0].note).toBe(
      '예약 14:00',
    );
    expect(
      (
        await versioned(user, 'patch', '/api/trips/' + tripId + '/cost-settings', {
          fuelEfficiency: 12,
          fuelPrice: 180,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await versioned(outsider, 'patch', '/api/trips/' + tripId + '/cost-settings', {
          fuelPrice: 1,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await versioned(user, 'patch', '/api/trips/' + tripId + '/cost-settings', {
          fuelEfficiency: 0,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await user
          .get(`/api/trips/${tripId}/days/2026-09-30/route-options`)
          .query({ from: placeIds[0], to: placeIds[2], departure: '99:99' })
      ).status,
    ).toBe(400);
    expect(
      (
        await outsider
          .get(`/api/trips/${tripId}/days/2026-09-30/route-options`)
          .query({ from: placeIds[0], to: placeIds[2] })
      ).status,
    ).toBe(404);
  });
  it('트렌드는 미수집 상태를 명시하고 폐기한 동선 추천을 거절한다', async () => {
    const r = await request(app).get('/api/places/' + placeIds[0] + '/trend');
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('quality');
    expect((await user.get('/api/discover?theme=route&date=2026-09-30')).status).toBe(400);
  });
  it('교차 출처 변경 요청을 차단한다', async () => {
    expect(
      (await user.post('/api/trips').set('Origin', 'https://other.example').send({})).status,
    ).toBe(403);
  });
  it('로그아웃 후 세션이 만료되고 다시 로그인할 수 있다', async () => {
    expect((await user.post('/api/auth/logout')).status).toBe(204);
    expect((await user.get('/api/auth/me')).status).toBe(401);
    expect(
      (await user.post('/api/auth/login').send({ email: emails[0], password: 'test-password-42' }))
        .status,
    ).toBe(200);
    expect((await user.get('/api/trips/' + tripId)).status).toBe(200);
  });
  it('여행 삭제는 메모·날짜만 cascade하고 장소 마스터는 보존한다', async () => {
    const before = (await pool.query('SELECT count(*)::int AS n FROM geo_data.place')).rows[0].n;
    const dayIds = (
      await pool.query('SELECT id FROM planner.trip_day WHERE trip_id=$1', [tripId])
    ).rows.map((r) => r.id);
    expect((await user.delete('/api/trips/' + tripId)).status).toBe(204);
    expect(
      (
        await pool.query('SELECT * FROM planner.itinerary_item WHERE day_id=ANY($1::uuid[])', [
          dayIds,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (await pool.query('SELECT * FROM planner.trip_day WHERE trip_id=$1', [tripId])).rowCount,
    ).toBe(0);
    expect((await pool.query('SELECT count(*)::int AS n FROM geo_data.place')).rows[0].n).toBe(
      before,
    );
  });
});
