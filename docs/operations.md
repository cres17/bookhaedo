# 운영 안내 · v2

## 배포 전제

Node.js 22.13 이상인 22.x 또는 24.x/26.x 이상, PostgreSQL/PostGIS, HTTPS 리버스 프록시가 필요합니다. Google 상세·리뷰·서버 경로 조회를 사용하려면 브라우저 키와 분리한 Google 서버 키가 필요하고, 자동차·택시·도보·자전거의 실제 경로를 사용하려면 자체 운영 또는 계약된 Valhalla 엔드포인트가 필요합니다. Vue 빌드 결과와 API는 동일 출처에서 제공합니다.

production 시작 시 DATABASE_URL과 HTTPS APP_ORIGINS를 검사합니다. Google 서버 키를 설정하면 프론트 키와 다른지 검사하고, Valhalla 주소를 설정하면 공개 개발 데모 주소가 아닌지 검사합니다. 두 선택적 제공자를 설정하지 않으면 공통 장소와 일정 저장은 유지되며, Google 상세 기능은 사용할 수 없고 실제 경로 대신 직선거리와 null 이동시간을 표시합니다. API_HOST는 인그레스 뒤에서 0.0.0.0으로 설정합니다. 클라이언트 IP 신뢰 범위는 실제 프록시 구성을 확인한 뒤 설정해야 합니다.

## 실행과 마이그레이션

1. 배포 DB 스냅샷을 확보하고 복구 가능 여부를 확인합니다.
2. `npm ci`로 lockfile에 고정된 의존성을 설치합니다.
3. 신규 DB에는 `npm run db:init`로 스키마를 준비합니다. 카탈로그 데이터 적재는 별도입니다.
4. 기존 DB는 `npm run db:migrate`로 버전 SQL을 적용합니다. 이후 `npm run build` 실행 후, 운영 환경 변수를 주입하고 `npm start`로 기동합니다.
5. `/api/health/live`와 `/api/health/ready`를 확인하고, `/api/health`로 장소 수를 별도로 확인합니다. 테스트 계정으로 추가·재정렬·메모·충돌 처리를 점검합니다.

## Valhalla 자체 운영

EC2에서 Docker를 설치한 뒤 저장소 루트의 `docker-compose.valhalla.yml`을 사용합니다. 컨테이너는 Geofabrik의 홋카이도 OSM PBF를 내려받아 `data/valhalla`에 라우팅 타일을 만들며, 재시작 시 생성물을 재사용합니다. 첫 빌드는 CPU·메모리·디스크 성능에 따라 오래 걸릴 수 있습니다.

```bash
docker compose -f docker-compose.valhalla.yml up -d
docker compose -f docker-compose.valhalla.yml logs -f valhalla
```

서비스가 준비되면 EC2 안에서 `http://127.0.0.1:8002/status`를 확인하고 앱 환경 변수에 `VALHALLA_BASE_URL=http://127.0.0.1:8002`를 설정합니다. 8002 포트는 루프백에만 바인딩하므로 EC2 보안 그룹에 공개하지 않습니다. 기본 스레드는 2개이며 메모리가 부족하면 `VALHALLA_THREADS=1`로 시작합니다. 최신 OSM 데이터로 갱신하려면 유지보수 시간에 PBF와 생성 타일을 교체하고 재빌드한 뒤 경로 회귀를 확인합니다.

v2는 `planner.trip_day.revision`을 추가합니다. 기존 여행/카탈로그를 삭제하지 않으며 기존 날짜는 revision=0에서 시작합니다. 초기화 SQL은 트랜잭션과 advisory lock으로 순서대로 적용합니다. 모든 서버 인스턴스를 v2 계약으로 맞춰야 합니다. 구버전 클라이언트의 전체 일정·메모·대안 저장은 expectedRevision이 없어 428을 받습니다.

## 동시 수정 계약

- 조회한 날짜의 `revision`을 전체 순서/메모/대안 변경 요청의 `expectedRevision`에 전달합니다.
- 해당 날짜를 잠근 뒤 비교합니다. 누락은 428, 불일치는 409입니다. 불일치한 변경을 자동 재시도하지 말고 최신 내용과 사용자 의도를 다시 확인합니다.
- 성공 시 revision이 증가합니다. 메모 변경도 일정 버전을 증가시킵니다.
- 장소 추가는 POST 한 건으로 처리합니다. 다른 탭의 추가를 덮어쓰지 않고 중복은 409를 반환합니다.
- 모달이나 미리보기의 여행/날짜가 바뀌면 기존 응답은 무효화합니다.

## 오류 조사

