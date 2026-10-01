import { z } from 'zod';
import type { Pool } from 'pg';

const policyInput = z
  .object({
    days: z.number().int().min(1).max(3650).default(30),
    keepLatest: z.number().int().min(1).max(100).default(3),
    sourceId: z.string().min(1).max(100).optional(),
    apply: z.boolean().default(false),
  })
  .strict();

// Publication and activation use the same source rows; lock them before applying retention.
// Preview is read-only. Retention age uses publication time, not the source's fetch time.
export async function pruneTourismSnapshots(pool: Pool, raw: unknown = {}) {
  const policy = policyInput.parse(raw);
  const db = await pool.connect();
  try {
    await db.query(policy.apply ? 'BEGIN' : 'BEGIN READ ONLY');
    const sources = await db.query(
      `SELECT id FROM tourism_knowledge.source
      WHERE ($1::text IS NULL OR id=$1) ORDER BY id ${policy.apply ? 'FOR UPDATE' : ''}`,
      [policy.sourceId ?? null],
    );
    if (policy.sourceId && !sources.rows.length) throw new Error('Unknown tourism source');
    const found = await db.query(
      `WITH ranked AS (
        SELECT v.*,s.active_snapshot_id,
        row_number() OVER (PARTITION BY v.source_id ORDER BY v.published_at DESC,v.id DESC) AS position
        FROM tourism_knowledge.snapshot v JOIN tourism_knowledge.source s ON s.id=v.source_id
        WHERE v.source_id=ANY($1::text[])
      ) SELECT id AS "snapshotId",source_id AS "sourceId",published_at AS "publishedAt",
      (SELECT count(*)::int FROM tourism_knowledge.record r WHERE r.snapshot_id=ranked.id) AS records
      FROM ranked WHERE id IS DISTINCT FROM active_snapshot_id AND position>$3
      AND published_at<now()-($2*interval '1 day') ORDER BY source_id,published_at,id`,
      [sources.rows.map((s) => s.id), policy.days, policy.keepLatest],
    );
    if (policy.apply && found.rows.length) {
      const removed = await db.query(
        'DELETE FROM tourism_knowledge.snapshot WHERE id=ANY($1::uuid[]) RETURNING id',
        [found.rows.map((r) => r.snapshotId)],
      );
      if (removed.rowCount !== found.rows.length)
        throw new Error('Snapshot retention changed concurrently');
    }
    await db.query('COMMIT');
    return {
      dryRun: !policy.apply,
      policy: {
        days: policy.days,
        keepLatest: policy.keepLatest,
        sourceId: policy.sourceId ?? null,
      },
      snapshotCount: found.rows.length,
      recordCount: found.rows.reduce((sum, r) => sum + r.records, 0),
      candidates: found.rows,
    };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
