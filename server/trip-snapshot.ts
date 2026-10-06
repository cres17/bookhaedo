import { readQuery } from './read-query.js';
import type { Pool } from 'pg';
export async function tripSnapshot(db: Pool, tripId: string, userId: string, signal?: AbortSignal) {
  // One SQL statement: metadata, ACL, versions and ordered items share one snapshot.
  const query = (sql: string, values: unknown[]) =>
    signal ? readQuery(sql, values, signal, db) : db.query(sql, values);
  const result = await query(
    `SELECT t.id,t.title,(t.user_id=$2) AS "isOwner",t.transport_mode AS "transportMode",t.cost_settings AS "costSettings",
 COALESCE((SELECT jsonb_agg(day ORDER BY day.date) FROM (
   SELECT d.id,d.visit_date::text AS date,d.revision,
   COALESCE((SELECT jsonb_agg(item ORDER BY item.position) FROM (
     SELECT i.id AS "itemId",i.day_id AS "dayId",i.position,i.note,i.estimated_cost AS "estimatedCost",i.start_minute AS "startMinute",i.end_minute AS "endMinute",p.id,p.region_id AS "regionId",p.category,p.name_ja AS "nameJa",p.name_ko AS "nameKo",COALESCE(p.name_ko,p.name_ja) AS name,p.latitude,p.longitude,p.address,p.website,p.opening_hours AS "openingHours",p.osm_tags AS tags
     FROM planner.itinerary_item i JOIN geo_data.place p ON p.id=i.place_id WHERE i.day_id=d.id
   ) item),'[]'::jsonb) AS items FROM planner.trip_day d WHERE d.trip_id=t.id
 ) day),'[]'::jsonb) AS "days"
 FROM planner.trip t WHERE t.id=$1 AND (t.user_id=$2 OR EXISTS(SELECT 1 FROM planner.trip_member m WHERE m.trip_id=t.id AND m.user_id=$2))`,
    [tripId, userId],
  );
  return result.rows[0] ?? null;
}