API 응답의 X-Request-ID를 서버의 API_ERROR 로그와 연결합니다. 일반 서버 오류는 내부 SQL·스택·키를 응답에 포함하지 않습니다. 인증 만료는 로그인 화면으로 연결하며 DB 연결 대기·쿼리·유휴 트랜잭션에는 제한 시간이 있습니다. SIGTERM/SIGINT는 신규 수락을 멈추고 DB 풀을 닫습니다.

Google/Valhalla/Open-Meteo 오류는 기본 장소와 저장 기능을 없애지 않습니다. 실제 경로를 얻지 못한 구간은 직선거리와 null 이동시간으로 표시합니다. 날씨는 경로 조회와 별개로 로드합니다.

날씨·경로·대안 외부 조회는 인증 사용자별 분당 30회로 제한하며 Retry-After를 반환합니다. 공개 관광 자료 추천 POST(`/api/trips/:id/days/:date/ai-recommendations`)는 별도 `ai-recommendation` 정책으로 사용자당 60초에 30회를 허용합니다. 같은 사용자의 여행·날짜·로그인 세션은 한도를 공유하고 동행자는 자신의 한도를 사용합니다. 빈 일정이나 입력 오류를 포함해 인증·여행 접근 검사를 통과한 추천 POST를 집계하며, 초과하면 추천·날씨·경로 처리 전에 429 `AI_RECOMMENDATION_RATE_LIMITED`를 반환합니다. `Retry-After`의 초 단위 대기 후 재시도하며 GET 외부 조회 한도와는 별개입니다. 이 정책은 사용자별 호출 횟수를 제한하며 Valhalla 전체 동시성이나 운영 서버 처리 용량을 보장하지 않습니다. 외부 호출 없이 DB만 변경하는 대안 확정은 이 조회 한도에서 제외하고, 전체 API의 기본 요청 제한과 인증·소유권·일정 버전 검사는 계속 적용합니다. 전체 한도는 DB에서 활성 사용자·만료 전 세션으로 검증한 쿠키만 세션별로 적용해 NAT 뒤 로그인 사용자를 불필요하게 묶지 않습니다. 미등록·만료·철회·정지 계정의 세션과 쿠키 없는 요청은 IP 한도를 공유하고, IPv6는 기본 /56으로 묶습니다. 검증 결과는 동일 요청의 인증 검사에서만 재사용하며 다음 요청은 DB에서 다시 확인합니다. 세션 조회에 실패하면 IP로 우회해 허용하지 않고 오류로 중단합니다. 로그인 시도는 별도 IP 한도를 적용합니다. 카운터는 `planner.rate_limit_bucket`에 원자적으로 저장하므로 여러 API 인스턴스가 같은 한도를 적용합니다. 키는 정책명과 원문 식별자의 SHA-256이며 원문 IP·세션·사용자 ID는 저장하지 않습니다. 만료 후 하루가 지난 버킷은 정기 유지보수에서 삭제합니다.

## 관측과 경보

모든 API 응답은 요청 ID를 가지며 구조화 로그는 timestamp, level, event, method, 정규화된 route, status, durationMs만 기록합니다. 본문·쿠키·query 값은 기록하지 않습니다. 5xx와 1초 이상 요청은 항상 기록하고 정상 요청은 `HTTP_LOG_SAMPLE_RATE` 비율로 표본화합니다.

Prometheus는 bearer token으로 `/internal/metrics`를 수집합니다. production은 32자 이상의 `METRICS_TOKEN` 없이는 기동하지 않습니다. `ops/prometheus/prometheus.yml.example`과 `alerts.yml`은 수집·API 중단·5xx 2%·p95 1초·DB 풀 대기 경보의 시작점입니다. 실제 Alertmanager 수신자와 dashboard는 배포 환경에서 연결합니다. 고유 ID·날짜·숫자 path는 route template으로 정규화하고 미매칭 path는 하나의 label로 합쳐 cardinality를 제한합니다.

## 백업과 복원 훈련

`pg_dump`·`pg_restore`는 서버와 같은 PostgreSQL 17 버전을 PATH에서 선택합니다. 이전 major 버전의 `pg_dump`는 서버 버전 불일치로 중단됩니다. macOS에 여러 버전이 있으면 실행 전에 `pg_dump --version`을 확인합니다.

```bash
npm run db:backup -- --output /암호화된-보관소/bookhaedo-YYYYMMDD.dump
npm run db:restore:drill -- --archive /암호화된-보관소/bookhaedo-YYYYMMDD.dump
```

