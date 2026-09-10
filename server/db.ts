import 'dotenv/config';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
export const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL || 'postgresql://kita_plan:kita_plan_local@127.0.0.1:5433/kita_plan',
  max: 10,
  connectionTimeoutMillis: 5000,
  statement_timeout: 15000,
  idle_in_transaction_session_timeout: 15000,
});
pool.on('error', (error) =>
  console.error(JSON.stringify({ event: 'DB_POOL_ERROR', code: error.name })),
);
export async function migrate() {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT pg_advisory_xact_lock(hashtext('bookhaedo-schema'))");
    await db.query(await readFile(new URL('../db/planner.sql', import.meta.url), 'utf8'));
    await db.query(await readFile(new URL('../db/admin.sql', import.meta.url), 'utf8'));
    await db.query(await readFile(new URL('../db/collaboration.sql', import.meta.url), 'utf8'));
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
