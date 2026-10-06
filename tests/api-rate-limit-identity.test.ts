import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../server/app';
import { createSession } from '../server/auth/session';
import { hash } from '../server/auth/password';
import { migrate, pool } from '../server/db';

const namespace = `api-test-${process.pid}`;
const users = [randomUUID(), randomUUID()];
let app: ReturnType<typeof createApp>;
const cookie = (token: string) => `kita_session=${token}`;
const tokens = () => Array.from({ length: 8 }, () => randomBytes(32).toString('hex'));

beforeAll(async () => {
  await migrate();
  vi.stubEnv('API_RATE_LIMIT', '3');
  vi.stubEnv('TRUST_PROXY_HOPS', '1');
  app = createApp();
  for (const id of users)
    await pool.query(
      'INSERT INTO planner.app_user(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)',
      [id, `api-identity-${id}@example.test`, '호출 제한 검증', 'unused-test-hash'],
    );
});
beforeEach(async () => {
  await pool.query('DELETE FROM planner.rate_limit_bucket WHERE namespace=$1', [namespace]);
  await pool.query('DELETE FROM planner.session WHERE user_id=ANY($1::uuid[])', [users]);
  await pool.query("UPDATE planner.app_user SET status='ACTIVE' WHERE id=ANY($1::uuid[])", [users]);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await pool.query('DELETE FROM planner.rate_limit_bucket WHERE namespace=$1', [namespace]);
  await pool.query('DELETE FROM planner.app_user WHERE id=ANY($1::uuid[])', [users]);
  await pool.end();
});

it.each(['forged', 'malformed', 'expired', 'revoked', 'suspended'] as const)(
  'rotating %s session cookies cannot reset the anonymous IP quota',
  async (mode) => {
    let values = tokens();
    if (['expired', 'revoked', 'suspended'].includes(mode)) {
      values = await Promise.all(values.map(() => createSession(pool, users[0]!)));
      if (mode === 'expired')
        await pool.query(
          "UPDATE planner.session SET expires_at=now()-interval '1 second' WHERE user_id=$1",
          [users[0]],
        );
      if (mode === 'revoked')
        await pool.query('DELETE FROM planner.session WHERE user_id=$1', [users[0]]);
      if (mode === 'suspended')
        await pool.query("UPDATE planner.app_user SET status='SUSPENDED' WHERE id=$1", [users[0]]);
    }
    for (const [index, token] of values.entries()) {
      const r = await request(app)
        .get('/api/regions')
        .set('Cookie', cookie(mode === 'malformed' ? `invalid-${token}` : token));
      expect(r.status, `request ${index + 1}`).toBe(index < 3 ? 200 : 429);
      if (r.status === 429) {
        expect(r.body.code).toBe('RATE_LIMITED');
        expect(r.body.requestId).toBe(r.headers['x-request-id']);
        expect(r.headers['cache-control']).toBe('no-store');
        expect(r.headers['ratelimit-policy']).toBe('3;w=60');
        expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
      }
    }
    const stored = await pool.query(
      'SELECT key_hash,hits FROM planner.rate_limit_bucket WHERE namespace=$1',
      [namespace],
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].hits).toBe(8);
    expect(stored.rows[0].key_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(values).not.toContain(stored.rows[0].key_hash);
  },
);

it('missing and forged cookies share one quota, while valid sessions behind the same IP are isolated', async () => {
  const valid = await Promise.all(users.map((id) => createSession(pool, id)));
  for (let index = 0; index < 4; index++) {
    const anonymous = request(app).get('/api/regions');
    if (index % 2) anonymous.set('Cookie', cookie(tokens()[0]!));
    expect((await anonymous).status).toBe(index < 3 ? 200 : 429);
    for (const token of valid) {
      const r = await request(app).get('/api/regions').set('Cookie', cookie(token));
      expect(r.status).toBe(index < 3 ? 200 : 429);
    }
  }
  expect(
    (
      await pool.query('SELECT hits FROM planner.rate_limit_bucket WHERE namespace=$1', [namespace])
    ).rows.map((r) => r.hits),
  ).toEqual([4, 4, 4]);
});

it.each(['expire', 'revoke', 'suspend'] as const)(
  'rechecks authentication on the next request after %s',
  async (mode) => {
    const token = await createSession(pool, users[0]!);
    const me = () => request(app).get('/api/auth/me').set('Cookie', cookie(token));
    const first = await me();
    expect(first.status).toBe(200);
    expect(first.body.user.id).toBe(users[0]);
    if (mode === 'expire')
      await pool.query(
        "UPDATE planner.session SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
        [hash(token)],
      );
    if (mode === 'revoke')
      await pool.query('DELETE FROM planner.session WHERE token_hash=$1', [hash(token)]);
    if (mode === 'suspend')
      await pool.query("UPDATE planner.app_user SET status='SUSPENDED' WHERE id=$1", [users[0]]);
    expect((await me()).status).toBe(401);
    expect(
      (
        await pool.query('SELECT hits FROM planner.rate_limit_bucket WHERE namespace=$1', [
          namespace,
        ])
      ).rows,
    ).toHaveLength(2);
  },
);

it('aggregates anonymous IPv6 addresses in the same /56 while preserving separate subnet quotas', async () => {
  for (let i = 0; i < 4; i++) {
    const r = await request(app)
      .get('/api/regions')
      .set('X-Forwarded-For', `2001:db8:1234:56${String(i).padStart(2, '0')}::1`);
    expect(r.status).toBe(i < 3 ? 200 : 429);
  }
  expect(
    (await request(app).get('/api/regions').set('X-Forwarded-For', '2001:db8:1234:5701::1')).status,
  ).toBe(200);
});

it('verifies the session once within a protected request without returning tokens or hashes', async () => {
  const token = await createSession(pool, users[0]!);
  const query = vi.spyOn(pool, 'query');
  try {
    const r = await request(app).get('/api/auth/me').set('Cookie', cookie(token));
    expect(r.status).toBe(200);
    expect(r.body.user.id).toBe(users[0]);
    expect(JSON.stringify(r.body)).not.toMatch(/password_hash|token_hash|kita_session/);
    expect(JSON.stringify(r.body)).not.toContain(token);
    expect(
      query.mock.calls.filter(
        ([sql]) => typeof sql === 'string' && sql.startsWith('SELECT u.id,u.email'),
      ),
    ).toHaveLength(1);
  } finally {
    query.mockRestore();
  }
});

it('fails closed if session verification cannot reach the database', async () => {
  const token = await createSession(pool, users[0]!);
  const query = vi
    .spyOn(pool, 'query')
    .mockRejectedValueOnce(Object.assign(new Error('private database details'), { code: '08006' }));
  try {
    const r = await request(app).get('/api/regions').set('Cookie', cookie(token));
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('SERVICE_UNAVAILABLE');
    expect(r.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(r.body)).not.toContain('private database details');
  } finally {
    query.mockRestore();
  }
  expect(
    (await pool.query('SELECT 1 FROM planner.rate_limit_bucket WHERE namespace=$1', [namespace]))
      .rowCount,
  ).toBe(0);
});