백업은 PostgreSQL custom format, no-owner/no-ACL로 생성하고 SHA-256과 핵심 테이블 행 수·마이그레이션 이력 metadata를 함께 저장합니다. 복원 훈련은 원본 DB를 변경하지 않고 고유 이름의 임시 DB를 만든 뒤 체크섬, 행 수, 마이그레이션 이력을 대조하고 성공·실패와 관계없이 임시 DB를 제거합니다. 계정 데이터가 포함되므로 archive·metadata는 저장소 밖의 암호화된 보관소에 두고 최소 권한과 수명 주기를 적용해야 합니다.

주간 `operations-drill` workflow는 PostgreSQL 17 client로 빈 CI DB의 백업·복원과 부하 기준을 반복합니다. 운영에서는 일일 백업, 보관 주기, 리전 외 복제, RPO/RTO를 정하고 실제 관리형 DB snapshot도 별도로 훈련합니다.

## 부하 기준

`npm run test:load:ci`는 20개 동시 요청으로 5초 동안 중앙 제한 카운터와 실제 지역 카탈로그 집계를 함께 통과시킵니다. 기준은 오류율 0%, p95 250ms 이하입니다. 원격 환경은 오작동 방지를 위해 `ALLOW_REMOTE_LOAD_TEST=true`를 명시해야 합니다.

```bash
ALLOW_REMOTE_LOAD_TEST=true npm run test:load -- --url https://staging.example/api/regions --duration 60 --concurrency 50 --p95 500 --error-rate 0.01
```

로컬 단기 기준은 회귀 gate다. 배포 승인은 staging에서 예상 데이터량·인스턴스 수로 soak test를 수행하고 CPU, 메모리, DB pool, 외부 제공자 할당량을 함께 확인한다.

## 운영 규모 확대 시 남은 작업

현재 CI·회귀 검증은 기능 정확성 검증이며 부하·침투·재해복구 검증을 대신하지 않습니다. 실제 운영 전에는 다음을 수행해야 합니다.

- 실제 RDS/PostGIS의 다중 AZ·리전 외 백업 복원과 DB 최소 권한·TLS·비밀 회전 검증
- 중앙 로그·Prometheus·Alertmanager 수신자 연결과 staging 장시간 soak test
- 관리자 MFA/SSO, 세션 정책과 개인정보 보존·삭제 정책의 운영 조직 승인
- 자체 라우팅 운영, 외부 API 예산·할당량·이용조건 확인

리뷰 점수는 Google 전체 평점의 리뷰 수 보정값입니다. 일본어 원문은 최대 5개 제공 표본의 언어이며 현지인·국적·숨은 명소의 증거가 아닙니다. 장소 영업시간·휴무·이동 안전을 보장하는 자동 판단으로 사용하지 않습니다.


## 버전 마이그레이션 운영 계약

- 개발 시작은 자동 적용, production 시작은 이력과 체크섬만 검증합니다. 운영 DB 계정은 이력 SELECT를 포함한 앱 DML 권한, 배포 계정은 DDL 권한을 별도로 설정해야 합니다. 실제 역할 분리 검증은 배포 환경의 책임입니다.
- `001_baseline.sql`은 전환 시점 고정 SQL, `002_integrity.sql`은 인덱스·정산 제약, `003_balance_trigger.sql`은 테이블별 트리거 레코드 접근을 정리합니다. 초기 전환은 기존 테이블에 멱등 SQL을 실행하므로 잠금 시간을 점검할 유지보수 시간이 필요합니다.
- 모든 미적용 버전과 이력은 한 트랜잭션으로 적용합니다. 실패하면 rollback되며 적용 이력을 임의로 삭제하거나 checksum을 덮어쓰지 않습니다. 이미 적용한 파일의 수정·누락·순서 변경은 오류입니다.
- 기존 지출의 분담 합계가 잘못되어 있으면 전환이 중단됩니다. 원인을 확인하고 승인된 데이터 정정 후 재실행하며 자동으로 금액을 맞추지 않습니다.
- 되돌리기 SQL은 자동 제공하지 않습니다. 호환 가능한 이전 앱 배포 또는 검증한 백업 복원·후속 수정 마이그레이션을 사용합니다. 신규 migration 후 이전 앱은 엄격한 이력 검사로 기동하지 않을 수 있으므로 배포 전 복구 절차를 시험해야 합니다.
- `npx tsx scripts/verify-fresh-migrations.ts`는 고유 임시 DB를 생성해 신규 적용·재실행을 검사하고 삭제합니다. 테스트 계정에 CREATEDB 권한이 필요하며 운영 앱 계정으로 실행하지 않습니다.
- 지출 분담 합계는 지연 constraint trigger가 COMMIT 시 검사합니다. 직접 SQL 변경도 지출과 모든 분담금을 한 트랜잭션으로 수정해야 합니다. 탈퇴 후 공동 정산의 payer/participant UUID는 FK 없이 보존하며 개인 지출은 계정 삭제 시 제거합니다.

