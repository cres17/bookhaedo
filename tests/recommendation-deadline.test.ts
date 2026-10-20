import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
const control = vi.hoisted(() => ({
  release: undefined as undefined | (() => void),
  entered: undefined as undefined | (() => void),
}));
vi.mock('../server/operation-budget', async (original) => {
  const module = await original<any>();
  return {
    ...module,
    recommendationRequestBudget: (req: any, res: any) =>
      module.recommendationRequestBudget(req, res, 35),
  };
});
vi.mock('../server/read-query', async (original) => {
  const module = await original<any>();
  return {
    ...module,
    readQuery: async (sql: string, ...args: any[]) => {
      if (!sql.includes('SELECT d.id,d.revision')) return module.readQuery(sql, ...args);
      control.entered?.();
      await new Promise<void>((resolve) => (control.release = resolve));
      return { rows: [{ id: 'held', revision: 0, transportMode: 'WALK', items: [] }], rowCount: 1 };
    },
  };
});
import { app } from '../server/app';
import { pool, migrate } from '../server/db';
const owner = request.agent(app);
const email = randomUUID() + '@example.test';
let base = '';
beforeAll(async () => {
  await migrate();
  expect(
    (
      await owner
        .post('/api/auth/register')
        .send({ email, name: 'deadline', password: 'deadline-password' })
    ).status,
  ).toBe(201);
  const created = await owner
    .post('/api/trips')
    .send({ title: 'deadline', startDate: '2026-10-10', days: 1 });
  expect(created.status, created.body.error).toBe(201);
  base = `/api/trips/${created.body.data.id}/days/2026-10-10`;
});
afterAll(async () => {
  control.release?.();
  await pool.query('DELETE FROM planner.app_user WHERE email=$1', [email]);
  await pool.end();
});
for (const suffix of ['ai-recommendations', 'day-alternatives', 'weather-alternatives'])
  it('returns the parent deadline before held SQL cleanup completes: ' + suffix, async () => {
    let entered!: () => void;
    const started = new Promise<void>((resolve) => (entered = resolve));
    control.entered = entered;
    const pending = (
      suffix === 'ai-recommendations'
        ? owner.post(base + '/' + suffix).send({})
        : owner
            .get(base + '/' + suffix)
            .query(suffix === 'weather-alternatives' ? { targetId: randomUUID() } : {})
    ).then((r) => r);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await started;
      const result = await Promise.race([
        pending,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(Error('HTTP waited for held SQL cleanup')), 1000);
        }),
      ]);
      expect(result.status, result.body.error).toBe(504);
      expect(result.body.code).toBe('REQUEST_DEADLINE_EXCEEDED');
      expect(result.headers['cache-control']).toBe('no-store');
      expect(result.body.requestId).toBe(result.headers['x-request-id']);
      expect(control.release).toBeTypeOf('function');
    } finally {
      clearTimeout(timer);
      control.release?.();
      control.release = undefined;
      control.entered = undefined;
      await pending;
    }
  });
