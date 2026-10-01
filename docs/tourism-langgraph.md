# Book해도 LangGraph 관광 자료 추천

2026-10-01 구현. 첨부 `tourism-data-automation-plan.md`의 M1/M2/M4/M5에 해당하는 로컬 MVP이며, 문서의 AWS 구성·스케줄 제안은 배포 명령으로 취급하지 않았다. `tourism-automation-revalidation-20261001.json`은 기존 수집 계층의 검증 증거다. 최초 구현 시 수집기의 SHA-256과 테스트 코드 해시는 첨부의 최종 값과 일치했고 기존 수집 코드는 수정하지 않았다. 후속 리뷰에서는 robots 조회 실패 시 중단하는 기존 정책을 명시하고, 실패한 갱신의 오래된 규칙을 제거하는 처리와 회귀 테스트를 추가했다.

## 구현 범위

| 계층 | 파일 | 동작 |
|---|---|---|
| 출처 등록부 | `ops/tourism/sources.json` | HARP 3개 출처 승인, HOKKAIDO LOVE는 허락 대기·비활성 |
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

부라노 자료는 `--source furano-places` 또는 `furano-events`와 각각의 출력 파일로 실행한다. HARP 요청은 기존 수집기에서 최소 60초 간격을 지킨다. 정제·발행은 네트워크를 사용하지 않는다.

에니와 `--year`를 생략하면 실행 시점의 현재 연도 자료를 선택한다. 선택 연도의 파일이 없으면 오래된 파일을 대신 쓰지 않고 오류를 낸다. 실제 행사 날짜는 CSV 값으로만 결정한다. 현재 MVP는 에니와의 한 선택 연도 snapshot을 활성화하며 여러 연도의 event occurrence 동시 색인은 후속 작업이다. 같은 ID를 가진 파일들이 선택 범위에 중복되면 공개하지 않는다.

최신 수집 회차가 실패했거나 자료 일부가 실패했으면 정제를 중단한다. 원본 SHA가 다르거나 필수 열·날짜·좌표·ID 검증에 실패해도 이전 공개 버전을 유지한다. 수집과 정제·발행은 별도 명령이며 스케줄러를 등록하지 않았다.

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
- 행사 기간이 여행일과 겹쳐야 반환한다. `tentative`는 화면에 미확정으로 표시하고 자동 배치에 사용하지 않는다. `recurring/unknown` 행사와 종료 행사는 특정 날짜 추천에서 제외한다.
- 좌표가 없으면 null을 유지한다. 시설 연결은 동일 정규화 명칭 + 250m 안의 유일한 후보만 허용한다. 동명 후보가 여러 개거나 좌표가 없으면 연결하지 않는다. 행사는 이 버전에서 기존 장소와 자동 연결하지 않는다.
- 시설 소개와 과거 영업시간을 분리한다. 자료의 연도가 있는 이용 시간은 `historical`로 보존하며 현재 영업시간·요금·휴관 근거로 사용하지 않는다. 현재시간을 확인했다는 안내를 만들지 않는다.
- 기존 장소의 `openingHours='closed'` 또는 `tags.opening_hours='closed'`는 검색 후보와 최종 코스에서 제외한다. 유지할 장소와 모델 반환 결과에도 같은 검사를 적용한다. 운영 중단 표기가 없는 장소의 현재 영업을 보증하지는 않는다.
- 관광 자료 검색과 기존 하루 코스 검색 모두 거리순으로 먼저 정렬한 뒤 최대 600곳을 선택한다. 이름·웹사이트 여부는 거리 동률의 보조 기준이다.
- 현재 검색 후보에 연결된 시설 근거와 적용 기간이 맞는 행사만 검색한다. 연결 시설 근거를 먼저 정렬한 뒤 120개 제한을 적용한다. 최종 응답은 반환 코스가 인용한 시설 근거와 별도 참고 행사만 담는다. 시설 근거를 실제 인용한 코스가 있어야 `READY`이며 행사만 있으면 `CATALOG_FALLBACK`과 행사 참고 안내를 반환한다.
- `fetchedAt`은 최근 수집 확인, `sourceUpdatedAt`은 원문 수정 시점이다. 원문 수정 시점을 확인하지 못하면 null로 둔다. 최근 90일 수집 기준은 검색 참여 기준일 뿐 최신 운영 정보 보증이 아니다.
- 출처 등록부와 DB의 권리·활성 상태를 함께 검사한다. DB에서 `rights_status='withdrawn'` 또는 `enabled=false`로 바꾸면 새 검색에서 제외한다. 개별 철회는 `record.withdrawn_at`으로 제외한다. snapshot이 도중에 교체되면 기존 pinned snapshot 근거를 재검색에서 제외한다.
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
