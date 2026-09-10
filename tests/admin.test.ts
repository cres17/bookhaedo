import { versioned } from './versioned-request';
import { beforeAll, afterAll, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { app } from '../server/app';
import { pool, migrate } from '../server/db';
const admin = request.agent(app),
  member = request.agent(app),
  emails = [`admin-${randomUUID()}@example.test`, `member-${randomUUID()}@example.test`];
let aid = '',
  mid = '';
beforeAll(async () => {
  await migrate();
  for (const [i, a] of [admin, member].entries()) {
    const r = await a
      .post('/api/auth/register')
      .send({ name: 'Admin QA', email: emails[i], password: 'test-password-42', role: 'ADMIN' });
    expect(r.body.user.role).toBe('MEMBER');
    if (i === 0) aid = r.body.user.id;
    else mid = r.body.user.id;
  }
  await pool.query("UPDATE planner.app_user SET role='ADMIN' WHERE id=$1", [aid]);
});
afterAll(async () => {
  await pool.query('DELETE FROM planner.admin_audit WHERE actor_id=$1 OR target_id=$2', [aid, mid]);
  await pool.query('DELETE FROM planner.app_user WHERE email=ANY($1::text[])', [emails]);
  await pool.end();
});
it('익명 401, 일반 회원 403 및 비밀 필드 비노출', async () => {
  expect((await request(app).get('/api/admin/users')).status).toBe(401);
  expect((await member.get('/api/admin/users')).status).toBe(403);
  expect(
    (
      await versioned(member, 'patch', '/api/admin/users/' + aid, {
        role: 'ADMIN',
        status: 'ACTIVE',
      })
    ).status,
  ).toBe(403);
  const r = await admin.get('/api/admin/users');
  expect(r.status).toBe(200);
  expect(JSON.stringify(r.body)).not.toMatch(/password_hash|token_hash/);
});
it('자기 권한 변경과 잘못된 입력 차단', async () => {
  expect(
    (
      await versioned(admin, 'patch', '/api/admin/users/' + aid, {
        role: 'MEMBER',
        status: 'ACTIVE',
      })
    ).status,
  ).toBe(409);
  expect(
    (await versioned(admin, 'patch', '/api/admin/users/' + mid, { role: 'ROOT', status: 'ACTIVE' }))
      .status,
  ).toBe(400);
});
it('이용정지 시 세션·로그인 차단, 복원 시 재로그인, 변경 이력 기록', async () => {
  expect(
    (
      await versioned(admin, 'patch', '/api/admin/users/' + mid, {
        role: 'MEMBER',
        status: 'SUSPENDED',
      })
    ).status,
  ).toBe(200);
  expect((await member.get('/api/trips')).status).toBe(401);
  expect(
    (await member.post('/api/auth/login').send({ email: emails[1], password: 'test-password-42' }))
      .status,
  ).toBe(401);
  expect(
    (
      await versioned(admin, 'patch', '/api/admin/users/' + mid, {
        role: 'MEMBER',
        status: 'ACTIVE',
      })
    ).status,
  ).toBe(200);
  expect(
    (await member.post('/api/auth/login').send({ email: emails[1], password: 'test-password-42' }))
      .status,
  ).toBe(200);
  const logs = await admin.get('/api/admin/audit');
  expect(logs.body.data.filter((a: any) => a.targetId === mid)).toHaveLength(2);
});
