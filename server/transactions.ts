import type { PoolClient } from 'pg';
const damaged = new WeakSet<PoolClient>();
// Rollback must not hide the original exception; failed connections are discarded.
export async function rollback(db: PoolClient) {
  try {
    await db.query('ROLLBACK');
  } catch {
    damaged.add(db);
  }
}
export function release(db: PoolClient) {
  const discard = damaged.delete(db);
  db.release(discard);
}
