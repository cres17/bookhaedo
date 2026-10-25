<p align="center">
  <img src="frontend/public/bookhaedo-crystal.png" alt="Book해도. 로고" width="160">
</p>

<h1 align="center">Book해도.</h1>

<p align="center">
  <img src="https://img.shields.io/badge/Vue%203-4FC08D?style=flat&amp;logoColor=black&amp;logo=vuedotjs" alt="Vue 3" height="20">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat&amp;logoColor=white&amp;logo=typescript" alt="TypeScript" height="20">
  <img src="https://img.shields.io/badge/Google%20Maps-4285F4?style=flat&amp;logoColor=white&amp;logo=googlemaps" alt="Google Maps" height="20">
  <img src="https://img.shields.io/badge/Node.js-5FA04E?style=flat&amp;logoColor=white&amp;logo=nodedotjs" alt="Node.js" height="20">
  <br>
  <img src="https://img.shields.io/badge/Express%205-0A0A0A?style=flat&amp;logoColor=white&amp;logo=express" alt="Express 5" height="20">
  <img src="https://img.shields.io/badge/LangGraph.js-7FC8FF?style=flat&amp;logoColor=black&amp;logo=langgraph" alt="LangGraph.js" height="20">
  <img src="https://img.shields.io/badge/PostgreSQL%2017-4169E1?style=flat&amp;logoColor=white&amp;logo=postgresql" alt="PostgreSQL 17" height="20">
  <br>
  <img src="https://img.shields.io/badge/PostGIS-336791?style=flat&amp;logoColor=white" alt="PostGIS" height="20">
  <img src="https://img.shields.io/badge/Valhalla-1F7A5C?style=flat&amp;logoColor=white" alt="Valhalla" height="20">
  <img src="https://img.shields.io/badge/GitHub%20Actions-2088FF?style=flat&amp;logoColor=white&amp;logo=githubactions" alt="GitHub Actions" height="20">
</p>

홋카이도 여행 일정을 동행자와 함께 만드는 웹 서비스입니다. 12개 관광권의 장소를 지도에서 찾고 날짜별로 배치하며, 메모와 경비를 함께 관리합니다. 여행일의 날씨가 좋지 않으면 실내 대안이나 다른 하루 코스를 확인할 수 있습니다.

