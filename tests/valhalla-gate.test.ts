import { afterEach, expect, it, vi } from 'vitest';
import { ValhallaGate, valhallaLimits } from '../server/valhalla-gate';
afterEach(() => vi.unstubAllEnvs());
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
it('limits active work, keeps FIFO order, and holds a permit through body consumption', async () => {
  const gate = new ValhallaGate(2, 5),
    starts: number[] = [],
    release: (() => void)[] = [];
  const jobs = [0, 1, 2, 3].map((id) =>
    gate.run(async () => {
      starts.push(id);
      await new Promise<void>((resolve) => release.push(resolve));
      return id;
    }),
  );
  await tick();
  expect(starts).toEqual([0, 1]);
  release[0]();
  await tick();
  expect(starts).toEqual([0, 1, 2]);
  release[1]();
  await tick();
  expect(starts).toEqual([0, 1, 2, 3]);
  release[2]();
  release[3]();
  expect(await Promise.all(jobs)).toEqual([0, 1, 2, 3]);
});
it('rejects overflow and removes cancelled waiters without consuming a permit', async () => {
  const gate = new ValhallaGate(1, 1),
    controller = new AbortController();
  let release!: () => void;
  const first = gate.run(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await tick();
  const work = vi.fn(async () => 'wrong');
  const cancelled = gate.run(work, controller.signal);
  const rejection = expect(cancelled).rejects.toThrow();
  await expect(gate.run(work)).rejects.toThrow('VALHALLA_QUEUE_FULL');
  controller.abort();
  await rejection;
  expect(work).not.toHaveBeenCalled();
  const next = gate.run(async () => 'next');
  release();
  await first;
  expect(await next).toBe('next');
});
it('releases permits after failure and refuses already aborted work', async () => {
  const gate = new ValhallaGate(1, 0);
  await expect(
    gate.run(async () => {
      throw Error('failed body');
    }),
  ).rejects.toThrow('failed body');
  const controller = new AbortController();
  controller.abort();
  const work = vi.fn(async () => 'ok');
  await expect(gate.run(work, controller.signal)).rejects.toThrow();
  expect(work).not.toHaveBeenCalled();
  expect(await gate.run(work)).toBe('ok');
});
it.each(['0', '65', 'abc', '1.5', '-1'])('rejects invalid concurrency %s', (value) => {
  expect(() => valhallaLimits({ VALHALLA_MAX_CONCURRENT: value })).toThrow(
    'VALHALLA_MAX_CONCURRENT',
  );
});
it('allows a zero queue and validates queue size', () => {
  expect(valhallaLimits({ VALHALLA_MAX_QUEUE: '0' })).toEqual({ concurrency: 8, queue: 0 });
  expect(() => valhallaLimits({ VALHALLA_MAX_QUEUE: '513' })).toThrow('VALHALLA_MAX_QUEUE');
});
it('routing keeps its permit until JSON body completion and cancels queued requests', async () => {
  vi.stubEnv('VALHALLA_MAX_CONCURRENT', '1');
  vi.stubEnv('VALHALLA_MAX_QUEUE', '1');
  vi.stubEnv('VALHALLA_BASE_URL', 'http://127.0.0.1:8002');
  vi.resetModules();
  const { routeSegment } = await import('../server/routing');
  const releases: (() => void)[] = [];
  const fetcher = vi.fn(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            releases.push(() => {
              controller.enqueue(
                new TextEncoder().encode(
                  JSON.stringify({
                    trip: {
                      status: 0,
                      summary: { length: 1, time: 90 },
                      legs: [{ shape: '??_ibE_ibE' }],
                    },
                  }),
                ),
              );
              controller.close();
            });
          },
        }),
      ),
  );
  const a = { id: 'gate-a', latitude: 43, longitude: 141 },
    b = { ...a, id: 'gate-b' };
  const first = routeSegment(a, b, 'WALK', fetcher as any, undefined, new AbortController().signal);
  await tick();
  const controller = new AbortController();
  const second = routeSegment(a, b, 'WALK', fetcher as any, undefined, controller.signal);
  await tick();
  expect(fetcher).toHaveBeenCalledTimes(1);
  controller.abort();
  expect((await second).source).toBe('straight-line');
  releases[0]();
  expect((await first).source).toBe('valhalla');
  const third = routeSegment({ ...a, id: 'gate-c' }, b, 'WALK', fetcher as any);
  await tick();
  releases[1]();
  expect((await third).source).toBe('valhalla');
});
