import { afterAll, beforeAll, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { app } from '../server/app';
import { pool, migrate } from '../server/db';

// GET /api/trips: 소유 여행과 동행 여행만, 중복 없이, 최근 수정순으로 돌려준다
const agents = [request.agent(app), request.agent(app), request.agent(app)];
const emails = agents.map(() => `trip-list-${randomUUID()}@example.test`);
const ids: string[] = [];
let trips: Record<string, string> = {};

beforeAll(async () => {
  await migrate();
  for (const [i, agent] of agents.entries()) {
    const r = await agent
      .post('/api/auth/register')
      .send({ email: emails[i], name: '목록 검증', password: 'trip-list-password' });
    expect(r.status).toBe(201);
    ids.push(r.body.user.id);
  }
  const create = async (agent: ReturnType<typeof request.agent>, title: string) =>
    (await agent.post('/api/trips').send({ title, startDate: '2026-11-01', days: 2 })).body.data
      .id as string;
  trips = {
    ownedOld: await create(agents[0]!, '내 여행 1'),
    shared: await create(agents[1]!, '동행 여행'),
    ownedNew: await create(agents[0]!, '내 여행 2'),
    others: await create(agents[2]!, '남의 여행'),
  };
  await pool.query('INSERT INTO planner.trip_member(trip_id,user_id) VALUES($1,$2)', [
    trips.shared,
    ids[0],
  ]);
  // 소유자가 동행자 표에도 있는 비정상 데이터가 있어도 한 번만 나와야 한다
  await pool.query('INSERT INTO planner.trip_member(trip_id,user_id) VALUES($1,$2)', [
    trips.ownedOld,
    ids[0],
  ]);
  await pool.query(`UPDATE planner.trip SET updated_at=now()+interval '1 minute' WHERE id=$1`, [
    trips.shared,
  ]);
});

afterAll(async () => {
  await pool.query('DELETE FROM planner.app_user WHERE email=ANY($1::text[])', [emails]);
  await pool.end();
});

it('소유 여행과 동행 여행만 중복 없이 최근 수정순으로 돌려준다', async () => {
  const r = await agents[0]!.get('/api/trips');
  expect(r.status).toBe(200);
  const list = r.body.data.map((t: any) => t.id);
  expect(list).toEqual([trips.shared, trips.ownedNew, trips.ownedOld]);
  expect(list).not.toContain(trips.others);
  const shared = r.body.data.find((t: any) => t.id === trips.shared);
  expect(shared).toMatchObject({
    isOwner: false,
    startDate: '2026-11-01',
    endDate: '2026-11-02',
    days: 2,
  });
  expect(r.body.data.find((t: any) => t.id === trips.ownedOld).isOwner).toBe(true);
});

it('동행 여행이 없는 사용자는 자기 여행만 본다', async () => {
  const r = await agents[2]!.get('/api/trips');
  expect(r.body.data.map((t: any) => t.id)).toEqual([trips.others]);
});
