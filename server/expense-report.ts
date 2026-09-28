import { rollback, release } from './transactions.js';
import { pool } from './db.js';
import { settle } from './settlement.js';
export async function expenseReport(tripId: string, userId: string) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const data = (
      await db.query(
        `SELECT id,label,amount,payer_id AS "payerId",scope,place_id AS "placeId",visit_date::text AS "visitDate",place_name AS "placeName",estimated_cost AS "estimatedCost",created_at AS "createdAt" FROM planner.expense WHERE trip_id=$1 AND (scope='SHARED' OR personal_owner_id=$2) ORDER BY created_at DESC,id`,
        [tripId, userId],
      )
    ).rows;
    const shares = (
      await db.query(
        `SELECT s.expense_id AS "expenseId",s.participant_id AS id,s.amount FROM planner.expense_share s JOIN planner.expense e ON e.id=s.expense_id WHERE e.trip_id=$1 AND (e.scope='SHARED' OR e.personal_owner_id=$2)`,
        [tripId, userId],
      )
    ).rows;
    const budgets = (
      await db.query(
        `SELECT i.place_id AS "placeId",d.visit_date::text AS "visitDate",COALESCE(p.name_ko,p.name_ja) AS name,i.estimated_cost AS "estimatedCost" FROM planner.itinerary_item i JOIN planner.trip_day d ON d.id=i.day_id JOIN geo_data.place p ON p.id=i.place_id WHERE d.trip_id=$1 AND i.estimated_cost IS NOT NULL ORDER BY d.visit_date,i.position`,
        [tripId],
      )
    ).rows;
    const balances = new Map<string, number>();
    for (const e of data) {
      e.shares = shares.filter((s) => s.expenseId === e.id);
      if (e.scope !== 'SHARED') continue;
      balances.set(e.payerId, (balances.get(e.payerId) || 0) + e.amount);
      for (const s of e.shares) balances.set(s.id, (balances.get(s.id) || 0) - s.amount);
    }
    for (const b of budgets) {
      const linked = data.filter((e) => e.placeId === b.placeId && e.visitDate === b.visitDate);
      b.sharedActual = linked
        .filter((e) => e.scope === 'SHARED')
        .reduce((sum, e) => sum + e.amount, 0);
      b.personalActual = linked
        .filter((e) => e.scope === 'PERSONAL')
        .reduce((sum, e) => sum + e.amount, 0);
      b.sharedCount = linked.filter((e) => e.scope === 'SHARED').length;
      b.personalCount = linked.filter((e) => e.scope === 'PERSONAL').length;
    }
    await db.query('COMMIT');
    return {
      data,
      budgets,
      total: data.filter((e) => e.scope === 'SHARED').reduce((sum, e) => sum + e.amount, 0),
      personalTotal: data
        .filter((e) => e.scope === 'PERSONAL')
        .reduce((sum, e) => sum + e.amount, 0),
      mySharedTotal: data
        .filter((e) => e.scope === 'SHARED')
        .reduce(
          (sum, e) =>
            sum +
            e.shares
              .filter((s: any) => s.id === userId)
              .reduce((n: number, s: any) => n + s.amount, 0),
          0,
        ),
      transfers: settle([...balances].map(([id, balance]) => ({ id, balance }))),
    };
  } catch (e) {
    await rollback(db);
    throw e;
  } finally {
    release(db);
  }
}
