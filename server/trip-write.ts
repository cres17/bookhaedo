import type { PoolClient } from 'pg';
export class TripWriteAccessError extends Error {
  constructor(public status: 403 | 404) {
    super(status === 403 ? '여행 소유자만 관리할 수 있어요.' : '여행을 찾을 수 없습니다.');
  }
}
// All itinerary writers acquire the parent before any day/item/expense/invitation row.
export async function lockTrip(db: PoolClient, tripId: string) {
  await db.query("SET LOCAL lock_timeout='3s'");
  const locked = await db.query('SELECT id FROM planner.trip WHERE id=$1 FOR UPDATE', [tripId]);
  if (!locked.rowCount) throw new TripWriteAccessError(404);
}
export async function lockTripForWrite(
  db: PoolClient,
  tripId: string,
  userId: string,
  ownerOnly = false,
) {
  await lockTrip(db, tripId);
  // A separate statement sees membership changes committed during the lock wait.
  const access = await db.query(
    `SELECT (user_id=$2) AS "isOwner" FROM planner.trip WHERE id=$1 AND (user_id=$2 OR EXISTS(SELECT 1 FROM planner.trip_member m WHERE m.trip_id=planner.trip.id AND m.user_id=$2))`,
    [tripId, userId],
  );
  if (!access.rowCount) throw new TripWriteAccessError(404);
  if (ownerOnly && !access.rows[0].isOwner) throw new TripWriteAccessError(403);
}
