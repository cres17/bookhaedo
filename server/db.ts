import 'dotenv/config';
import pg from 'pg';
import { runMigrations } from './migrations.js';
export const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL || 'postgresql://kita_plan:kita_plan_local@127.0.0.1:5433/kita_plan',
  max: 10,
  connectionTimeoutMillis: 5000,
  statement_timeout: 15000,
  idle_in_transaction_session_timeout: 15000,
});
pool.on('error', (error) =>
  import('./observability/logger.js').then(({ logger }) =>
    logger.error('DB_POOL_ERROR', { code: error.name }),
  ),
);
export const migrate = () => runMigrations(pool);
export const verifyMigrations = () => runMigrations(pool, undefined, true);
