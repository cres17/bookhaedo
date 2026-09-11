import { beforeAll, afterAll, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { app } from '../server/app';
import { pool, migrate } from '../server/db';
import { splitYen, settle } from '../server/settlement';
const agents = [request.agent(app), request.agent(app), request.agent(app)];
const emails = agents.map(() => `collab-${randomUUID()}@example.test`),
  users: string[] = [];
let trip = '',
  place = '';
const date = '2026-10-10';
beforeAll(async () => {
  await migrate();
  for (let i = 0; i < agents.length; i++) {
    const r = await agents[i]!.post('/api/auth/register').send({
      email: emails[i],
      password: 'collab-password-2026',
      name: '동행자 ' + i,
    });
    expect(r.status).toBe(201);
    users.push(r.body.user.id);
  }
  const r = await agents[0]!
    .post('/api/trips')
    .send({ title: '공동 여행 검증', startDate: date, days: 1 });
  expect(r.status).toBe(201);
  trip = r.body.data.id;
  place = (await pool.query('SELECT id FROM geo_data.place LIMIT 1')).rows[0].id;
});
afterAll(async () => {
  await pool.query('DELETE FROM planner.app_user WHERE email=ANY($1::text[])', [emails]);
  await pool.end();
});
it('엔 단위 정산은 나머지를 보존하고 모든 잔액을 상계한다', () => {
  expect(splitYen(100, ['b', 'a', 'c']).reduce((n, s) => n + s.amount, 0)).toBe(100);
  expect(splitYen(1, ['a', 'b'])).toEqual([
    { id: 'a', amount: 1 },
    { id: 'b', amount: 0 },
  ]);
  expect(
    settle([
      { id: 'a', balance: 67 },
      { id: 'b', balance: -34 },
      { id: 'c', balance: -33 },
    ]),
  ).toEqual([
    { from: 'b', to: 'a', amount: 34 },
    { from: 'c', to: 'a', amount: 33 },
  ]);
});
it('초대 수락 전에는 접근 불가, 다른 이메일 수락 불가, 수락 후 공동 편집 가능', async () => {
  expect((await agents[1]!.get('/api/trips/' + trip)).status).toBe(404);
  const inv = await agents[0]!.post(`/api/trips/${trip}/invitations`).send({ email: emails[1] });
  expect(inv.status).toBe(201);
  const token = inv.body.path.split('/').pop();
  expect(
    (await agents[2]!.post('/api/invitations/respond').send({ token, accept: true })).status,
  ).toBe(404);
  const inbox = await agents[1]!.get('/api/notifications');
  expect(inbox.body.invitations).toHaveLength(1);
  const id = inbox.body.invitations[0].id;
  expect(
    (await agents[1]!.post('/api/invitations/respond').send({ id, accept: true })).status,
  ).toBe(200);
  expect(
    (await agents[1]!.post('/api/invitations/respond').send({ id, accept: true })).status,
  ).toBe(404);
  expect((await agents[1]!.get('/api/trips')).body.data.some((t: any) => t.id === trip)).toBe(true);
  expect((await agents[1]!.get('/api/trips/' + trip)).body.data.isOwner).toBe(false);
  expect((await agents[1]!.get('/api/invitations/link/' + token)).body).toMatchObject({
    alreadyMember: true,
    tripId: trip,
  });
  expect((await agents[2]!.get('/api/invitations/link/' + token)).status).toBe(404);
  expect((await agents[1]!.delete('/api/trips/' + trip)).status).toBe(403);
  expect((await agents[1]!.post(`/api/trips/${trip}/invitations`).send({})).status).toBe(403);
  expect((await agents[0]!.get('/api/notifications')).body.notifications.length).toBeGreaterThan(0);
});
it('미가입 이메일 초대를 거절하고 초대 레코드를 만들지 않는다', async () => {
  const email = `missing-${randomUUID()}@example.test`;
  const r = await agents[0]!.post(`/api/trips/${trip}/invitations`).send({ email });
  expect(r.status).toBe(400);
  expect(r.body.error).toContain('가입된 사용자가 없는');
  expect(
    (await pool.query('SELECT id FROM planner.trip_invitation WHERE email=$1', [email])).rowCount,
  ).toBe(0);
});
it('소유자는 링크를 미리 보고 수락한 동행자는 같은 링크로 여행에 다시 들어간다', async () => {
  const link = await agents[0]!.post(`/api/trips/${trip}/invitations`).send({});
  const token = link.body.path.split('/').pop();
  const owner = await agents[0]!.get('/api/invitations/link/' + token);
  expect(owner.body).toMatchObject({ alreadyMember: true, isOwner: true, tripId: trip });
  const member = await agents[1]!.get('/api/invitations/link/' + token);
  expect(member.body).toMatchObject({ alreadyMember: true, isOwner: false, tripId: trip });
  const emailInvite = (
    await pool.query(
      'SELECT token_hash FROM planner.trip_invitation WHERE trip_id=$1 AND email=$2',
      [trip, emails[1]],
    )
  ).rows[0];
  expect(emailInvite).toBeDefined();
});
it('공동 메모·예산은 저장되고 순서 변경에도 유지되며 오래된 revision은 거절한다', async () => {
  expect(
    (await agents[1]!.post(`/api/trips/${trip}/days/${date}/items`).send({ placeId: place }))
      .status,
  ).toBe(201);
  const endpoint = `/api/trips/${trip}/days/${date}/items/${place}`;
  expect(
    (
      await agents[1]!
        .patch(endpoint + '/note')
        .send({ note: '함께 보는 메모', expectedRevision: 1 })
    ).status,
  ).toBe(200);
  expect(
    (
      await agents[0]!
        .patch(endpoint + '/budget')
        .send({ estimatedCost: 1500, expectedRevision: 1 })
    ).status,
  ).toBe(409);
  expect(
    (
      await agents[0]!
        .patch(endpoint + '/budget')
        .send({ estimatedCost: 1500, expectedRevision: 2 })
    ).status,
  ).toBe(200);
  expect(
    (
      await agents[1]!
        .put(`/api/trips/${trip}/days/${date}/items`)
        .send({ placeIds: [place], expectedRevision: 3 })
    ).status,
  ).toBe(200);
  const item = (await agents[0]!.get('/api/trips/' + trip)).body.data.days[0].items[0];
  expect(item.note).toBe('함께 보는 메모');
  expect(item.estimatedCost).toBe(1500);
});
it('공동 체크리스트·채팅·정산을 저장하고 외부인은 모두 차단한다', async () => {
  const base = '/api/trips/' + trip;
  expect((await agents[0]!.post(base + '/checklist').send({ label: '여권 확인' })).status).toBe(
    201,
  );
  const task = (await agents[1]!.get(base + '/checklist')).body.data[0];
  expect((await agents[1]!.patch(base + '/checklist/' + task.id).send({ done: true })).status).toBe(
    200,
  );
  expect((await agents[0]!.get(base + '/checklist')).body.data[0].done).toBe(true);
  expect((await agents[1]!.post(base + '/messages').send({ body: '공동 여행 채팅' })).status).toBe(
    201,
  );
  expect((await agents[0]!.get(base + '/messages')).body.data[0].body).toBe('공동 여행 채팅');
  expect(
    (
      await agents[0]!
        .post(base + '/expenses')
        .send({ label: '식사', amount: 1001, payerId: users[0], participantIds: users.slice(0, 2) })
    ).status,
  ).toBe(201);
  const expense = (await agents[1]!.get(base + '/expenses')).body;
  expect(expense.total).toBe(1001);
  expect(expense.data[0].shares.reduce((n: number, s: any) => n + s.amount, 0)).toBe(1001);
  expect(expense.transfers).toHaveLength(1);
  expect(
    (
      await agents[0]!
        .post(base + '/expenses')
        .send({ label: '위조 참여자', amount: 100, payerId: users[2], participantIds: [users[2]] })
    ).status,
  ).toBe(400);
  for (const resource of ['members', 'checklist', 'expenses', 'messages'])
    expect((await agents[2]!.get(base + '/' + resource)).status).toBe(404);
  expect((await request(app).get('/api/notifications')).status).toBe(401);
});
it('공유 링크는 취소·만료 후 수락 불가하며 링크 ID만 알아서는 수락할 수 없다', async () => {
  const base = `/api/trips/${trip}/invitations`;
  const r = await agents[0]!.post(base).send({});
  const token = r.body.path.split('/').pop();
  const id = (await agents[0]!.get(base)).body.data.find((i: any) => !i.email).id;
  expect(
    (await agents[2]!.post('/api/invitations/respond').send({ id, accept: true })).status,
  ).toBe(404);
  await agents[0]!.delete(base + '/' + id);
  expect(
    (await agents[2]!.post('/api/invitations/respond').send({ token, accept: true })).status,
  ).toBe(404);
  const r2 = await agents[0]!.post(base).send({});
  const token2 = r2.body.path.split('/').pop();
  await pool.query(
    "UPDATE planner.trip_invitation SET expires_at=now()-interval '1 day' WHERE trip_id=$1 AND status='PENDING'",
    [trip],
  );
  expect(
    (await agents[2]!.post('/api/invitations/respond').send({ token: token2, accept: true }))
      .status,
  ).toBe(404);
});
it('공유 링크 동시 수락은 한 번만 허용한다', async () => {
  const link = await agents[0]!.post(`/api/trips/${trip}/invitations`).send({});
  const token = link.body.path.split('/').pop();
  const results = await Promise.all([
    agents[2]!.post('/api/invitations/respond').send({ token, accept: true }),
    agents[2]!.post('/api/invitations/respond').send({ token, accept: true }),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 404]);
  expect((await agents[2]!.get('/api/trips/' + trip)).status).toBe(200);
});
it('같은 시각의 채팅 105개도 페이지 이동 시 누락하거나 중복하지 않는다', async () => {
  const created = await agents[0]!
    .post('/api/trips')
    .send({ title: '채팅 페이지 테스트', startDate: date, days: 1 });
  const id = created.body.data.id;
  try {
    await pool.query(
      "INSERT INTO planner.trip_message(id,trip_id,user_id,body,created_at) SELECT gen_random_uuid(),$1,$2,'메시지 '||n,now() FROM generate_series(1,105) n",
      [id, users[0]],
    );
    const first = (await agents[0]!.get(`/api/trips/${id}/messages`)).body;
    const next = (
      await agents[0]!.get(`/api/trips/${id}/messages`).query({ before: first.data[0].id })
    ).body;
    expect(first.data).toHaveLength(100);
    expect(next.data).toHaveLength(5);
    expect(next.hasMore).toBe(false);
    expect(new Set([...first.data, ...next.data].map((m) => m.id)).size).toBe(105);
  } finally {
    await agents[0]!.delete('/api/trips/' + id);
  }
});
it('비밀번호를 검증한 탈퇴는 세션을 폐기하고 공유 여행과 기록을 보존한다', async () => {
  expect(
    (await agents[1]!.delete('/api/auth/me').send({ password: 'wrong-password' })).status,
  ).toBe(403);
  expect(
    (await agents[1]!.delete('/api/auth/me').send({ password: 'collab-password-2026' })).status,
  ).toBe(204);
  expect((await agents[1]!.get('/api/auth/me')).status).toBe(401);
  expect((await agents[0]!.get('/api/trips/' + trip)).status).toBe(200);
  expect((await agents[0]!.get(`/api/trips/${trip}/messages`)).body.data[0].name).toBe(
    '탈퇴한 동행자',
  );
  expect((await agents[0]!.get(`/api/trips/${trip}/expenses`)).body.total).toBe(1001);
});
