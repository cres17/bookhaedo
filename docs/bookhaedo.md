# Book해도. 구현 및 검증

> 이전 구현·발표 시점의 기록입니다. 현재 동작·저장 계약은 [README](../README.md), [v2 검증 기록](quality-v2.md), [OpenAPI](Bookhaedo-API.yml)를 기준으로 확인해주세요. 기록 당시 화면 캡처는 소스 저장소에 포함하지 않습니다.

2026-09-08 · Vue 3 / Express REST / PostgreSQL + PostGIS

## 반영한 기능

- Header, 로그인, title, description, 공유 메타데이터, 웹 앱 manifest를 Book해도.로 통일. 기존 세션 쿠키·로컬 저장 키는 로그인/선택 상태를 보존하기 위해 유지했습니다. manifest는 추가했지만 오프라인 서비스워커를 구현한 것은 아닙니다.
- 추천 카드·마커는 금색, 일정 카드는 관광 파랑·음식 빨강·숙소 초록. 장소 DB에는 색상 필드나 변경이 없습니다.
- 여행 목록·일정의 ⋮ 메뉴에서 이름 수정 및 삭제. 확인 대화상자와 취소 동작. FK cascade는 해당 여행·날짜·일정·메모·설정만 처리하고 장소 master는 보존합니다. 삭제는 되돌릴 수 없는 hard delete입니다.
- 일정 장소별 2,000자 메모, 명시적 저장. 순서 변경 시 저장된 메모를 보존하고 날짜 행 잠금으로 메모/재정렬 경합을 직렬화합니다.
- Valhalla 자동차/도보/자전거. 교통수단 비교 펼치기, Google 교통비 별도 조회 버튼, JST 출발 시각 입력. DB에 경로를 영구 저장하지 않습니다.
- Google TRANSIT fare와 DRIVE tollInfo를 전달하며 미제공은 무료로 표시하지 않습니다. Google 자동차 경로의 거리/시간에만 연료비·택시 추정을 적용합니다. Valhalla의 다른 경로와 통행료를 합치지 않습니다.
- 사용자 입력 연비·유가 및 단순 택시 요율 저장. 연료비=거리(km)/연비(km/L)*유가(엔/L). 택시=기본요금+초과km*km당요금+전체분*분당요금. 실제 지역별 저속병산·할증 규칙이 아닌 확장용 단순 추정이며 자동 최신 유가·운수회사 요율 연동은 없습니다.
- Google 장소 ID만 검증된 이름·좌표 매칭 후 DB 연결. 장소 상세에 리뷰 추이 패널. 검색 결과에는 검증된 급증/증가 배지. 집계는 추천 점수에 사용하지 않습니다.
- 일정 동선 근처 추천 제거. 남는 시간·요즘 인기 자동 추천은 제공하지 않습니다. 날씨/자연/온천 등 명시적 취향 추천은 유지합니다.

## 리뷰 수집과 데이터 품질

