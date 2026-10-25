import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

// 복원 훈련용 표본 데이터. 빈 DB를 백업·복원하면 행 수·내용 비교가 아무것도 검증하지 못하므로
// 공동 여행의 핵심 관계(소유자·동행자·일정·메모·시간·지출·분담·채팅·체크리스트)를 한 벌 만든다.
// 운영 DB에서는 실행하지 않는다.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
if (process.env.NODE_ENV === 'production')
  throw new Error('Refusing to seed drill data in production');

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const client = await pool.connect();
const tag = randomUUID().slice(0, 8);
try {
  await client.query('BEGIN');
  const placeIds = [0, 1, 2].map((i) => `drill-${tag}-${i}`);
  for (const [i, id] of placeIds.entries())
    await client.query(
      `INSERT INTO geo_data.place(id,region_id,category,name_ja,name_ko,normalized_name,latitude,longitude,location,region_distance_km,osm_tags)
       VALUES($1,'sapporo','ATTRACTION',$2,$2,$1,$3,141.35,ST_SetSRID(ST_MakePoint(141.35,$3),4326)::geography,0,'{"tourism":"museum"}')`,
      [id, `복원 훈련 장소 ${i}`, 43.06 + i * 0.001],
    );
  const [owner, member] = [randomUUID(), randomUUID()];
  for (const [id, name] of [
    [owner, '훈련 소유자'],
    [member, '훈련 동행자'],
  ] as const)
    await client.query(
      `INSERT INTO planner.app_user(id,email,display_name,password_hash) VALUES($1,$2,$3,'drill-not-a-real-hash')`,
      [id, `drill-${tag}-${id.slice(0, 4)}@example.test`, name],
    );
  const trip = randomUUID();
  await client.query(
    `INSERT INTO planner.trip(id,user_id,title,transport_mode,cost_settings) VALUES($1,$2,'복원 훈련 여행','WALK','{"currency":"JPY"}')`,
    [trip, owner],
  );
  await client.query('INSERT INTO planner.trip_member(trip_id,user_id) VALUES($1,$2)', [
    trip,
    member,
  ]);
  const days = [randomUUID(), randomUUID()];
  for (const [i, day] of days.entries())
    await client.query(
      'INSERT INTO planner.trip_day(id,trip_id,visit_date,revision) VALUES($1,$2,$3,$4)',
      [day, trip, `2026-11-0${i + 1}`, i + 2],
    );
  for (const [position, placeId] of placeIds.entries())
    await client.query(
      `INSERT INTO planner.itinerary_item(id,day_id,place_id,position,note,start_minute,end_minute,estimated_cost)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        randomUUID(),
        days[0],
        placeId,
        position,
        position === 0 ? '복원 후에도 남아야 하는 메모' : '',
        position === 1 ? 600 : null,
        position === 1 ? 660 : null,
        position === 2 ? 1500 : null,
      ],
    );
  const expense = randomUUID();
  await client.query(
    `INSERT INTO planner.expense(id,trip_id,label,amount,payer_id) VALUES($1,$2,'훈련 점심',3001,$3)`,
    [expense, trip, owner],
  );
  for (const [participant, amount] of [
    [owner, 1501],
    [member, 1500],
  ] as const)
    await client.query(
      'INSERT INTO planner.expense_share(expense_id,participant_id,amount) VALUES($1,$2,$3)',
      [expense, participant, amount],
    );
  await client.query(
    `INSERT INTO planner.trip_message(id,trip_id,user_id,body) VALUES($1,$2,$3,'복원 훈련 채팅')`,
    [randomUUID(), trip, member],
  );
  await client.query(
    `INSERT INTO planner.checklist_item(id,trip_id,label,done) VALUES($1,$2,'여권',true)`,
    [randomUUID(), trip],
  );
  await client.query('COMMIT');
  console.log(JSON.stringify({ event: 'DRILL_DATA_SEEDED', trip, places: placeIds.length }));
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
