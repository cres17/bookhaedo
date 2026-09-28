import type { Pool } from 'pg';
import { logger } from './observability/logger.js';

export function startMaintenance(pool: Pool, intervalMs = 60 * 60_000) {
  let running = false;
  const clean = async () => {
    if (running) return;
    running = true;
    try {
      const sessions = await pool.query('DELETE FROM planner.session WHERE expires_at<=now()');
      const limits = await pool.query(
        "DELETE FROM planner.rate_limit_bucket WHERE reset_at<now()-interval '1 day'",
      );
      logger.info('MAINTENANCE_COMPLETE', {
        expiredSessions: sessions.rowCount,
        expiredRateLimits: limits.rowCount,
      });
    } catch (error) {
      logger.error('MAINTENANCE_FAILED', { code: (error as { code?: string }).code || 'ERROR' });
    } finally {
      running = false;
    }
  };
  void clean();
  const timer = setInterval(clean, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
