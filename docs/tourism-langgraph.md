# Book해도 LangGraph 관광 자료 추천

2026-10-01 구현. 첨부 `tourism-data-automation-plan.md`의 M1/M2/M4/M5에 해당하는 로컬 MVP이며, 문서의 AWS 구성·스케줄 제안은 배포 명령으로 취급하지 않았다. `tourism-automation-revalidation-20261001.json`은 기존 수집 계층의 검증 증거다. 최초 구현 시 수집기의 SHA-256과 테스트 코드 해시는 첨부의 최종 값과 일치했고 기존 수집 코드는 수정하지 않았다. 후속 리뷰에서는 robots 조회 실패 시 중단하는 기존 정책을 명시하고, 실패한 갱신의 오래된 규칙을 제거하는 처리와 회귀 테스트를 추가했다.

## 구현 범위

| 계층 | 파일 | 동작 |
|---|---|---|
| 출처 등록부 | `ops/tourism/sources.json` | HARP 4개 출처 승인, HOKKAIDO LOVE는 허락 대기·비활성 |
| CSV 정제 | `scripts/tourism/normalize.py` | SQLite 최신 성공 보고서와 SHA 원본 확인, BOM/CP932, 선행 0 보존, 날짜·좌표·열 검사 |
| 공개 버전 | `server/tourism-knowledge.ts`, `scripts/tourism/publish.ts` | 검증된 전체 자료만 트랜잭션으로 삽입 후 활성 snapshot 교체, source 잠금, 실패 시 이전 버전 유지 |
| 저장소 | `db/migrations/005_tourism_knowledge.sql` | `tourism_knowledge.source/snapshot/record`, GIN 전문검색, 기존 catalog/planner 보존 |
| 검색 | `server/tourism-search.ts` | 첫 장소 지역, PostGIS 거리, 승인·활성·철회·적용 기간·최근 수집 여부 검사 |
| 추천 | `server/ai/tourism-graph.ts` | 실제 `@langchain/langgraph@1.4.18` StateGraph 실행, bounded retrieval와 provider 조회, 규칙 기본 생성·검증·미리보기 |
| API | `server/routes/ai-recommendations.ts` | 인증·소유자/수락 동행자 접근 검사 이후 읽기 전용 POST |
| 화면 | `frontend/src/components/DayAlternatives.vue` | 자료 옵션·관심 주제·유지할 장소·출처·미확정/과거 시간·미리보기·확정 |

## 실행과 데이터 적재

프로젝트 루트에서 실행한다. 운영 데이터베이스에는 배포 전 마이그레이션을 먼저 적용한다.

```bash
npm install
npm run db:migrate
npm run dev
```

서버 시작 때 관광 자료를 자동 수집하지 않는다. 공개 자료를 넣기 전에도 추천 API는 기존 장소/예보로 코스를 구성하고 `CATALOG_FALLBACK` 상태와 안내를 반환한다.

로컬 상태와 정제 파일은 Git 밖의 **동일한 영속 폴더**에 저장한다. 아래 `<state-dir>`은 실제 절대 경로로 교체한다. `/private/tmp`는 임시 검증에만 사용하며 운영 상태 경로로 쓰지 않는다.

```bash
python3 scripts/tourism/collector.py --source eniwa-events --state-dir <state-dir> --rounds 1
npm run tourism:normalize -- --source eniwa-events --state-dir <state-dir> --year 2026 --output <state-dir>/curated/eniwa-events.json
npm run tourism:publish -- <state-dir>/curated/eniwa-events.json
```

후라노 자료는 `--source furano-places` 또는 `furano-events`, 북토시 자료는 `--source hokuto-places`와 각각의 출력 파일로 실행한다. 북토시는 등록부의 최신 CSV URL에 고정되어 URL 변경 시 재검토한다. 삿포로 도심 자료는 `--source sapporo-places`와 전용 `sapporo-csv-v1` 해석 규칙을 사용하며 고정 CKAN CSV만 허용한다. HARP는 최소 60초, 삿포로는 최소 10초 간격과 origin별 robots 규칙을 지킨다. 정제·발행은 네트워크를 사용하지 않는다.

에니와 `--year`를 생략하면 실행 시점의 현재 연도 자료를 선택한다. 선택 연도의 파일이 없으면 오래된 파일을 대신 쓰지 않고 오류를 낸다. 실제 행사 날짜는 CSV 값으로만 결정한다. 현재 MVP는 에니와의 한 선택 연도 snapshot을 활성화하며 여러 연도의 event occurrence 동시 색인은 후속 작업이다. 같은 ID를 가진 파일들이 선택 범위에 중복되면 공개하지 않는다.

최신 수집 회차가 실패했거나 자료 일부가 실패했으면 정제를 중단한다. 원본 SHA가 다르거나 필수 열·날짜·좌표·ID 검증에 실패해도 이전 공개 버전을 유지한다. 수집과 정제·발행은 별도 명령이며 스케줄러를 등록하지 않았다.

## 출처 표시 정보 동기화와 스냅샷 보존

`ops/tourism/sources.json`의 승인·활성 출처는 발행 시 제공 기관·출처 URL·라이선스 ID/URL을 DB로 동기화한다. 내용과 fetchedAt이 동일해 snapshot 삽입을 생략하는 경우에도 표시 정보는 갱신한다. 기존 DB의 `enabled`, `rights_status`, `active_snapshot_id`는 메타데이터 동기화로 덮어쓰지 않으므로 운영자의 철회·비활성 설정이 유지된다. 새 snapshot 발행 없이 표시 정보만 갱신하려면 아래 명령을 사용한다. 허락 대기·비활성 등록부 항목은 등록하지 않는다.

