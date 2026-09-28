import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { migrate, pool } from '../server/db';
import { PostgresRateLimitStore } from '../server/http/rate-limit';

beforeAll(migrate);
afterAll(async () => {
  await pool.query("DELETE FROM planner.rate_limit_bucket WHERE namespace LIKE 'test-%'");
  await pool.end();
});

it('separate API instances share one atomic count without storing the raw key', async () => {
  const namespace = `test-${randomUUID()}`;
  const left = new PostgresRateLimitStore(pool, namespace, 60_000);
  const right = new PostgresRateLimitStore(pool, namespace, 60_000);
  const key = `private-user-${randomUUID()}`;
  const counts = await Promise.all(
    Array.from({ length: 20 }, (_, index) => (index % 2 ? left : right).increment(key)),
  );
  expect(counts.map((result) => result.totalHits).sort((a, b) => a - b)).toEqual(
    Array.from({ length: 20 }, (_, index) => index + 1),
  );
  const stored = await pool.query(
    'SELECT key_hash,hits FROM planner.rate_limit_bucket WHERE namespace=$1',
    [namespace],
  );
  expect(stored.rows).toHaveLength(1);
  expect(stored.rows[0]).toMatchObject({ hits: 20 });
  expect(stored.rows[0].key_hash).toMatch(/^[a-f0-9]{64}$/);
  expect(stored.rows[0].key_hash).not.toContain(key);
});
