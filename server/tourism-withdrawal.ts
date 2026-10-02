import { z } from 'zod';
import type { Pool } from 'pg';
const input = z
  .object({ sourceId: z.string().min(1).max(100), externalId: z.string().min(1).max(150) })
  .strict();
// Lock the source first, as publication and pruning do. No snapshot ID from the caller is trusted.
export async function withdrawTourismRecord(pool: Pool, raw: unknown) {
  const { sourceId, externalId } = input.parse(raw);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const source = await db.query(
      'SELECT active_snapshot_id FROM tourism_knowledge.source WHERE id=$1 FOR UPDATE',
      [sourceId],
    );
    if (!source.rows.length) throw new Error('Unknown tourism source');
    const result = await db.query(
      'UPDATE tourism_knowledge.record SET withdrawn_at=COALESCE(withdrawn_at,now()) WHERE snapshot_id=$1 AND external_id=$2 RETURNING withdrawn_at',
      [source.rows[0].active_snapshot_id, externalId],
    );
    if (!result.rows.length) throw new Error('Unknown active tourism record');
    await db.query('COMMIT');
    return {
      sourceId,
      externalId,
      withdrawnAt: new Date(result.rows[0].withdrawn_at).toISOString(),
    };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
