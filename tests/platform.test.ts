import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../server/app';
import { migrate, pool } from '../server/db';
import { passwordHash, verifyPassword } from '../server/auth/password';
import { release, rollback } from '../server/transactions';
beforeAll(migrate);
afterEach(() => vi.restoreAllMocks());
it('malformed session cookies are rejected before querying the database', async () => {
  const query = vi.spyOn(pool, 'query');
  for (const token of ['short', 'j:%7B%22a%22%3A1%7D', 'x'.repeat(64)]) {
    const r = await request(app).get('/api/trips').set('Cookie', `kita_session=${token}`);
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('UNAUTHENTICATED');
    expect(r.body.requestId).toBe(r.headers['x-request-id']);
    expect(
      (await request(app).post('/api/auth/logout').set('Cookie', `kita_session=${token}`)).status,
    ).toBe(204);
  }
  expect(query.mock.calls.some(([sql]) => String(sql).includes('FROM planner.session s'))).toBe(
    false,
  );
});
it('liveness is independent of DB and readiness reports DB failure without details', async () => {
  const query = vi.spyOn(pool, 'query').mockRejectedValue(new Error('secret SQL') as never);
  expect((await request(app).get('/api/health/live')).status).toBe(200);
  expect(query).not.toHaveBeenCalled();
  const r = await request(app).get('/api/health/ready');
  expect(r.status).toBe(503);
  expect(JSON.stringify(r.body)).not.toContain('secret');
});
it('password derivation supports legacy hash format and rejects malformed hashes', async () => {
  const hash = await passwordHash('regression-password');
  expect(await verifyPassword('regression-password', hash)).toBe(true);
  expect(await verifyPassword('wrong', hash)).toBe(false);
  for (const invalid of [null, {}, 'bad:salt', ''])
    expect(await verifyPassword('x', invalid)).toBe(false);
});
it('rollback failure discards the connection without replacing the original error', async () => {
  const db = { query: vi.fn().mockRejectedValue(new Error('lost connection')), release: vi.fn() };
  await expect(rollback(db as never)).resolves.toBeUndefined();
  release(db as never);
  expect(db.release).toHaveBeenCalledExactlyOnceWith(true);
});
