import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
// Caller holds trip, then day locks. Retained items keep their IDs and all user fields.
export async function replaceDayItems(db: PoolClient, dayId: string, placeIds: readonly string[]) {
  const current = await db.query<{ place_id: string; position: number }>(
    'SELECT place_id,position FROM planner.itinerary_item WHERE day_id=$1 ORDER BY position FOR UPDATE',
    [dayId],
  );
  const retained = new Set(current.rows.map((p) => p.place_id));
  await db.query(
    'DELETE FROM planner.itinerary_item WHERE day_id=$1 AND place_id<>ALL($2::text[])',
    [dayId, placeIds],
  );
  const offset = Math.max(-1, ...current.rows.map((p) => p.position)) + placeIds.length + 1;
  await db.query('UPDATE planner.itinerary_item SET position=position+$2 WHERE day_id=$1', [
    dayId,
    offset,
  ]);
  for (const [position, placeId] of placeIds.entries()) {
    if (retained.has(placeId))
      await db.query(
        'UPDATE planner.itinerary_item SET position=$1 WHERE day_id=$2 AND place_id=$3',
        [position, dayId, placeId],
      );
    else
      await db.query(
        'INSERT INTO planner.itinerary_item(id,day_id,place_id,position) VALUES($1,$2,$3,$4)',
        [randomUUID(), dayId, placeId, position],
      );
  }
}
