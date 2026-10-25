-- 여행 목록·상세 쿼리 계획 측정용 합성 데이터. 빈 별도 DB에서 `npm run db:init` 후 실행한다. 운영·테스트 DB에 넣지 않는다.
-- 합성 데이터: 사용자 20,000 / 여행 50,000 (사용자당 평균 2.5) / 여행당 3일 / 하루 6곳 / 여행 40%에 동행자 1명
SET synchronous_commit = off;
INSERT INTO geo_data.place(id,region_id,category,name_ja,name_ko,normalized_name,latitude,longitude,location,region_distance_km,osm_tags)
SELECT 'p'||g,'sapporo','ATTRACTION','場所'||g,'장소'||g,'p'||g,43+g*0.00001,141.35,ST_SetSRID(ST_MakePoint(141.35,43+g*0.00001),4326)::geography,0,'{}'
FROM generate_series(1,5000) g;
INSERT INTO planner.app_user(id,email,display_name,password_hash)
SELECT md5('u'||g)::uuid,'u'||g||'@example.test','u'||g,'x' FROM generate_series(1,20000) g;
INSERT INTO planner.trip(id,user_id,title,updated_at)
SELECT md5('t'||g)::uuid, md5('u'||(1+(g*7919)%20000))::uuid,'trip'||g, now()-(g||' minutes')::interval FROM generate_series(1,50000) g;
INSERT INTO planner.trip_member(trip_id,user_id)
SELECT md5('t'||g)::uuid, md5('u'||(1+(g::bigint*104729+13)%20000))::uuid FROM generate_series(1,50000) g
WHERE g%5<2 AND (g::bigint*104729+13)%20000 <> (g::bigint*7919)%20000;
INSERT INTO planner.trip_day(id,trip_id,visit_date,revision)
SELECT md5('d'||g||'-'||k)::uuid, md5('t'||g)::uuid, date '2026-11-01'+k, 1 FROM generate_series(1,50000) g, generate_series(0,2) k;
INSERT INTO planner.itinerary_item(id,day_id,place_id,position,note)
SELECT gen_random_uuid(), md5('d'||g||'-'||k)::uuid, 'p'||(1+((g*31+k*7+pos*1009)%5000)), pos, ''
FROM generate_series(1,50000) g, generate_series(0,2) k, generate_series(0,5) pos;
ANALYZE;
SELECT (SELECT count(*) FROM planner.trip) trips,(SELECT count(*) FROM planner.trip_member) members,(SELECT count(*) FROM planner.trip_day) days,(SELECT count(*) FROM planner.itinerary_item) items;
