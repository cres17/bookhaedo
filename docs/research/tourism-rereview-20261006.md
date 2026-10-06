# Book해도 ver2 재리뷰 — 운영 수정 후의 경계 검사

기준 커밋은 `3fa83a1cb386ca721ac2528b6401cf70592c8684`다. 로컬 HEAD와 원격 ver2가 같고, 해당 [quality 실행](https://github.com/cres17/bookhaedo/actions/runs/37406065883)의 verify·tourism-e2e 성공을 다시 확인했다. 특정 인물, OpenAI·Anthropic 관계자 또는 다른 모델의 실제 검토 결과가 아니다.

## 1. 판단

이전 R1–R5/D1–D3 수정으로 장소 적격성, 기본 시설 중복, 날씨 검증, 조회 취소, SQL 응답 유실, 자료 최종 검사와 추천 문맥 조회가 개선됐다. 이를 철회할 근거는 없다. 다만 각 정책을 적용한 경로의 범위가 다르고, DB 읽기 시점과 저장 원자성은 별개다. 이번에는 **경계 현상 4개를 재현**했다. F2–F4는 확인된 결함이고 F1은 확정 시점 계약에 따라 결함 여부가 달라지는 보호 공백이다. 이들은 이번 검토에서 추가로 확인한 문제이며 최근 수정이 모두 새로 만든 회귀라는 뜻은 아니다.

이번 확인 범위에서 P0/P1로 분류한 결함은 없다. 사용자 결과와 복구 흐름에 영향을 주는 아래 네 건은 P2로 판단한다. 이 분류는 전체 앱에 보안 문제가 없다는 인증이나 운영 출시 승인이 아니다. 사실과 제안, 실제 DB 실험과 외부 응답 fixture를 분리한다.

운영 코드·기존 회귀 테스트는 수정하지 않았다. 새 리뷰·설계·진단 자료만 작성했다. 원격 브랜치는 변경하지 않았다. 구현 권장안과 불변 조건은 [목표 아키텍처·워크플로우](tourism-rereview-architecture-20261006.md)에 있다.

## 2. 확인된 결함과 계약 공백

### F1 / P2·계약 의존 — 이동 수단 검사는 확정 트랜잭션 전체를 보호하지 않는다

위치: `server/day-alternatives.ts:147–158, 270–286`, `server/routes/trips.ts`의 여행 PATCH.

`dayContext(lock=true)`는 day 행을 잠근 뒤 trip의 transport mode를 읽지만 trip 행을 잠그지 않는다. `expectedTransportMode` 비교 자체는 있다. 따라서 읽은 뒤 다른 요청이 mode를 바꾸면 비교는 옛 값을 기준으로 통과하고 새 코스가 저장된다.

실제 DB와 PATCH API의 순서를 고정했다.

1. WALK 일정·revision 1의 코스 확정 요청을 시작한다.
2. day 잠금과 문맥 SELECT가 WALK를 반환한다.
3. 별도 DB 연결이 같은 여행의 mode=BICYCLE 변경을 커밋한다.
4. 원래 확정 요청은 WALK 기대값으로 검사한 뒤 **200, revision 2**로 저장한다.
5. 다시 조회하면 BICYCLE 여행에 WALK 문맥으로 확정한 새 장소가 들어 있다.

대조군: 검사 전에 이미 다른 mode를 기대한 요청은 409다. 즉 비교 함수가 없는 문제가 아니라 검사와 COMMIT 사이의 보호 범위 문제다. 실제 잘못된 이동시간을 측정한 것은 아니며 장소 저장과 이동 수단의 문맥 불일치를 확인했다.

판단의 조건: “문맥 SELECT 시점의 mode만 검사한다”는 계약이라면 이 결과만으로 계약 위반을 단정할 수 없다. “확정 COMMIT까지 관련 쓰기를 순서대로 처리한다”는 강화된 계약을 선택하면 아래 보완이 필요하다. 이번 설계는 후자를 선택하며, mode 변경이 확정 뒤에 순서대로 일어나는 것까지 금지하지 않는다.

수정 제안: 모든 관련 쓰기의 순서를 **trip 잠금 → day 잠금 → 새 문맥 읽기 → 검사 → 변경 → COMMIT**으로 통일한다. trip 설정 변경, 삭제, 날짜 추가, 일정 확정도 같은 순서에 참여해야 한다. 이미 day부터 잠그는 경로 일부에만 trip 잠금을 덧붙이면 잠금 순서를 뒤집을 수 있다. 단순 재조회 한 번도 그 뒤의 변경을 막지 못한다. trip 행 잠금은 소규모 서비스의 보수적 시작안이며 이후 날짜별 동시성 요구에 따라 mode/context version 전략을 검토한다.

수락 검사: mode 변경이 먼저 커밋하면 확정 409·기존 일정 보존; 확정이 먼저 잠그면 mode 변경은 그 뒤에 완료; 삭제·날짜 추가와 경쟁해 교착/무제한 대기 없음. 권한 재검사·문맥 버전·잠금 시간 제한도 별도 검사한다. 읽기 snapshot과 쓰기 잠금은 다른 계약이다. [PostgreSQL 행 잠금](https://www.postgresql.org/docs/17/explicit-locking.html#LOCKING-ROWS)도 잠근 행의 충돌만 막는다.

### F2 / P2 — 여행 전체 조회는 revision과 장소 목록을 서로 다른 시점에서 읽는다

위치: `server/routes/trips.ts:54–71`.

추천용 `dayContext`는 한 문장으로 개선됐지만 `GET /api/trips/:id`는 requireTrip의 메타데이터, days SELECT, items SELECT를 각각 읽는다. 실제 DB 실험에서 days를 읽은 뒤 장소 교체와 revision 증가를 하나의 다른 트랜잭션으로 커밋했다.

- API 응답: **revision 2 + revision 3에서 교체된 장소 목록**.
- 같은 상태를 새로 조회한 실제 revision: **3**.

revision 검증 때문에 이 응답으로 다음 쓰기를 시도하면 보통 409로 막힌다. 따라서 이 재현을 조용한 덮어쓰기나 데이터 손실로 과장하면 안 된다. 문제는 사용자가 일관된 새 상태를 받지 못하고, 저장 결과 불명확 상황의 복구 조회로도 충분하지 않다는 것이다.

수정 제안: 응답에 쓰는 trip 메타데이터·days·items 전체를 한 SELECT로 읽거나, 짧은 `REPEATABLE READ READ ONLY` 트랜잭션에서 모두 읽는다. requireTrip에서 받은 옛 metadata를 새 items와 그대로 결합하지 않는다. 조회 snapshot 안의 ACL 시점을 명시하고, 읽기를 느린 provider 호출과 같은 트랜잭션으로 묶지 않는다. 기본 READ COMMITTED에서는 한 트랜잭션 안의 두 SELECT도 시점이 달라질 수 있다. [PostgreSQL 격리 수준](https://www.postgresql.org/docs/17/transaction-iso.html#XACT-READ-COMMITTED).

수락 검사: 응답은 이전 revision+이전 목록 또는 이후 revision+이후 목록 중 하나여야 한다. mode·note·cost·schedule도 같은 응답 시점에서 읽혀야 한다. 교체·메모 변경·삭제 barrier와 저장 응답 유실 뒤의 재조회 대조군을 포함한다.

### F3 / P2 — 날씨 대안 확정은 남아 있는 장소와 같은 시설인지를 검사하지 않는다

위치: `server/weather-alternatives.ts:31–37, 175–208`.

일반/관광 코스와 하루 교체에는 `sameRecommendationFacility`가 적용됐지만 날씨 대안 순위는 `같은 ID 또는 raw nameJa 동일+100m` 조건을 사용한다. 확정도 replacement ID의 중복·적격성·실내 근거·거리만 확인하고 남은 시설과의 정규화 중복을 검사하지 않는다.

일정에 `Museum A`, 대체 후보에 `Ｍｕｓｅｕｍ Ａ`를 서로 다른 ID, 같은 지역·분류, 약 1m 거리로 구성했다. 공통 시설 함수는 동일 시설로 판정한다.

- 순위 함수는 해당 대안을 **1개 반환**한다.
- 날씨 대안 PATCH는 **200**이고, 저장 후 두 항목이 공통 정책상 같은 시설이다.
- raw 이름도 같은 대조군은 순위에서 0개다.

이것은 가상 자료의 공통 정책 불일치다. 실제 두 시설의 법적 동일성이나 현재 OSM 중복 수를 평가한 것은 아니다.

수정 제안: 순위와 확정 모두 동일한 공통 시설 정책으로 **target을 제외한 남은 일정**과 비교한다. 확정은 클라이언트 preview를 신뢰하지 않고 최신 catalog와 잠긴 일정으로 다시 검사한다. 후보를 다른 ID로 바꾸거나 다른 ID의 근거를 옮겨 중복을 해결해서는 안 된다.

수락 검사: NFKC·공백·기호 변형, 동일 좌표·10m 경계, 같은 체인의 떨어진 지점, 조회 후 후보 변경. 거절 시 revision·목록·note·cost·schedule 무변경. target 자신은 교체 대상이므로 남은 일정의 중복 검사와 구분한다.

### F4 / P2 — 경로 수치 검증은 지도 geometry의 유효성까지 보장하지 않는다

위치: `server/routing.ts:135–145`, `server/providers.ts:100–105`, `frontend/src/components/TravelMap.vue:71–74`.

Valhalla 수치·polyline 문법·점 개수는 검사하지만 디코딩한 위도/경도의 지구상 범위를 검사하지 않는다. Google의 `encodedPolyline`도 타입 검증 없이 반환한다.

주입한 transport로 원본 함수와 캐시를 호출했다. 실제 Valhalla/Google 장애를 유발하지 않았다.

- 위도 **95°**인 두 점을 유효한 인코딩 문법으로 반환하면 source=valhalla, preview complete=true다.
- 같은 요청 두 번에 upstream 호출은 1회다. 잘못된 geometry가 완료 캐시에 저장됐다.
- Google `encodedPolyline={invalid:true}`를 주면 source=google이고 polyline 타입은 object다. TypeScript의 string|null 선언은 실제 JSON을 정제하지 못한다.

지도 렌더링이 실제로 어떤 예외를 내는지는 이번 실험에서 측정하지 않았다. 지도 표시 오류나 잘못된 선을 막는 방어가 부족하다는 결론까지만 내린다. Google geometry가 빠진 응답을 숫자 경로까지 모두 실패시킬지도 명시적 제품 계약으로 정해야 한다.

수정 제안: provider adapter에서 수치와 geometry를 별도로 검증한다. 점은 유한값, latitude -90..90, longitude -180..180, 점 수/응답 bytes 상한을 요구한다. Google polyline은 string/null 계약과 디코딩·크기 검사로 정제한다. geometry unavailable이면 지도 fallback과 경로 수치 상태를 분리한다. invalid는 캐시 금지; 정상 source로 잘못 승격하지 않는다. endpoint 근접성 허용치는 실제 provider의 도로 snap 동작으로 검증하고 임의로 10m 같은 엄격한 기준을 넣지 않는다.

수락 검사: 정상 0값, 빈 shape, 절단된 인코딩, 범위 밖 좌표, 문자열 아닌 polyline, 지나친 점 수, 첫 invalid 뒤 정상 재시도. WALK/TRANSIT의 시간 의미는 geometry 상태와 독립적이다.

## 3. 코드 품질·운영 경계 관찰

| 항목               | 확인한 사실                                                                                                                        | 판단·권장안                                                                                                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O1 중첩 route 지표 | 실제 빈 일정 GET day-alternatives의 완료 지표 route는 `/`다. observeRequests는 `req.route.path`만 읽는다                           | 카디널리티 폭발이 아니라 서로 다른 중첩 API의 구분 손실. 각 라우트의 고정 operation ID를 locals에 저장하고 전체 API 이름으로 집계한다. 미매칭은 하나로 제한                   |
| CI 검사 범위       | 전체 52파일과 CI 46파일의 차이는 admin, api, collaboration, day-alternatives, place-search, weather-alternatives 6파일             | 일부 새 경계 검사는 CI에 있지만 전체 기능 회귀를 모두 검사하는 것은 아님. 빈 DB fixture로 정리한 뒤 중요한 파일을 CI에 포함. CI 성공으로 해당 6파일 전체 성공을 대신하지 않음 |
| 실행 타입          | vue-tsc include는 frontend/server/vite이며 tests/scripts를 직접 include하지 않음. GraphInput/items/plans와 route 함수에 any가 남음 | typed DTO·discriminated union·provider unknown→schema parse 경계를 단계적으로 추가. any 제거 수를 품질 지표로 오인하지 않고 경계 오염을 먼저 막음                             |
| 모듈 결합          | tourism-graph가 Router·SQL·확정도 가진 day-alternatives에서 center/nearestOrder/buildDayPlans를 import                             | 순수 정책·계획·거리와 application use case·HTTP adapter를 분리. 큰 서비스 분할보다 테스트 격리가 먼저                                                                         |
| 조회 전체 기한     | 15초 budget은 인증·전체 rate limiter·trip ACL 뒤 핸들러에서 시작함. 이전 문서도 이를 명시                                          | 기존 설명을 허위로 정정할 필요는 없음. 운영 SLO는 pre-handler DB 대기·응답 유실까지 포함하는 상위 read scope가 필요. 쓰기 COMMIT 결과는 별도 복구                             |
| 공급자 실패        | route/forecast catch가 실패 사유를 fallback으로 합친다. cache failed는 거친 집계                                                   | unavailable/timeout/cancelled/invalid/quota/queue-full을 내부 타입·저카디널리티 지표로 나누고 UI는 필요한 의미만 전달. 예보 미제공과 현재 안전함을 구분                       |
| 캐시와 취소        | signal이 있으면 진행 중 요청 합치기를 사용하지 않고 완료 캐시는 사용                                                               | 취소 독립성을 지키는 현재 선택. 실제 호출 증폭을 측정한 뒤 subscriber별 취소+공유 flight 설계. 취소한 요청이 다른 사용자의 flight를 죽이면 안 됨                              |
| 시설 정책          | 일반 dedupePlaces의 체인 다양성과 추천용 10m 동일 시설 규칙은 다른 목적                                                            | chain diversity를 identity로 사용하지 않는다. common policy가 쓰이는 모든 추천·확정 경로를 매핑한 contract 검사 필요                                                          |
| 자료 권리          | 최종 revalidate 뒤에도 context SQL·직렬화·전달 시간이 있음                                                                         | `evidenceValidatedAt` 이후 철회의 이미 전송된 자료 회수는 보장되지 않음. 명시한 시점 계약을 유지하고 엄격한 회수 요구는 별도 화면 갱신 프로토콜                               |
| 제안 확정 의미     | 하루 PATCH는 ID·문맥·적격성·거리 검사이며 server-stored proposal은 없음                                                            | 현재는 사용자가 선택한 장소 목록의 변경이다. “그때 제안한 정확한 근거와 경로를 승인”하려면 proposal 저장/만료/재검증 계약이 필요                                              |

Node의 `server.requestTimeout`은 전체 요청 수신 시간을 제한하며 이미 받은 요청의 전체 handler 실행시간과 다르다. 현재 30초 설정을 end-to-end 처리 기한으로 해석해서는 안 된다. [Node HTTP 문서](https://nodejs.org/api/http.html#serverrequesttimeout).

## 4. 이전 수정에서 유지할 부분

- 한 번의 SELECT로 recommendation context를 묶고, 잠금 대기 뒤 새 문장으로 다시 읽은 처리. F1은 이 읽기 개선을 부정하지 않고 trip mode의 쓰기 잠금 범위를 추가하는 문제다.
- readQuery의 SQL 3초·wire 3.5초·취소 transport 전체 1초, query 후 취소가 다른 borrower에게 전달되지 않도록 대상 연결을 유지한 뒤 폐기하는 처리. 네 가지 wire-loss 회귀가 CI에 포함돼 있다.
- 10일 연속 JST 날짜·배열·기온 순서·WMO·강수/풍속 검증 뒤 날씨 캐시에 넣는 처리. null/0의 의미도 유지한다.
- TRANSIT 합계 null, 구간별 동일 시각 비교 안내와 `timelineStatus=NOT_EVALUATED`. 실제 연속 일정은 아직 별도 기능이다.
- source active/권리/withdrawal/유효기간·정확한 record-place 관계의 최종 재검사. 다른 ID에 근거를 옮기지 않는 정책.
- 사용자별 추천 30/60초, PostgreSQL 공유 rate store, process-local Valhalla gate, 완료 캐시, finish/close 한 번 정리. 이 조합을 운영 용량 증명으로 해석하지 않는다.
- source 범위·URL 인코딩·실제 npm CLI 장애 fixture와 fail-closed audit. ASCII fixture만으로 정상 일본어 파일명을 배제하는 이전 오류를 반복하지 않는다.

## 5. 논리적 기능 보완

1. **현재 장소 목록 변경과 자료 기반 제안 승인 구분.** 처음에는 현재 변경 계약을 유지한다. 자료를 승인한다면 immutable proposal payload, context/catalog/policy version, evidence identities, 만료와 server revalidation을 추가한다.
2. **저장 여부 불명확 복구.** COMMIT 뒤 응답 유실은 실패 확정이 아니다. 먼저 F2를 고치고 coherent reload로 확인한다. 자동 재전송을 제공할 때만 operation key와 request hash 및 응답을 같은 트랜잭션에 기록한다.
3. **시간표 기능의 별도 입력.** 체류시간·첫 출발시각·도착 후 다음 출발을 사용자가 정한 경우에만 연속 TRANSIT를 계산한다. 이동 실패 후의 다음 출발은 unknown이며 독립 조회 결과를 연속 일정처럼 합산하지 않는다.
4. **영업/실내 근거의 강도.** unknown hours를 폐쇄로 취급하지 않는다. 시설·요일별 실제 영업 확인, 우천 시 실내 범위를 별도 근거로 표현한다. 현행 OSM 분류만으로 개방을 보장하지 않는다.
5. **자료 수명과 승인 상태의 노출.** 수집 시각·적용 날짜·자료 확인 시각·행사 확정 여부를 분리한다. 별칭이 중단되면 이유와 재검토 대상은 보여주되 자동 승인하지 않는다.
6. **추천 평가의 기준.** 통과 테스트 수 외에 duplicate/closed/citation violation 0을 fixture invariant로 검사하고, 실제 장소 연결률·fallback 비율·실제 provider 성공률은 별도 데이터·운영 지표로 측정한다. fixture hit rate를 사용자 만족도나 LLM 품질로 주장하지 않는다.

## 6. 검증 범위

이번 재리뷰에서 전체 Vitest **429개/52파일**, 일회용 PostgreSQL의 CI 묶음 **361개/46파일**, Python **34개**, 타입·lint·서식·OpenAPI/DBML·build를 새로 실행해 통과했다. 전체 Playwright **33개**도 새로 실행해 통과했다. 이 중 이미 발행된 자료를 사용하는 관광 E2E 6개는 실제 로컬 DB와 provider fixture를 결합했고, 이번 검토에서 새 HARP 수집이나 운영 부하를 측정한 것은 아니다. 기존 운영 수정 당시 수치를 가져와 이번 실행으로 표기하지 않는다.

네 경계 진단은 [재현 코드](probes/tourism-rereview-20261006.mts)와 [전용 DB runner](probes/tourism-rereview-runner-20261006.mts)로 반복할 수 있다. 진단은 현재 결함이 존재함을 assertion으로 확인하므로 수정 후 실패할 수 있으며 CI 회귀 테스트가 아니다. 원하는 동작의 테스트는 반대 assertion과 양성 대조군으로 별도 작성해야 한다. F1–F3은 실제 PostgreSQL·HTTP에 순서를 고정하는 hook을 사용했고 F4는 injected transport다. O1은 실제 HTTP finish 지표다. hook은 복구되며 생성한 전용 DB 전체를 제거한다. 원본 DB에서 하위 probe를 직접 실행하면 시작 guard가 거절한다.

이전 관리자 401의 원인은 이번에도 확인하지 못했다. 이번 전체 실행은 통과했지만 이를 원인 해결이라고 평가하지 않는다. CPU/시간/실제 네트워크의 다양한 조건과 요청별 쿠키 유무·인증 결과의 비밀값 없는 진단이 후속 조사 범위다. 인증 재시도나 기대 상태 코드 완화로 숨기지 않는다.

검토한 범위: 관광/일반/날씨 추천·확정, 여행 read/write·revision·ACL·세션, provider/cache/gate/budget, 관광 검색/발행/출처 정책·collector, 추천 UI 상태와 지도 입력, 관측·CI·설정/종료. 정산의 모든 계산, 모든 화면 접근성, 전체 npm 내부 구현, 배포 호스트·AWS 계정·실제 Valhalla 포화·복원·침투검사를 전수 감사한 것은 아니다.

구조화된 결과·파일 해시·테스트 범위·원본 자료 보존은 [증거 JSON](tourism-rereview-evidence-20261006.json)에 남긴다. 무결함·무제한 용량을 보장하지 않고, 실제 운영 수치는 측정 전 unknown으로 둔다.