## 관광 추천 화면 CI

`quality` workflow의 `tourism-e2e` 작업은 기존 `verify`와 별도의 PostGIS 17/3.5 서비스에서 실행한다. 카탈로그 없이 스키마만 초기화하고 `npm run test:e2e:tourism`으로 데스크톱 1440px·모바일 390px를 검사한다. 테스트마다 UUID로 가상 장소 5곳과 계정을 만들고 `finally`에서 자기 자료만 삭제한다. 기존 장소를 선택·수정하거나 HARP를 수집·발행하지 않는다.

코스·근거·날씨·경로 표시 응답은 fixture이다. 계정 생성·여행 접근·일정 저장과 30회 이후 실제 추천 POST 429는 실제 API/DB를 사용한다. 출처·미확정 안내, 조건 변경, 오류 이후 코스 목록 유지·미리보기 제거·저장된 일정 보존 및 확정 PATCH를 검사한다. 실제 발행 HARP 검사와 Google·Valhalla 등 외부 연동을 쓰는 나머지 전체 E2E는 로컬 별도 검사로 유지한다.

CI는 `npx playwright install --with-deps chromium`으로 Chromium과 시스템 의존성을 설치한다. `CI=true`이면 설치된 Playwright Chromium을 쓰고 기존 3001/5173 서버를 재사용하지 않으며 `test.only`를 거절한다. 로컬 기본 실행은 기존 macOS Chrome과 서버 재사용 설정을 유지한다. 캡처는 OS에 관계없이 각 테스트의 `test-results` 출력 경로에 저장한다.

실패 시 `tourism-e2e-failure` artifact에 `playwright-report/`와 `test-results/`를 7일 보관한다. 오류 화면·trace·HTML 보고서를 내려받아 실패한 동작을 확인한다. CI는 실제 서비스 비밀값을 주입하지 않고 일회용 계정과 DB만 사용한다. artifacts와 로컬 캡처는 소스에 커밋하지 않는다. 실행 단계가 캡처 생성 전에 실패하면 artifact가 없을 수 있다.

## 관광 추천의 경로 요청 상한

자체 호스팅 Valhalla는 API 프로세스당 `VALHALLA_MAX_CONCURRENT=8`, `VALHALLA_MAX_QUEUE=128`을 기본으로 사용한다. 큐 대기를 포함해 10초 안에 응답하지 못하거나 큐가 차면 실제 시간 대신 직선거리만 반환한다. 여러 프로세스에서는 상한이 합산된다. 30회/사용자/분 추천 한도는 유지한다. [로컬 측정과 한계](research/tourism-load-20261001.md)를 참고하고 운영 지연·오류율로 재조정한다.


## 관광 추천 조회 예산과 취소

추천 GET/POST의 핸들러와 그래프는 전체 15초, 읽기 SQL은 3초 상한을 사용합니다. 조회 기한 초과는 504 `REQUEST_DEADLINE_EXCEEDED` 또는 `READ_QUERY_TIMEOUT`과 요청 ID로 응답합니다. 화면 닫기·날짜/조건 변경은 이전 조회를 취소하며 저장 PATCH는 독립적으로 처리합니다. SQL 취소는 별도 transport 최대 2개/대기 32개, 대기 1초, 연결·문장·클라이언트 대기 각 500ms입니다. 실패 시 `READ_QUERY_CANCEL_FAILED` 이벤트와 SQL 자체 상한으로 정리하며 취소 연결은 풀에 재사용하지 않습니다. 배포 DB 역할과 방화벽에서도 별도 취소 연결이 가능해야 합니다.

`bookhaedo_http_requests_in_flight`는 열린 HTTP 응답의 수입니다. 응답 전에 끊긴 요청은 `bookhaedo_http_aborted_requests_total`로 집계하고 성공 상태의 완료 수에 넣지 않습니다. 닫힌 응답 뒤의 내부 DB 정리가 잠시 계속될 수 있어 이 지표를 전체 내부 작업 수로 해석하지 않습니다. 최종 자료 권리 검사는 응답의 `evidenceValidatedAt` 시점이며 이후 철회에 대한 이미 전송된 내용의 즉시 회수는 보장하지 않습니다. 자세한 구현·검증 범위는 [운영 수정 기록](research/tourism-operational-implementation-20261006.md)에 있습니다.
