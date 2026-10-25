# 여행 목록·상세 쿼리 계획

측정일 2026-10-25. **합성 데이터·단일 사용자 표본·로컬 환경의 측정값이며 운영 트래픽 결과가 아니다.**

## 조건

| 항목 | 값 |
|---|---|
| DB | PostgreSQL 17.5 + PostGIS (`postgis/postgis:17-3.5` 컨테이너), 2 vCPU, 기본 설정 |
| 데이터 | `docs/benchmarks/trip-list-synthetic.sql`: 사용자 20,000 / 여행 50,000 / 동행 20,000 / 일자 150,000 / 일정 항목 900,000 / 장소 5,000, 실행 후 `ANALYZE` |
| 표본 사용자 | 소유 여행 2개 + 동행 여행 2개 (결과 4행) |
| 측정 | 워밍업 1회 후 `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` 21회의 `Execution Time` 중앙값. `EXPLAIN ANALYZE` 자체 계측 비용이 포함되며 네트워크·애플리케이션 시간은 제외 |

## Q1. 내 여행 목록 `GET /api/trips` — 변경함

기존 조건 `t.user_id=$1 OR EXISTS(SELECT 1 FROM planner.trip_member m WHERE m.trip_id=t.id AND m.user_id=$1)`는 `OR`의 한쪽이 상관 서브쿼리라 `trip_user_idx`를 쓰지 못했다. 계획은 `trip` 전체를 순차 스캔해 49,996행을 버리고, 남은 4개 여행의 일자를 붙이려고 `trip_day` 150,000행도 순차 스캔한 뒤 해시 조인했다.

```
Seq Scan on trip t  (rows=4)  Rows Removed by Filter: 49996
  Filter: ((user_id = …) OR (ANY (id = (hashed SubPlan 2).col1)))
Seq Scan on trip_day d  (rows=150000)
```

변경: 소유 여행과 동행 여행을 각 인덱스로 찾아 `UNION`한 뒤 조인한다.

```sql
FROM (SELECT id FROM planner.trip WHERE user_id=$1
      UNION SELECT trip_id FROM planner.trip_member WHERE user_id=$1) mine
JOIN planner.trip t ON t.id=mine.id
LEFT JOIN planner.trip_day d ON d.trip_id=t.id
```

```
Bitmap Index Scan on trip_user_idx         (rows=2)
Bitmap Index Scan on trip_member_user_idx  (rows=2)
→ trip_pkey, trip_day_trip_id_visit_date_key 인덱스 조회
```

| | 실행 시간 p50 | 최소–최대 | shared buffers |
|---|---|---|---|
| 기존 | 69.5 ms | 63.7–97.4 ms | 1,875 |
| 변경 | 0.42 ms | 0.37–0.55 ms | 50 |

- 두 쿼리의 결과 행이 같음을 측정 스크립트에서 확인했다. 의미(소유·동행 여행만, 중복 없음, 최근 수정순)는 `tests/trip-list.test.ts`가 고정한다. 이 검사는 기존 쿼리에서도 통과한다(동작 보존 검사).
- 기존 쿼리는 전체 여행 수에 비례해 느려지는 구조다. 위 수치는 여행 50,000개 기준이며 다른 규모의 값은 측정하지 않았다.
- 새 인덱스는 추가하지 않았다. 기존 `trip_user_idx`, `trip_member_user_idx`로 충분했다.

## Q2. 여행 상세 `tripSnapshot` — 변경 없음

`trip_pkey` 단일 행 조회 후 `trip_day_trip_id_visit_date_key` → `itinerary_item_day_id_position_key` → `place_pkey` 인덱스 조회만 사용한다. 같은 조건에서 실행 시간 0.72 ms, shared buffers 81. 같은 `OR EXISTS` 권한 조건이 있지만 PK로 한 행만 남은 뒤 평가되므로 비용이 작다. 병목이 관측되지 않아 바꾸지 않았다.

## 재현

```bash
createdb bk_explain   # 빈 별도 DB
DATABASE_URL=postgresql://…/bk_explain npm run db:init
psql …/bk_explain -f docs/benchmarks/trip-list-synthetic.sql
# 표본 사용자: md5('u3')::uuid = 532a7b8e-0328-a8d0-5a8e-6258b28b9a36
psql …/bk_explain -c "EXPLAIN (ANALYZE, BUFFERS) <Q1>"
```