[화면](#화면) · [구조](#구조) · [코스 추천](#코스-추천) · [일정 저장](#일정-저장) · [데이터](#데이터) · [실행](#실행)

## 화면

| 첫 화면 | 여행 만들기 | 플래너 |
|:---:|:---:|:---:|
| <img src="docs/readme/landing.png" alt="첫 화면" width="320"> | <img src="docs/readme/new-trip.png" alt="여행 생성 화면" width="320"> | <img src="docs/readme/planner.png" alt="일정 플래너" width="320"> |

장소 데이터를 적재하기 전의 로컬 화면입니다. 카탈로그를 넣으면 지도와 플래너에서 장소를 검색할 수 있습니다.

## 구조

![Book해도 서비스 구성](docs/assets/readme/architecture.svg)

Vue 화면은 같은 출처의 `/api`를 호출합니다. Express가 세션과 여행 접근 권한을 확인하고, PostgreSQL에 일정과 협업 데이터를 저장합니다. 로그인은 HttpOnly 쿠키로 유지하며 DB에는 세션 토큰의 해시를 보관합니다.

장소와 여행 데이터는 한 DB 안에서 스키마를 나눴습니다.

| 스키마 | 저장하는 데이터 |
|:---:|:---:|
| `geo_data` | OSM 장소 카탈로그와 PostGIS 좌표 |
| `planner` | 사용자, 세션, 여행, 일정, 동행자, 요청 제한 카운터 |
| `tourism_knowledge` | 공개 관광 자료, 출처, 발행 snapshot, 철회 기록 |

지도는 Google Maps를 사용합니다. 장소 상세와 리뷰는 Places, 대중교통 경로는 Routes에서 가져옵니다. 도보·차량·자전거 경로는 Valhalla로 계산하고, 날씨는 Open-Meteo에서 조회합니다.

## 코스 추천


![하루 코스 추천과 확정 과정](docs/assets/readme/workflow.svg)

`server/ai/tourism-graph.ts`의 LangGraph가 검색과 검증 순서를 관리합니다. 현재 코스 생성은 규칙 기반이며 외부 LLM이나 임베딩 모델은 연결되어 있지 않습니다.

1. 일정의 지역, 날짜, 유지할 장소와 관심 주제를 정리합니다.
2. 장소 카탈로그와 공개 관광 자료에서 후보를 찾습니다. 결과가 부족하면 반경을 10km에서 15km, 20km까지 넓힙니다.
3. 첫 검색에서 예보를 조회하고 코스를 구성합니다. 재검색은 최대 두 번이며 이때 예보를 반복 조회하지 않습니다.
4. 유지 조건을 검증하고 선택한 코스의 이동 경로를 조회합니다.
5. 응답 전에 출처 권리, snapshot, 적용 기간과 철회 여부를 다시 확인합니다.

추천 응답에는 장소와 이동 경로뿐 아니라 사용한 자료의 출처가 포함됩니다. 조회 중 자료가 철회되었거나 바뀌었을 가능성이 있어, 최초 검색 결과만 믿지 않고 반환 직전에 다시 검사합니다.

### 날씨에 따른 실내 대안

야외 장소의 여행일 예보에 비·눈·이슬비·뇌우가 있거나, 아래 값 중 하나를 넘으면 20km 안의 실내 장소를 찾습니다.

| 항목 | 대안을 찾는 기준 |
|:---:|:---:|
| 강수량 | 5mm 이상 |
| 적설 | 1cm 이상 |
| 강수확률 | 70% 이상 |
| 풍속 | 40km/h 이상 |

이는 서비스의 추천 기준입니다. 예보가 없으면 `NO_FORECAST`, 날씨 조건에 해당하지 않으면 `FAIR_WEATHER`, 야외 장소가 아니면 `NOT_OUTDOOR`를 반환합니다. 후보를 선택하면 앞뒤 장소와의 경로를 먼저 확인할 수 있습니다.

## 일정 저장


추천을 받는 동안 동행자가 같은 일정을 고칠 수 있습니다. 따라서 추천 조회와 일정 변경을 별도 요청으로 나누고, 저장할 때 조회 당시의 버전을 확인합니다.

쓰기 요청에는 `expectedRevision`이 필요합니다. 서버는 날짜 행을 잠근 뒤 현재 revision과 장소 순서를 대조합니다. 값이 없으면 `428 REVISION_REQUIRED`, 버전이 달라졌으면 `409 STALE_ITINERARY`를 반환합니다. 이동 수단 등 추천 조건이 바뀐 경우도 `409 RECOMMENDATION_CONTEXT_CHANGED`로 거절합니다.

예를 들어 revision 7에서 받은 추천을 확인하는 동안 동행자가 일정을 수정해 revision 8이 되었다면, 이전 추천으로 덮어쓰지 않습니다. 사용자가 변경된 일정을 다시 읽고 선택해야 합니다.

확정 요청 뒤 응답을 받지 못한 경우에는 저장 여부를 단정하지 않습니다. 화면이 결과 불명 상태를 sessionStorage에 남기고 현재 일정을 다시 조회해 확인하도록 합니다. 관련 코드는 `itinerary-version.ts`, `itinerary-write.ts`, `recommendation-recovery.ts`에 있습니다.

## 데이터


### 장소 카탈로그

`prepare_hokkaido_data.py`가 OSM 추출본에서 관광지·음식점 등 POI를 추출하고 geometry를 정리합니다. `load_postgis.py`가 이를 `geo_data`에 넣습니다. 장소 카탈로그와 추천의 근거 자료는 별도로 적재합니다.

### 공개 관광 자료

`scripts/tourism/collector.py`는 승인된 출처만 수집하고 원본 SHA-256과 수집 이력을 남깁니다. `normalize.py`가 인코딩, 필수 열, 날짜와 좌표를 검사하면 `publish.ts`가 새 snapshot을 트랜잭션으로 발행합니다. 자료 철회는 `withdraw.ts`에서 처리합니다.

수집·정제·발행을 분리해 일부 자료가 실패했을 때 불완전한 버전이 공개되지 않도록 했습니다. 실행 방법과 자료별 조건은 [관광 자료 문서](docs/tourism-langgraph.md)에 있습니다.

## 기술별 역할

![기술 구성과 담당 기능](docs/assets/readme/components.svg)

### 여행 화면과 협업

Vue 3와 Vue Router가 여행 생성·장소 탐색·날짜별 플래너 화면을 연결합니다. TypeScript는 화면과 서버의 데이터 형식을 다루고 Vite는 개발 서버와 배포 빌드를 맡습니다. 로그인 여부는 라우트에서 확인하고 여행별 접근 권한은 서버에서 다시 검사합니다.

동행자의 수정은 `useTripSynchronization`의 폴링으로 가져옵니다. 장소 배치·메모·경비를 같은 여행 안에서 관리하되, 일정 확정은 조회 시점의 revision을 포함해 저장합니다. 다른 사람이 먼저 바꾼 일정을 덮어쓰지 않기 위한 절차입니다.

| 기술 | 화면과 지도에서 하는 일 |
|:---:|:---:|
| Vue 3 · Vue Router | 로그인·여행·플래너 화면과 이동 |
| TypeScript · Vite | 공통 타입, 개발 서버와 프런트엔드 빌드 |
| Google Maps JavaScript API | 장소 마커와 이동 경로 표시 |
| Google Maps geometry | Routes의 encoded polyline을 지도 좌표로 변환 |
| Google Places (New) | 장소 사진·평점·리뷰 조회와 일본어 리뷰 비율 계산 |
| Google Routes | 대중교통 구간의 경로 조회 |
| Valhalla | 도보·차량·자전거 경로 계산. 홋카이도 OSM으로 만든 로컬 타일 사용 |
| Open-Meteo | 날짜별 예보와 실내 대안 판단. 같은 좌표의 10일 예보를 캐시에 재사용 |

### API·인증·저장

Express는 인증, 장소 카탈로그, 여행, 외부 제공자, 추천 요청을 라우터로 나눕니다. 요청 문맥과 지표 수집을 먼저 붙이고 출처·요청 제한·권한을 확인한 뒤 기능별 로직으로 넘깁니다. JSON 요청 본문 크기는 24KB로 제한합니다.

| 기술 | 서버에서 하는 일 |
|:---:|:---:|
| Node.js · Express 5 | REST API와 외부 서비스 중계 |
| Zod | 요청 본문과 외부 API 응답의 형식 검증 |
| helmet · express-rate-limit | 보안 헤더와 요청 횟수 제한 |
| scrypt · 쿠키 세션 | 비밀번호 해시, HttpOnly·SameSite=Lax 세션. DB에는 세션 토큰의 해시 저장 |
| pg · PostgreSQL 17 | 회원·세션·여행·동행자·일정 저장, 트랜잭션과 revision 검사 |
| PostGIS | OSM 장소 카탈로그의 공간 검색과 거리 계산 |
| LangGraph.js | 검색·코스 생성·검증 순서와 재검색 흐름 관리 |
| Python 데이터 도구 | OSM 전처리, PostGIS 적재, 관광 자료 수집·정제 |

LangGraph가 있다고 해서 외부 LLM을 호출하는 구성은 아닙니다. 현재 코스 생성기는 규칙 기반입니다. 장소 카탈로그와 공개 관광 자료에서 후보를 찾고, 예보·이동 경로·출처 유효성을 확인한 결과를 반환합니다. 관광 자료의 수집·정제·발행·철회는 별도 단계로 관리합니다.

### 운영과 변경 검증

`/internal/metrics`는 Prometheus 형식으로 요청 수·응답 시간·중단 요청·진행 중 요청을 내보냅니다. DB 연결 풀과 외부 제공자 캐시의 hit·miss·joined·failed·bypass도 함께 기록합니다. 운영 환경에서는 지표 조회에 Bearer 토큰이 필요합니다.

| 도구 | 확인하는 내용 |
|:---:|:---:|
| OpenAPI · DBML | REST API 명세와 DB 모델. `spec:check`로 구현과의 차이 검사 |
| Vitest · Supertest | 도메인 규칙, API 응답, 동시 수정, 보안·실패 처리 검사 |
| Playwright | 브라우저에서 여행·추천·저장 흐름 확인 |
| ESLint · Prettier · vue-tsc | 코드 규칙, 포맷, Vue·TypeScript 타입 검사 |
| Docker Compose | 로컬 PostgreSQL/PostGIS와 Valhalla 실행 구성 |
| SQL 마이그레이션 · 백업 도구 | 스키마 변경과 백업·복원 훈련 |
| GitHub Actions | 빌드·검사·명세 확인을 자동 실행 |

화면은 [frontend/src](frontend/src), API 조립은 [server/app.ts](server/app.ts), 지표는 [metrics.ts](server/observability/metrics.ts), 데이터·운영 작업은 [scripts](scripts)에 있습니다.

## 실행

Node.js `^22.13 || ^24 || >=26`과 Docker가 필요합니다.

```bash
cp .env.example .env
npm install
npm run db:up
npm run db:init
npm run dev
```

PostGIS는 `localhost:5433`, API는 `3001`, Vite는 `5173`을 사용합니다. `.env`의 브라우저 지도 키를 먼저 입력합니다.

| 환경변수 | 설정 |
|:---:|:---:|
| `DATABASE_URL` | PostgreSQL 접속 주소 |
| `VITE_GOOGLE_MAPS_API_KEY` | 브라우저의 Google Maps 키 |
| `GOOGLE_MAPS_SERVER_API_KEY` | 서버용 키. 운영에서는 브라우저용 키와 분리 |
| `APP_ORIGINS` | 허용할 출처 목록 |
| `VALHALLA_BASE_URL` | 도보·차량·자전거 경로 서버 주소 |
| `METRICS_TOKEN` | 운영 지표 조회용 토큰, 32자 이상 |

장소 카탈로그를 적재하려면 저장소 루트에 `hokkaido-*.osm.pbf`와 `Hokkaido_OD_GeoDataBase.csv`를 준비합니다. 기본 OSM 파일명은 `hokkaido-260907.osm.pbf`입니다.

```bash
npm run data:setup
npm run data:prepare
npm run data:load
```

자체 Valhalla는 아래 명령으로 실행하고 `VALHALLA_BASE_URL=http://127.0.0.1:8002`를 지정합니다. 운영 시에는 자체 서버나 사용 권한이 있는 엔드포인트를 사용합니다.

```bash
docker compose -f docker-compose.valhalla.yml up -d
```

## 테스트와 운영

```bash
npm run lint
npm run typecheck
npm run spec:check
npm run test:ci
npm run test:e2e
```

Vitest와 Supertest는 도메인 규칙, 권한, API 계약, 동시 수정과 추천 그래프를 검사합니다. PostgreSQL이 필요합니다. Playwright는 데스크톱·모바일에서 추천 확정, 저장 복구와 초대를 확인합니다.

CI는 PostGIS 서비스와 함께 마이그레이션, 테스트, 수집기 검사, 부하 기준, OpenAPI·DBML 정합성 및 빌드를 수행합니다. 백업과 복원 훈련은 `operations-drill.yml`에서 따로 실행합니다.

추천 요청의 처리 예산은 15초입니다. 연결이 끊기면 진행 중인 외부 요청에도 취소를 전달합니다. Valhalla의 동시 실행 수와 대기열을 제한하고, Places·Routes·예보 응답에는 TTL 캐시를 둡니다. 요청 제한 카운터는 여러 서버 프로세스가 공유할 수 있도록 PostgreSQL에 저장합니다.

경로별 요청 수, 지연 시간과 중단 수는 `/internal/metrics`에서 확인합니다. API 명세는 [OpenAPI](docs/openapi-rest.json), 데이터 모델은 [DBML](docs/erd.dbml)에 있습니다.