```bash
npm run tourism:sync-sources
```

내용이 같아도 fetchedAt이 새로우면 별도 snapshot으로 발행하는 기존 동작은 유지한다. 비활성 snapshot 정리는 별도의 명령이며 기본 동작은 읽기 전용 미리보기다. 기본 보존 기준은 **활성 snapshot 전체 + 최근 발행 30일 전체 + 출처별 최신 3개**다. 어느 하나의 보호 조건에 해당하면 보존한다. 기간은 자료 수집 시각이 아닌 DB `published_at`을 기준으로 계산한다. 이 기준은 변경 가능한 도구 기본값이며 자동 삭제 정책이나 스케줄로 등록하지 않았다.

```bash
npm run tourism:prune
npm run tourism:prune -- --source furano-places --days 90 --keep-latest 3
```

미리보기는 `dryRun`, 정책, 정리할 snapshot ID·출처·발행 시각, snapshot/record 건수를 반환한다. 실제 정리는 명령에 `--apply`를 명시할 때만 수행한다. 적용 시 출처 행을 잠근 뒤 정리 대상을 다시 계산하므로 발행·활성화와 동시에 실행돼도 활성 snapshot을 보호한다. 활성 snapshot의 외래키와 삭제한 snapshot의 record에 대한 `ON DELETE CASCADE`는 기존 마이그레이션 005의 제약을 사용한다. SQL 스키마·REST 계약은 변경하지 않는다. catalog/planner와 수집기 원본·SQLite 기록은 정리 대상에 포함되지 않는다.

자동 갱신을 구성할 때 보존 기간과 DB 백업/복구 기준을 확정하고 미리보기를 확인한 뒤 정리 실행을 연결한다. 이 도구를 추가한 것만으로 갱신 스케줄이나 자동 삭제가 활성화되지는 않는다. 실제 HARP 적재 후에는 전체 시설 수·좌표 보유 수·canonical_place_id 연결 수와 미연결 사례를 측정해야 하며, fixture의 연결률을 실제 매칭 품질로 보고하지 않는다.

## API와 상태

`POST /api/trips/:id/days/:date/ai-recommendations`

```json
{
  "count": 4,
  "interests": "博物館 自然",
  "keepPlaceIds": [],
  "strategy": "KNOWLEDGE"
}
```

`strategy`를 생략하면 코스 목록만 조회한다. `AUTO/INDOOR/NEARBY/KNOWLEDGE`를 지정하면 해당 코스의 실제 인접 경로를 미리 본다. 다른 유효 코스가 있지만 요청한 전략이 없으면 `422/STRATEGY_UNAVAILABLE`과 `availableStrategies`를 반환하므로 응답의 실제 `plans[].id`를 사용한다. 아직 장소를 담지 않은 날은 `NEEDS_ANCHOR`, 유효 코스가 하나도 없으면 전략 요청 여부와 관계없이 `NO_CANDIDATES`를 200으로 반환한다. 3~6곳, 최대 5개 유지 장소, 200자 관심 주제만 허용하며 미지의 필드·중복/현재 일정 밖의 유지 ID는 거절한다.

모든 성공 응답에는 `requestId/tripId/date/expectedRevision/expectedPlaceIds`, `snapshotIds`, `engine:langgraph`, `generationMode:rules`, `searchAttempts`, `plans/evidence/preview/weather/warnings/notice`가 담긴다. 빈 일정도 같은 공통 필드를 반환하며 `searchAttempts=0`이다. 공통 요청 처리에서 `Cache-Control: no-store`를 적용한다. 유효한 코스가 없거나 지정한 전략의 코스가 없으면 최대 두 차례 재검색으로 반경을 10→15→20km 확대하며 권한·날짜·라이선스 조건은 완화하지 않는다. 다른 전략의 코스가 있어도 요청한 전략을 찾을 때까지 재검색한다. 예보는 실행당 한 번, 경로는 선택 코스에만 조회한다. 예보·모델 어댑터·각 경로 대기는 10초 상한이다. 그래프의 취소 신호를 실제 provider 요청과 경로 조회 대기열까지 전달하며 기존 provider 자체 상한도 유지한다. 요청별 취소가 다른 사용자의 진행 중인 요청을 취소하지 않도록 신호가 있는 호출은 진행 중 요청을 공유하지 않는다. 완료된 캐시 결과는 계속 재사용한다. 실제 경로가 없으면 합계 거리와 이동시간을 null로 표시한다. 이는 도로거리와 직선거리를 구분한다.

유지할 장소는 기존 상대 순서대로 새 코스 앞쪽에 둔다. 자료 코스는 근거 연결 우선순위로 `방문 수 - 유지 장소 수`만큼 추가 장소를 먼저 선택하고, 선택된 집합 안에서 마지막 유지 장소 기준의 가까운 순서로 이어 붙인다. 이동 순서를 계산할 때 근거가 있는 선택 장소를 다시 잘라내지 않는다. 유지 장소만으로 요청 방문 수를 채우면 새 장소를 추가하지 않는다는 안내를 반환하고, 유지 장소에 유효한 시설 근거가 있으면 자료 코스도 유지한다. 안전 필터에 걸리거나 기준 중심에서 20km 밖인 유지 장소를 포함해 유효한 코스를 만들 수 없으면 후보 부족으로 안내한다.