수집 도구: [beatanalytics Actor 설명·필드](https://apify.com/beatanalytics/google-maps-reviews-scraper), [입력 명세](https://apify.com/beatanalytics/google-maps-reviews-scraper/input-schema).

일반 화면 요청에는 scraper 호출 경로가 없습니다. 관리자 CLI에서만 실행/적재합니다.

```sh
# 입력을 확인하는 dry run (Google Place ID 미연결이면 Places 조회는 수행)
npx tsx scripts/reviews-poc.ts --place LOCAL_PLACE_UUID

# 명시적으로 승인한 소량 유료 실행: 1곳, 최대 100개, 비용 제한 인자
npx tsx scripts/reviews-poc.ts --place LOCAL_PLACE_UUID --run new

# 같은 실행을 재사용해 완료 상태와 결과를 확인/적재 (새 실행 아님)
npx tsx scripts/reviews-poc.ts --place LOCAL_PLACE_UUID --start YYYY-MM-DD --end YYYY-MM-DD --run APIFY_RUN_ID
```

- 기본 범위는 어제까지 61일. UTC/JST 경계 검토를 위해 앞쪽 하루 여유를 둡니다.
- Actor는 placeIds, startDate, endDate, sortBy=newest, maxReviewsPerPlace=100을 사용합니다. 새 실행 결과의 RUN_ID를 재사용하고 자동 재실행하지 않습니다.
- Apify API maxItems=100, maxTotalChargeUsd=0.1을 함께 전달합니다. 제공자 과금 체계와 비용 제한 적용 방식은 [Apify 실행 명세](https://docs.apify.com/api/v2/actors-runs-post)를 확인하세요. 화면만 열어서는 과금 수집이 일어나지 않습니다.
- 기존 Actor 실행은 최대 50,000행까지 페이지별 다운로드 가능. 지정 Actor·Place ID·기간·정렬 방식·행 개수를 검증합니다. 다년 분석은 그 기간을 실제로 확보한 기존 실행을 수동 적재할 수 있습니다. 새 CLI 실행 자체는 100개로 제한되어 다년 분석용 전체 수집기가 아닙니다.
- 날짜 범위 완주·실패/차단 없음·JST 경계 포함 여부를 운영자가 확인한 경우에만 최초 적재 때 `--coverage-verified`를 사용합니다. 이 플래그 없이 기본적으로 자료 부족입니다. 100개 상한에 도달하면 플래그와 무관하게 부분 수집입니다. 같은 run은 재적재/가산하지 않습니다.
- 실제 timestamp, placePlaceId, rating을 검증하고 reviewId/reviewUrl/작성자 URL+timestamp로 메모리에서만 중복 제거합니다. 식별자도 없으면 거절합니다. 다른 장소, 미래 일시, 상대 날짜, 범위 밖, 잘못된 평점은 제외하고 비교를 보류합니다.
- 원문·작성자·원시 timestamp는 서비스 DB에 저장하지 않습니다. 기간별 개수/평점, 수집 감사 기록, 최신 분석 snapshot만 저장합니다. 각 실행은 독립 snapshot이며 중첩 실행을 더하지 않습니다. 기존 월별 감사 이력은 보존하지만 최신 화면은 선택된 한 실행을 보여줍니다. 계절성에는 한 실행에 다년 범위가 필요합니다.
- 일본 시간 기준 오늘 제외 최근 30일과 이전 30일을 비교합니다. 80 대 20은 4배이며 **증가율은 300%**입니다. 분모 0은 null입니다.
- 급증: 이전≥5개, 최근≥20개, 증가율≥100%. 증가: 이전≥5개, 최근≥10개, 증가율≥25%. 제품의 보수적 휴리스틱이며 통계적 유의성이나 방문객 급증을 입증하지 않습니다.
- 계절성: 완전한 12개월이 있는 2개 이상 연도, 각 연도≥60개, 모든 해당 연도에서 계절 월평균≥10개이고 비계절 월평균의 1.5배 이상. 겨울 12/1/2월, 여름 6/7/8월. 운영기간/날씨를 판정하지 않습니다.
- 7일 넘게 갱신되지 않은 결과는 현재 급증 배지를 숨깁니다. 부분 기간은 표에서 명시합니다.
- 스크래핑 및 파생 통계의 이용 허용 여부는 별도 검토 대상입니다. PoC라는 이름이나 통계화가 이용 제한을 면제하지 않습니다. Apify 원본 dataset/log의 보유기간도 별도 관리해야 합니다.

## 실제 외부 연결 결과

[실호출 기록](bookhaedo-live-check.json)과 [브라우저 지도 기록](google-browser-check.json).

- Valhalla 시계탑 부근→오도리 부근: 자동차 798m/115초, 도보 823m/630초, 자전거 805m/191초. 실제 도로 좌표 반환을 확인했습니다. 정체·적설은 미반영입니다.
- Google 자동차 같은 좌표: 800m/212초. 해당 경로 통행료 값은 미제공. 통행료가 실제 반환되는 유료 구간은 아직 실검증하지 않았습니다.
- Google 대중교통은 위 구간과 삿포로역→오타루역 모두 HTTP 200이지만 route 없음. 구현 결함으로 단정하거나 운임을 임의 생성하지 않았습니다. 이 프로젝트에서 일본 대중교통 시간/요금의 실제 성공 사례는 아직 확보하지 못했습니다.
- 공식 [Google transit 문서](https://developers.google.com/maps/documentation/routes/transit-route)는 모든 구간 요금이 파악될 때만 fare를 반환한다고 설명합니다. [통행료 문서](https://developers.google.com/maps/documentation/routes/calculate_toll_fees) 기준 필드/옵션을 적용했습니다.
- Valhalla 기본 개발 주소는 https://valhalla1.openstreetmap.de 입니다. 다운로드한 로컬 PBF로 자체 엔진을 구동한 상태는 아닙니다. [공식 운영 안내](https://github.com/valhalla/valhalla)에 따라 식별 헤더와 요청 간격을 사용합니다. 운영 환경에서는 자체/허가받은 VALHALLA_BASE_URL 없이는 공개 데모로 호출하지 않습니다.

## 테스트 및 산출물

- 빌드 성공. 단위/실제 REST·DB 44개 통과. 기존 Chrome 6개 + 신규 Book해도 흐름 1개 통과.
- 20,810개 장소 유지. 테스트는 전용 QA 계정과 여행만 만들고 삭제합니다. 기존 사용자 여행은 삭제하지 않았습니다.
- 신규 검증: 메모 재정렬 보존, 타인 메모/비용 수정 차단, 여행 cascade와 장소 보존, 폐기 추천 거절, 상한·불완전 기간·중복·시간대·분모0·계절성·추정요금 분기, 여행 메뉴 취소/이름수정/삭제.
- 리뷰 원천 실수집 및 실제 리뷰 집계 적재는 유료 실행 승인 대기라 미검증입니다. 합성 리뷰는 테스트 내부에서만 사용했고 실제 장소에 가짜 배지를 넣지 않았습니다.
- API 계약 [openapi-rest.json](openapi-rest.json): 21개 경로. DBML [erd.dbml](erd.dbml): 15개 실제 테이블, dbdiagram 붙여넣기 가능, 파싱 검증 완료.
- [화면 스크린샷](screenshots/bookhaedo-planner.png). [핵심 연결도](api-flow.svg)는 전체 경로 목록이 아닌 핵심 화면 흐름 요약입니다.
