import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createRecommendationRecovery } from '../frontend/src/recommendation-recovery';
function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
const context = () => ({ userId: randomUUID(), tripId: randomUUID(), date: '2026-10-10' });
it('keeps a pending command across panel remounts and blocks another write', () => {
  const store = createRecommendationRecovery();
  const c = context();
  const command = store.begin(c)!;
  expect(store.get({ ...c })?.status).toBe('saving');
  expect(store.begin(c)).toBeUndefined();
  store.unknown(command);
  expect(store.get(c)?.status).toBe('unknown');
  expect(store.begin(c)).toBeUndefined();
  expect(store.check(c)).toEqual(command);
  expect(store.check(c)).toBeUndefined();
  store.complete(command);
  expect(store.get(c)).toBeUndefined();
});
it('restores pending and unknown writes after reload as unknown, with metadata only', () => {
  const port = storage();
  const c = context();
  const store = createRecommendationRecovery(port);
  const command = store.begin(c)!;
  const raw = [...port.values.values()][0]!;
  expect(JSON.parse(raw)).toEqual([
    { tripId: c.tripId, date: c.date, commandId: command.commandId },
  ]);
  const reloaded = createRecommendationRecovery(port);
  expect(reloaded.get(c)?.status).toBe('unknown');
  const checked = reloaded.check(c)!;
  reloaded.unknown(checked);
  expect(reloaded.get(c)?.status).toBe('unknown');
  reloaded.complete(checked);
  expect(port.values.size).toBe(0);
  expect(createRecommendationRecovery(port).get(c)).toBeUndefined();
});
it('isolates users, trips and days instead of blocking unrelated work', () => {
  const store = createRecommendationRecovery(storage());
  const c = context();
  store.unknown(store.begin(c)!);
  for (const other of [
    { ...c, userId: randomUUID() },
    { ...c, tripId: randomUUID() },
    { ...c, date: '2026-10-11' },
  ]) {
    expect(store.get(other)).toBeUndefined();
    expect(store.begin(other)).toBeDefined();
  }
  expect(store.get(c)?.status).toBe('unknown');
});
it('ignores stale completions and late failures from a previous command', () => {
  const store = createRecommendationRecovery();
  const c = context();
  const first = store.begin(c)!;
  store.complete(first);
  const second = store.begin(c)!;
  store.complete(first);
  store.unknown(first);
  expect(store.get(c)?.commandId).toBe(second.commandId);
  expect(store.get(c)?.status).toBe('saving');
});
it('retains in-memory recovery when browser storage is unavailable', () => {
  const fail = () => {
    throw Error('denied');
  };
  const store = createRecommendationRecovery({ getItem: fail, setItem: fail, removeItem: fail });
  const c = context();
  const command = store.begin(c)!;
  store.unknown(command);
  expect(store.get(c)?.status).toBe('unknown');
  store.complete(store.check(c)!);
  expect(store.get(c)).toBeUndefined();
});
it('does not restore malformed records or accept a persisted user override', () => {
  const port = storage();
  const c = context();
  const other = context();
  port.setItem(
    'bookhaedo-course-recovery:v1:' + c.userId,
    JSON.stringify([
      { tripId: c.tripId, date: c.date, commandId: randomUUID(), userId: other.userId },
      { tripId: other.tripId, date: other.date, commandId: {} },
      null,
      { tripId: '../../', date: c.date, commandId: randomUUID() },
    ]),
  );
  const store = createRecommendationRecovery(port);
  expect(store.get(c)?.status).toBe('unknown');
  expect(store.get({ ...c, userId: other.userId })).toBeUndefined();
  expect(store.get({ ...c, tripId: other.tripId })).toBeUndefined();
});

it('notifies only the original user and trip of a known success, once per command', () => {
  const store = createRecommendationRecovery();
  const c = context();
  const command = store.begin(c)!;
  expect(store.successVersion(c)).toBe(0);
  store.succeeded(command);
  expect(store.get(c)).toBeUndefined();
  expect(store.successVersion(c)).toBe(1);
  expect(store.successVersion({ ...c, tripId: randomUUID() })).toBe(0);
  expect(store.successVersion({ ...c, userId: randomUUID() })).toBe(0);
  store.succeeded(command);
  store.unknown(command);
  expect(store.successVersion(c)).toBe(1);
  store.complete(store.begin(c)!);
  expect(store.successVersion(c)).toBe(1);
});