관심 주제·유지 장소·방문 수·자료 옵션을 바꾸면 이전 추천과 지도 미리보기를 즉시 해제한다. 관심 주제와 유지 장소 변경 후에는 ‘조건 적용해 다시 추천’으로 조회하고 코스를 다시 선택해야 확정할 수 있다. 늦게 도착한 이전 요청의 응답은 버리고 저장 직전에도 조회 당시 조건과 현재 조건이 같은지 검사한다. 같은 조건에서 코스를 선택하거나 재조회하다 실패하면 기존 코스 목록과 출처는 유지하되, 이전 미리보기와 확정 버튼은 해제한다. 409·429·네트워크 오류 뒤에도 목록에서 다시 시도할 수 있다.

확정은 기존 `PATCH /api/trips/:id/days/:date/day-alternatives`를 사용한다.

```json
{
  "placeIds": ["조회한-장소-UUID-1", "조회한-장소-UUID-2"],
  "expectedPlaceIds": ["이전-장소-UUID"],
  "expectedRevision": 3
}
```

소유자 또는 수락한 동행자가 확정할 때 현재 날짜를 잠그고 revision과 기존 순서를 다시 검사한다. 누락은 428, 이전 버전은 409이며 충돌 때 일정을 덮어쓰지 않는다. 남는 장소의 메모·예상 비용·고정 시간은 기존 API 정책대로 유지한다. 권한 거절은 401/404다. 이번 검증 중 발견한 기존 API의 잘못된 장소 수 처리 시 DB 연결 누수를 함께 수정했다.

## 근거와 불명 정보

- `confirmed`는 자료에 시작·종료일이 기재되었다는 정제 상태이며 실제 개최 확정 진술이 아니다. 화면에서도 개최 확정 여부는 원문에서 확인하도록 안내한다. `tentative` 키워드 분류는 보수적인 휴리스틱이며 일반적인 예정·변경 문구에도 적용될 수 있다.
- 행사 기간이 여행일과 겹쳐야 반환한다. `tentative`는 화면에 미확정으로 표시하고 자동 배치에 사용하지 않는다. `recurring/unknown` 행사는 코스 근거에서 제외하되 `referenceEvents` 지역 참고 목록(최대 20개)에 분리한다. 시작·종료일이 없는 행만 표시하며 올해/여행일 개최 여부 미확인, 과거 소개 포함 가능성을 안내한다. 날짜가 있는 종료 행사는 두 목록에서 제외한다.
- 좌표가 없으면 null을 유지한다. 시설 연결은 동일 정규화 명칭 + 250m 안의 유일한 후보를 기본으로 한다. `ops/tourism/approved-aliases.json`의 검증된 별칭은 출처·외부ID·원문SHA·제목·catalog 이름·웹사이트(null 포함)·분류·주소(null 포함)·위도·경도 지문이 일치하고 같은 지역 250m 이내일 때만 적용한다. 지문 변경과 exact-name 중복은 다시 검토하며 임의 근접 연결은 하지 않는다. 동명 후보가 여러 개거나 좌표가 없으면 연결하지 않는다. 행사는 이 버전에서 기존 장소와 자동 연결하지 않는다.
- 시설 소개와 과거 영업시간을 분리한다. 자료의 연도가 있는 이용 시간은 `historical`로 보존하며 현재 영업시간·요금·휴관 근거로 사용하지 않는다. 현재시간을 확인했다는 안내를 만들지 않는다.
- 기존 장소의 `openingHours='closed'` 또는 `tags.opening_hours='closed'`는 검색 후보와 최종 코스에서 제외한다. 유지할 장소와 모델 반환 결과에도 같은 검사를 적용한다. 운영 중단 표기가 없는 장소의 현재 영업을 보증하지는 않는다.
- 관광 자료 검색과 기존 하루 코스 검색 모두 거리순으로 먼저 정렬한 뒤 최대 600곳을 선택한다. 이름·웹사이트 여부는 거리 동률의 보조 기준이다.
- 현재 검색 후보에 연결된 시설 근거와 적용 기간이 맞는 행사만 검색한다. 연결 시설 근거를 먼저 정렬한 뒤 120개 제한을 적용한다. 최종 응답은 반환 코스가 인용한 시설 근거와 별도 참고 행사만 담는다. 시설 근거를 실제 인용한 코스가 있어야 `READY`이며 행사만 있으면 `CATALOG_FALLBACK`과 행사 참고 안내를 반환한다.
- `fetchedAt`은 최근 수집 확인, `sourceUpdatedAt`은 원문 수정 시점이다. 원문 수정 시점을 확인하지 못하면 null로 둔다. 최근 90일 수집 기준은 검색 참여 기준일 뿐 최신 운영 정보 보증이 아니다.
- 출처 등록부와 DB의 권리·활성 상태를 함께 검사한다. DB에서 `rights_status='withdrawn'` 또는 `enabled=false`로 바꾸면 새 검색에서 제외한다. 개별 철회는 `npm run tourism:withdraw -- <source-id> <external-id>`로 실행한다. 출처 잠금을 먼저 잡고 현재 활성 자료를 철회한다. `withdrawal` 테이블에 출처·외부 ID 기준으로 보존하여 새 수집·재발행·snapshot 정리 이후에도 제외한다. 직접 `record.withdrawn_at`을 갱신해도 DB 트리거가 같은 철회 기록을 남기고, 대기 중 교체된 활성 자료에 반영한다. 개별 flag를 null로 바꾸는 것으로 철회를 해제하지 않는다. snapshot이 도중에 교체되면 기존 pinned snapshot 근거를 재검색에서 제외한다.
- robots.txt 404도 허용으로 간주하지 않는 보수적인 수집 정책을 유지한다. robots 확인 실패 시 해당 수집 회차를 중단하고 이전 규칙을 재사용하지 않는다. 출처 정책을 확인하기 전 이 동작을 자동 완화하지 않는다.
- 원문은 Vue 텍스트로 표시하며 HTML 실행을 허용하지 않는다. 제공 기관·CSV URL·CC BY 4.0 링크·정제/발췌 여부를 표시한다. 검색 엔드포인트는 사용자 URL을 요청하지 않는다. collector의 HTTPS 도메인·크기·리다이렉트 제한을 재사용하며 출처 밖 resource URL도 발행 단계에서 거절한다.

## 모델 확장

LangGraph의 노드는 LLM 없이도 동작한다. [공식 Graph API](https://docs.langchain.com/oss/javascript/langgraph/graph-api)를 기준으로 상태·조건부 재검색·실제 실행을 구성했다. 기본 버전은 외부 모델을 호출하지 않아 추가 모델 과금이 없다.

`createTourismGraph({search,weather,route,generate})`의 선택적 `DraftGenerator`에 나중에 구조화 출력 모델을 연결할 수 있다. 입력은 최대 600개 후보의 ID/이름, 최대 24개 근거, 유지 ID·개수·관심 주제와 AbortSignal이다. 모델에 사용자 ID·여행 ID·세션·비밀번호·SQL 실행·임의 URL 조회·저장 도구를 주지 않는다. 문서 내부의 지시는 근거 텍스트이며 실행 지시로 취급하지 않아야 한다. 반환 계약은 `placeIds/evidenceIds`뿐이며 외부 ID·미지의 필드·행사 근거를 일정에 섞거나 유지 조건을 위반하면 규칙 기반 추천을 사용한다. 추천 이유는 서버 문구를 사용하므로 모델의 자유 문장을 사실 설명으로 표시하지 않는다.

모델 제공자·키·토큰/비용 상한·한국어 번역 품질은 확정하지 않았다. 실제 provider adapter, embedding, checkpointer, 자연어 날짜/교통 해석, AWS/S3/분산 잠금/스케줄러·사진·Wikivoyage 수집은 연결하지 않았다. 관심 주제는 simple 전문검색 순위에 참고하지만 일본어 분절·한일 번역 검색을 제공하지 않으며 모든 12지역의 최신 공식 공지를 확보한 것이 아니다.

## 검증 방법

```bash
npm run build
npm test
npm run test:e2e
npm run lint
npm run spec:check
python3 -m unittest discover -s scripts/tourism -p 'test_*.py' -v
```

그래프 실제 실행·허위 ID·유지 조건·최대 2회 재검색·provider timeout, PostgreSQL 원자적 snapshot·권리 철회·기간/좌표/ID 검증, 인증·동행자·미리보기 읽기 전용·409/428을 테스트한다. 화면 E2E는 공개 자료 응답과 외부 provider를 fixture로 재현하며 저장 요청은 실제 API/DB를 사용한다. 데스크톱 1440px와 모바일 390px에서 출처·미확정·과거 시간·HTML 비실행·미리보기·저장을 확인한다. 외부 사이트 장기 관측이나 실서비스 추천 품질 평가로 해석하지 않는다.

### 2026-10-01 최초 구현 로컬 검증 결과

- `npm run build`, `npm run lint`, `npm run spec:check` 통과.
- 전체 Vitest 28개 파일·167개 테스트 통과. CI 묶음은 22개 파일·102개 통과.
- 전체 Playwright 23개 통과. 새 관광 자료 화면 1440px/390px 2개 포함.
- Python 수집·정제 18개 통과: 기존 collector 13개 + normalize 5개.
- 빈 임시 DB에 마이그레이션 적용·재실행·검증 통과. 기존 catalog 20,810개 보존.
- 이번 변경 TypeScript/Vue 파일의 서식 검사와 `git diff --check` 통과. 전체 `format:check`에는 이번 작업이 수정하지 않은 기존 8개 파일의 경고가 남는다: ExpensePanel.vue, TripCalendar.vue, TripTools.vue, useTripTools.ts, Invite.vue, Planner.vue, RegionGuide.vue, expenses.spec.ts. 따라서 기존 경고 정리 전 전체 CI 서식 단계 통과를 주장하지 않는다.
- 의존성 검사에는 기존 express-rate-limit 경로의 ip-address(moderate), 개발용 brace-expansion(high) 경고가 있다. LangGraph 추가 경로에서 보고된 경고는 없다. 이 작업에서 무관한 의존성 전체 업데이트는 수행하지 않았다.
- AWS 배포·운영 스케줄 등록·외부 LLM·이번 변경 코드로 실제 HARP 전체 수집/발행은 수행하지 않았다. 첨부의 실제 에니와 HTTP 결과와 이번 fixture 검증을 구분한다.

### 2026-10-01 품질 리뷰 수정 및 재검증

| 리뷰 문제 | 수정 | 회귀 검증 |
|---|---|---|
| 유지 장소·관심 주제를 바꿔도 이전 코스를 확정 가능 | 조건 변경 즉시 추천·지도 미리보기 해제, 요청 세대와 조건 비교, 확정 전 조건 재검사 | 1440px/390px에서 관심 주제와 유지 장소를 각각 변경한 뒤 이전 확정 버튼 제거, 재조회 시 최신 조건 전송, 실제 API/DB 저장 후 선택 장소 유지 |
| 운영 중단 장소가 자료·근거리 코스에 포함 | 검색 SQL과 그래프 최종 검증에서 두 `closed` 표기 제외 | 두 표기의 후보·모델 반환·유지 장소를 각각 검사, 실제 DB 후보 검색 검사 |
| 연결되지 않은 NULL 근거가 먼저 정렬되어 연결 근거 누락 | 후보 연결 여부 정렬에 `DESC NULLS LAST` 적용 | 실제 DB에서 미연결 120개 + 연결 1개를 발행해 연결 근거가 첫 번째이며 120개 제한 안에 포함되는지 검사 |
| 다른 코스가 있으면 요청 전략을 위한 재검색 중단 | 지정 전략의 유효한 코스 존재 여부로 재검색 종료 판단 | 10km의 야외 코스가 있어도 15km 실내 코스를 찾아 미리보기, 끝까지 없으면 3회에서 종료, snapshot 고정·예보 1회 유지 |

추가한 서버 회귀 테스트 8개는 수정 전 모두 실패했고 수정 후 모두 통과했다. 관광 기능 테스트 3개 파일·25개, 전체 Vitest 28개 파일·175개, 전체 Playwright 23개가 통과했다. 빌드·린트·OpenAPI/DBML 검사·이번 수정 파일의 서식 검사·`git diff --check`도 통과했다. 전체 서식 검사에는 최초 검증에 기록한 기존 8개 파일의 경고가 그대로 남아 있다.

테스트 정리 후 기존 catalog는 20,810개, 관광 record는 0개이며 회귀 테스트용 장소·사용자는 남지 않았다. 추천·출처·외부 provider 응답은 fixture를 사용하고 확정은 실제 로컬 API/DB로 검증했다. 현재 영업 확인이나 실서비스 추천 품질을 평가한 결과는 아니다. 수정 이후 코드 해시와 검증 기록은 `docs/research/tourism-langgraph-review-fixes-20261001.json`에 별도 보존한다. 최초 구현 검증 JSON은 당시 기록으로 유지한다.


### 2026-10-01 ver2 후속 리뷰 수정 및 재검증

| 항목 | 반영 결과 | 회귀 검증 |
|---|---|---|
| 코스 선택 실패 후 목록 소실 | 같은 조건의 목록·출처 유지, 이전 미리보기·확정 해제 | 1440px/390px에서 409·429·네트워크 오류와 재시도, 조건 변경 시 무효화 |
| 가까운 후보가 600개 제한 밖으로 밀림 | 관광 검색과 기존 하루 코스 검색 모두 거리 정렬 우선 | 실제 DB에 가까운 무메타데이터 1곳과 먼 메타데이터 600곳 삽입, 양쪽 검색에서 가까운 장소 포함·가장 먼 장소 제외 |
| 그래프 시간 상한과 외부 요청 취소 분리 | 날씨·Valhalla·Google 실제 요청과 경로 대기열에 취소 신호 전달 | 그래프 예산 만료, 실제 fetch 신호 취소, 사전 취소, 호출 간 취소 격리와 완료 캐시 재사용 |
| 무관한 시설 근거와 READY 표시 | 후보 연결 시설만 검색, 반환 코스의 시설 인용만 노출·READY 판정 | 실제 DB 미연결 시설 제외 및 연결 시설/행사 120건 제한, 그래프 인용·상태·안내 검사 |
| 전략 없음과 후보 없음의 잘못된 409 안내 | 전략 없음은 422/STRATEGY_UNAVAILABLE, 유효 코스 없음은 200/NO_CANDIDATES | 실제 API에서 두 상태와 메시지 분리 |
| 빈 일정의 응답 문서 불일치 | 공통 필드·searchAttempts=0 반환, OpenAPI required 명시 | 실제 API의 공통 메타데이터·requestId·no-store 검사 |
| 유지 장소와 추가 순서 | 기존 상대 순서는 보존하고 마지막 유지 장소에서 추가 순서 계산, 전부 유지 시 명시 안내·시설 근거 코스 보존 | 그래프의 순서·전부 유지·근거 인용 검사 |
| 보조 지적 | 근거 ID Set 재사용, robots 404 중단 정책 명시·실패 갱신 규칙 제거, 날짜 상태의 중립 안내, publish 정적 import·서식 정리 | Python robots 갱신 실패 검사, 양쪽 화면 날짜 안내 검사 |

리뷰의 no-store 누락 지적은 공통 요청 처리에서 이미 헤더를 설정하므로 사실과 달랐다. 기존 provider에도 9/10초 자체 상한이 있었으며, 이번 수정은 그래프의 요청별 예산까지 실제 요청에 연결한다. 유지 장소를 앞에 두는 것은 기존 정책이므로 유지 장소끼리의 순서를 재정렬하지 않는다. robots 404를 허용으로 자동 해석하지 않으며 기존 보수적 정책을 유지한다.

전체 Vitest 29개 파일·191개, 전체 Playwright 25개, Python 19개가 통과했다. build·typecheck·lint·전체 format:check·spec:check(45 paths/28 tables)·git diff --check도 통과했다. 앞 절의 기존 서식 경고는 ver2 통합 과정에서 정리되어 현재 전체 서식 검사가 통과한다. 테스트 종료 후 catalog 20,810개, 관광 record 0개, 이번 회귀 테스트 장소·사용자 0개를 확인했다. 상세 기록과 수정 코드 해시는 `docs/research/tourism-langgraph-review-2-20261001.json`에 보존한다.

관광 자료 화면의 추천·근거·provider 응답은 fixture이며 확정은 실제 로컬 API/DB로 검증한다. 실제 HARP 전체 재수집·현재 운영 확인·외부 LLM 연결·운영 배포·실사용 추천 품질 평가는 수행하지 않았다. GitHub CI는 별도로 해당 커밋의 Actions 기록에서 확인한다.


### 2026-10-01 유지 장소와 자료 코스의 선택 순서 보완

`74d46af`에서는 유지 장소가 있을 때 근거 우선 후보를 방문 수만큼 고른 뒤 거리순으로 재정렬하고 남은 자리만큼 잘라, 먼 근거 장소가 탈락하는 결함이 남아 있었다. 실제 그래프 실행에서 유지 0개는 통과하고 유지 1·2·3개는 KNOWLEDGE 코스가 없어지는 실패를 재현했다. 추가 장소를 근거 우선순위와 남은 자리 수로 먼저 선택한 뒤 그 집합에만 이동 순서 계산을 적용하도록 수정했다.

추가한 4개 회귀 사례는 유지 0·1·2·3개에서 기존 유지 순서, 총 방문 수 4곳, 먼 시설 근거 장소 포함, evidenceIds, 실제 선택 미리보기, READY 상태와 재검색 없이 1회 검색 완료를 확인한다. 수정 전 3개 실패·1개 통과였고 수정 후 4개 모두 통과했다. 기존 전부 유지 사례와 다른 그래프 검사까지 포함해 그래프 테스트 20개가 통과했다.

전체 Vitest 29개 파일·195개와 Playwright 25개, build·lint·전체 format:check·spec:check·git diff --check가 통과했다. 관광 화면의 추천·근거·외부 경로는 fixture이고 확정은 실제 로컬 API/DB 검증이다. 이번 수정은 장소 선택과 이동 순서에 한정하며, 신호가 있는 동시 요청의 외부 호출량과 Valhalla 대기열 부하 측정은 후속 항목이다. 상세 재현과 코드 해시는 `docs/research/tourism-langgraph-review-3-20261001.json`에 보존한다.


### 2026-10-01 발행 메타데이터와 보존 도구 보완

동일 자료 재발행 시 DB의 오래된 표시 메타데이터가 유지되는 문제를 실제 PostgreSQL 테스트로 재현했다. 추가 테스트는 수정 전 1개 실패·기존 9개 통과였고, 수정 후 모두 통과했다. 별도 출처 동기화가 DB의 철회·비활성을 되돌리지 않고 활성 snapshot도 보존하는 2개 검사를 추가했다.

보존 도구의 4개 DB 검사는 기본 미리보기의 무변경, 활성·최근·최신 3개 보존, 지정 출처만 적용, 삭제 record의 cascade, 오래된 fetchedAt/최근 publishedAt 구분, 잘못된 정책·출처 거절을 확인한다. 실제 정리 동작은 고유 출처 ID로 만든 테스트 snapshot에만 실행했다. 실제 DB 기본 명령은 dryRun이며 대상 0개를 확인했다.

전체 Vitest 30개 파일·202개, 전체 Playwright 25개, build(타입 검사 포함)·lint·전체 format:check·spec:check(45 paths/28 tables)·git diff --check가 통과했다. 실제 HARP 수집·발행이나 운영 데이터 삭제·예약 실행은 수행하지 않았다. 재현 결과와 수정 코드 해시는 `docs/research/tourism-langgraph-review-4-20261001.json`에 보존한다.


### 2026-10-01 실제 HARP 적재와 화면 검증

승인 출처 3개의 CSV를 실제 수집·정제하여 로컬 관광 DB에 37건(시설 24·행사 13)을 발행했다. catalog 20,810곳은 보존했다. 시설 8건이 연결되어 연결률은 33.3%이며, 미연결 사유는 명칭 불일치 10건·250m 안 후보 없음 6건이다. 현재 운영·행사 개최·추천 정확도 검증으로 해석하지 않는다.

`npm run tourism:audit -- --date 2026-10-01`은 읽기 전용으로 출처별 활성 snapshot, 시설 분모·연결률·미연결 사유, 행사 기간·원문 수정 시점 누락을 점검한다. 시설의 날짜 휴리스틱 때문에 행사 미확정 문구가 표시되는 문제를 수정하고, 수집 gate의 대기 후 기준 시각 재검사를 추가했다.

전체 Vitest 203개·기존 E2E 25개·실제 발행 자료 E2E 2개·Python 20개와 build·lint·format:check·spec:check가 통과했다. 실제 자료 E2E는 `TOURISM_PUBLISHED_E2E=1`로 별도 활성화하며 기본 실행/CI에서 자동 수집이나 발행을 하지 않는다. 이전 절의 record 0개·fixture 설명은 해당 시점의 기록으로 보존한다. 현재 실제 적재 수치·해시·실행 노트북·제약은 [실제 적재 검증](research/tourism-data-ingestion-20261001.md)을 참고한다.


### 2026-10-01 공용 Valhalla 간격 분리와 시설 대조

자체 호스팅/별도 경로 서버에는 전역 1.1초 대기를 적용하지 않고, 명시적으로 설정한 공용 주소에도 공용 간격을 유지한다. 운영의 공용 서버 거절도 같은 주소 판별 함수를 사용한다. 발행과 감사의 명칭·250m·유일 후보 연결 규칙은 `tourism-matching.ts`로 통합했다.

`npm run tourism:compare`는 활성 미연결 시설의 원문 근거와 모든 근접 후보를 읽기 전용으로 출력한다. 실제 명칭 불일치 10건의 대조 메모, 다른 주변 후보 없음 6건의 목록과 승인 대기 상태를 보존했으며 실제 연결을 변경하지 않았다. 전체 Vitest 221개·실제 자료 2개 포함 E2E 27개·Python 20개 및 build·lint·format:check·spec:check를 검증했다. 변경·측정 제약·재실행 명령은 [후속 검증](research/tourism-langgraph-review-5-20261001.md)을 참고한다.

### 2026-10-01 추천 POST 호출 제한 수정

GET 전용 정책을 사용해 관광 추천 POST 집계를 건너뛰던 문제를 수정했다. 추천은 전용 정책으로 사용자당 60초에 30회이며 세션·여행·날짜가 한도를 공유한다. 실제 PostgreSQL·인증 경로에서 31~40번째 429, 동행자별 분리, GET 조회 한도 분리, 만료 초기화를 검증했다. 실제 429를 거치는 데스크톱·모바일 검사로 이전 코스와 일정 보존, 미리보기 제거도 확인했다. 전체 Vitest 224개·E2E 27개·CI 묶음 156개·Python 20개 및 build·lint·format:check·spec:check가 통과했다. [재현과 검증 범위](research/tourism-langgraph-review-6-20261001.md)에 fixture와 실제 API/DB의 경계를 기록했다.

### 2026-10-01 관광 추천 화면 CI 편입

관광 추천의 데스크톱·모바일 E2E 2개를 `quality`의 별도 `tourism-e2e` 작업에 편입했다. 각 테스트가 자기 가상 장소 5곳을 만들고 정리하여 실제 catalog/HARP 적재 없이 빈 PostGIS DB에서 실행된다. 출처·조건 변경·실제 429 뒤 목록/일정 보존·확정 PATCH를 검사하며, 실패 시 화면·trace·HTML 보고서를 7일 보관하도록 설정했다. 전체 E2E나 실제 발행 자료 검사를 CI에 모두 넣은 것은 아니다. 빈 DB의 Chromium 2개 통과와 의도한 실패의 로컬 캡처·정리, 전체 Vitest 224개·E2E 27개와 정적 검사를 확인했다. [검사 범위와 재현 기록](research/tourism-e2e-ci-20261001.md)에 로컬·원격 검증 경계를 기록했다.

## 지역 행사 참고 목록 정책

`referenceEvents`는 지역별 최대 20개이며 `evidence`·모델 입력·시설 인용·`READY` 판정에서 분리한다. 승인·활성·최신 snapshot·철회 여부·90일 수집·유효기간 검사를 동일하게 적용한다. 날짜가 없는 `recurring/unknown` 행사만 포함하고, 일정 날짜를 생성하거나 자동 배치하지 않는다. 화면에 반복 개최/날짜 미기재, 여행일 개최 미확인, 과거 소개 가능성, 원문 일정 표현·수집일·수정일 미제공·출처·라이선스를 표시한다. 빈 일정 응답은 `referenceEvents: []`이다.


### 2026-10-02 미연결 시설 23건과 나머지 9개 지역 출처 검토

활성 시설 34건 중 연결 11건·미연결 23건을 원문과 공식 안내로 검토했다. 별칭 후보 2건·연결 보류 14건·250m 내 후보 없음 6건·좌표 재검토 1건이다. 별칭 후보의 catalog 웹사이트는 null이라 기존 승인 스키마를 우회하지 않았다. 실제 별칭 등록·snapshot 발행·좌표 변경은 없으며 미연결은 23건 그대로다. [시설별 판단과 근거](research/tourism-facility-review-20261002.md)를 보존했다.

나머지 9개 지역 모두의 후보 출처·라이선스를 조사했다. 시정촌 4곳의 파일과 경관 지도 ZIP을 실제 확보하고, 지도에서 5개 앱 지역에 속하는 장소 8개를 별도로 대조했다. HARP CSV 두 개는 미리보기·자원 URL만 확인하고 다운로드가 시간 초과됐으므로 파일 확보로 세지 않았다. 새 production 출처는 0개이며 일부 시정촌·지도 장소를 지역 전체 자료 확보로 해석하지 않는다. [지역별 출처와 적용 전 제약](research/tourism-nine-region-sources-20261002.md)에 CC BY 버전·안정 ID·좌표 변환·robots·파일 형식의 남은 일을 기록했다.

기존 매칭·별칭 테스트 18개와 [재현 노트북](research/tourism-facility-source-review-20261002.ipynb)의 4개 코드 셀을 실행했다. 읽기 전용 DB 재감사로 catalog 20,810곳·활성 시설 34건·연결 11건·미연결 23건과 활성 snapshot 보존을 확인했다. 이번 변경은 연구 문서에 한정되며 전체 build·Vitest·E2E를 로컬에서 재실행한 결과로 보고하지 않는다.


### 2026-10-02 북토 별칭 2건과 삿포로 자료 적용

북토 별칭의 null URL과 catalog 분류·주소·좌표 지문을 강화하고 검토한 2건을 적용했다. 북토 새 CSV 수집은 시간 초과돼 원문·원래 수집 시각을 보존하는 명시적 재처리로 연결을 2/10에서 4/10으로 늘렸다. 새 snapshot에만 연결하며 이전 snapshot은 보존했다. 원래 미연결 23건 중 21건이 남았다. 삿포로의 실제 CSV 103행을 수집·정제·발행해 15건을 연결했고 새 미연결 88건(명칭 87·지역 1)은 별도 모집단이다. catalog 20,810곳은 보존했다. [구현·재처리 제한·실제 자료 및 테스트 범위](research/tourism-alias-sapporo-20261002.md)를 보존했다.


### 2026-10-02 재리뷰 수정

- robots 확인·페이지 탐색 단계의 실패도 SQLite `runs`에 기록한다. 정규화는 이전 성공으로 돌아가지 않고 최신 실패 회차를 거절한다. 이전 활성 snapshot과 원본은 유지한다.
- 006 마이그레이션은 `tourism_knowledge.withdrawal`과 개별 철회 트리거를 추가한다. 배포 전 `npm run db:migrate`가 필요하다. 승인 별칭 재처리는 철회가 있으면 거절하며 일반 새 수집도 철회된 외부 ID를 되살리지 않는다. 검색은 snapshot flag와 지속 철회 기록을 모두 검사한다.
- 운영 철회 도구는 출처 → 자료 순서로 잠근다. 직접 SQL 철회는 트리거로 보호되지만 정리 작업과 동시에 실행하면 잠금 순서 때문에 한쪽이 교착 오류로 롤백될 수 있으므로 운영에서는 도구를 사용한다. 철회 해제는 자동화하지 않으며 별도의 검토 정책이 필요하다.
- 감사는 이미 연결된 시설도 현재 공통 규칙으로 다시 검사한다. 연결이 맞지 않으면 `LINK_REVIEW_REQUIRED`와 `currentMatch`를 반환한다. 저장된 연결을 자동 수정하지 않으며 미연결 시설 대조 목록과 구분한다. 연결률은 저장된 연결 기준이며 현재 동일성 보증이 아니다.
- 삿포로 103행 fixture는 외부 HTTP 응답을 대체하여 수집 → 정규화 → 발행 → 검색을 연결한다. 원문 SHA·선행 0·출처·라이선스·설명/연락처/사진/요금 제외를 검증한다. 실제 신규 수집이나 현재 시설 운영 여부를 검증하는 테스트는 아니다.

### 승인 별칭 진단과 공통 출처 정책

연결 규칙은 파일 전체 SHA-256, 출처·외부 ID·명칭·지역, catalog 지문과 250m 범위를 그대로 검사한다. `aliasReviews`는 발행 CLI 결과에, `aliasReview`는 감사의 시설별 진단에 제공한다. `ALIAS_SOURCE_CHANGED`(명칭·원문 파일 해시·지역 변경), `ALIAS_CATALOG_CHANGED`(catalog 지문 변경), `ALIAS_CANDIDATE_UNAVAILABLE`(승인 후보가 범위/지역에 없음), `ALIAS_AMBIGUOUS`, `ALIAS_MISSING_COORDINATES`를 구분하고 `changedFields`를 제공한다. 정확한 명칭이 유일하게 일치하면 오래된 별칭 해시가 달라도 연결되며 중단 경고를 내지 않는다. 변경 없는 발행도 승인 별칭 대상의 현재 진단을 반환하지만 저장된 연결은 변경하지 않는다. 이 진단은 자동 재승인이 아니며 원문 행이 삭제된 경우를 탐지하는 출처 간 목록 비교 기능은 아니다. 별칭 파일 읽기/파싱 실패는 실패한 캐시를 제거하여 다음 호출이 다시 읽을 수 있게 하며, 정확한 명칭 연결은 별칭 파일에 의존하지 않는다.

`ops/tourism/source-policy.json`은 등록부와 분리된 검토 대상 허용 정책이다. Python 수집기·정제기와 TypeScript 발행기가 각자 읽어 HARP HTTPS dataset 범위, 삿포로의 출처 ID·페이지·고정 CSV·파서, 최소 간격(60/10초)을 검사한다. 등록부의 승인·활성·라이선스 및 DB 운영 권한 검사는 계속 적용한다. 다른 CKAN 출처는 등록부 수정만으로 허용되지 않으며 정책 검토가 필요하다. 정제와 발행은 고정 파일, 같은 dataset 경로, 사용자 정보·query·fragment·상대 경로 우회를 검사한다. 후라노의 실제 일본어 CSV 파일명처럼 유효한 UTF-8 퍼센트 인코딩은 허용하고, 점·슬래시·역슬래시·query/fragment 구분자 인코딩, 이중 인코딩, 잘못된 UTF-8·제어 문자는 거절한다. 입력 URL은 출처 표시를 위해 그대로 보존하며 디코딩은 검증에만 사용한다. 실제 URL과 우회 반례 31개를 Python/TypeScript에 동일하게 적용하고, 승인·활성 등록부 전체의 자원 URL 호환성도 검사한다.

CI는 `node scripts/audit-dependencies.mjs`로 기존 production 의존성 high/critical 게이트를 실행한다. 실제 npm 출력의 최상위 `statusCode`, `body.message`, 네트워크 오류 `message`를 읽으며, 429·500/502/503/504·알려진 통신 오류와 400 `Invalid package tree`만 최대 3회(2초/4초 대기) 재시도한다. 자식 프로세스는 회당 60초·출력 8MB로 제한한다. 취약점 목록이나 합계에 high/critical이 있으면 즉시 실패하고, 성공은 종료 코드 0·보고서 버전 2·정상 정수 합계·목록과 심각도별 개수 일치를 모두 요구한다. 영구 오류·잘못된 JSON·예상 밖 결과와 반복 오류는 실패하며 오류의 URL·헤더·본문을 로그에 출력하지 않는다. 정상/취약점 보고서도 심각도별 개수·패키지명·패치 여부만 기록한다. 실제 npm CLI를 loopback 레지스트리에 연결하는 장애·취약점·타임아웃 검증을 `test:ci`에 포함하고, npm 10.9.9의 실측 출력도 회귀 fixture로 보존한다. npm 버전과 기존 취약점 임계값은 변경하지 않았다. [실제 실패 재현과 검증 범위](research/tourism-hardening-20261006.md)를 참고한다.
