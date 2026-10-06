# Book해도 운영 반례 수정 — 2026-10-06

기준은 `ver2@3fa83a1`과 [재리뷰](tourism-rereview-20261006.md), [목표 설계](tourism-rereview-architecture-20261006.md)다. 과거 리뷰·반례·증거는 기준 커밋의 기록으로 보존한다. 아래는 이번 패치로 실제 적용한 범위이며, 목표 문서의 모든 미래 기능을 구현했다는 뜻이 아니다.

## 적용한 운영 계약

| 항목             | 구현                                                                                                                                                                   | 검증                                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| F1 확정 문맥     | 일정·메모·시간·예산·설정·날짜 추가·삭제는 trip→day/item 잠금 순서. 부모 잠금 이후 새 SQL 문장에서 owner/member 접근을 재검사. 잠금 대기 3초 초과는 409/TRIP_WRITE_BUSY | mode 먼저 커밋하면 확정 409·무변경. 확정이 먼저 잠그면 mode 쓰기는 COMMIT 뒤 완료. 회원 접근 제거·삭제/날짜 추가 경쟁·잠금 timeout  |
| F2 조회 snapshot | trip 메타데이터·현재 ACL·days/revisions·ordered items를 한 SQL snapshot으로 반환. requireTrip의 과거 메타데이터와 결합하지 않음                                        | 조회 직후 다른 트랜잭션이 title/mode/revision/items를 바꿔도 응답 전체는 이전 상태, 다음 조회 전체는 새 상태                        |
| F3 시설 중복     | 날씨 순위와 확정에서 같은 sameRecommendationFacility 사용. target 제외한 remaining 일정과 replacement 비교                                                             | NFKC 이름과 1m 거리의 다른 ID 거절. 떨어진 별도 지점 허용. 거절 시 항목·revision 전부 보존                                          |
| F4 외부 geometry | unknown JSON을 Zod schema로 검사. Google polyline 1e5, Valhalla 1e6 디코딩·좌표 범위·점 수·문자 길이 검증. 정상 cache 이전 적용                                        | 위도 95°·범위 밖 경도·잘린 shape·객체/숫자/배열 polyline·과다 크기 거절, 다음 정상 응답 복구. 유효 0값·경계 좌표 보존               |
| O1 API 지표      | 관광·일반·날씨 추천/확정 및 여행 조회에 고정 operation template 등록                                                                                                   | 중첩 day-alternatives가 `/` 대신 전체 고정 template으로 집계. 실제 trip ID는 지표에 없음                                            |
| 유지 항목        | 삭제/재삽입 대신 삭제된 장소만 제거하고 기존 position을 빈 구간으로 이동한 뒤 재정렬. 공통 replaceDayItems 사용                                                        | 유지된 item ID·note·estimatedCost·start/endMinute 보존, 새로운 항목은 기본값. unique position 제약 유지                             |
| 화면 복구        | 409 확정 실패 후 preview 제거. 조회 실패의 기존 코스 선택 재시도 유지. 네트워크/5xx 저장 결과 불명확은 확인 전 재저장 차단                                             | desktop/mobile에서 409, 서버에 도달 전 연결 실패, 실제 COMMIT 후 응답 유실. 확인 버튼의 GET 후 새 상태 표시. 자동 PATCH 재전송 없음 |

F1은 설계에서 선택한 강화 계약이다. mode 값 자체의 검사 시점만 보장하는 기존 해석을 일괄 보안 결함으로 재분류하지 않는다. 확정 뒤에 순서대로 mode를 변경하는 것은 허용한다. mode A→B→A의 중간 변경 이력을 모두 거절하는 context version은 추가하지 않았다.

## 잠금 범위와 데이터 보호

`lockTripForWrite`는 인증 완료 요청에 대해 부모 trip을 잠근 뒤 현재 owner/accepted-member를 다시 읽는다. 여행 삭제는 ownerOnly로 검사한다. 초대 수락은 아직 회원이 아닌 사용자이므로 기존 초대 자격 검사를 유지하면서 trip→invitation 순서를 사용한다. 정산 쓰기도 trip→expense 순서로 맞췄다. 외부 provider를 호출한 채로 쓰기 잠금을 유지하지 않는다.

추천 확정은 정렬된 catalog ID를 `COLLATE "C" FOR SHARE`로 잠근 뒤 현재 적격성과 중복을 확인한다. 기존 catalog 적재 도구도 같은 ID 정렬 순서로 갱신한다. 이번 검증에서 원본 catalog 적재를 실행하지 않았고 SQL schema/migration은 바꾸지 않았다. 계정 정지·세션 삭제까지 COMMIT 전에 보호하는 principal 잠금 계약은 이 trip 잠금만으로 보장하지 않는다.

`replaceDayItems`는 위치를 먼저 기존 최대 위치와 새 목록 길이보다 큰 offset으로 이동해 UNIQUE(day_id,position) 충돌을 피한다. 현재 SQL transaction 안에서만 중간 위치가 존재한다. retained의 모든 사용자 필드와 ID를 유지하며 removed/added만 삭제/생성한다. 직접 목록 변경과 관광 추천 확정에 모두 사용한다.

## 외부 입력과 시간 예산

경로 body는 Content-Length 유무와 관계없이 읽은 bytes를 제한한다. 안전 상한은 body 2MiB, encoded shape 262,144문자, 총 20,000점, Valhalla 64개 leg다. 실제 서비스 용량이나 최적값 측정 결과가 아니며 향후 정상 응답 분포에 따라 검토할 방어 상한이다. 잘못된 geometry는 정상 경로/완료 cache로 승격하지 않는다. Google geometry가 부재하면 null로 정제하고 유효한 경로 수치는 유지한다. 지도는 유효한 geometry가 없는 구간을 회색 점선과 직선 안내로 표시하며 도로 경로선으로 승격하지 않는다. 지도 입력도 공유 좌표 범위/점 수 규칙으로 재검사하고 SDK decode 오류는 같은 fallback으로 처리한다. 이는 명시적 계약이며 geometry의 부재를 잘못된 객체와 구분한다. endpoint snap 거리는 측정 전 임의 기준을 추가하지 않았다.

크기 초과 응답은 body cancellation 완료를 기다리지 않고 거절한다. 취소가 영원히 완료되지 않는 주입 stream도 거절을 붙잡지 않는 회귀 검사를 포함한다. 정상 body 완료까지 Valhalla permit을 유지하는 기존 gate 검사는 실제 Response stream을 지연시키도록 바꿨다. 정상 응답 fixture의 잘못된 `abc` polyline은 유효한 인코딩으로 바꿨으며 거절 기대값을 완화하지 않았다.

여행 전체 GET의 handler scope는 15초이고 SQL은 readQuery의 3초/wire 3.5초·기존 취소/연결 폐기 정책을 따른다. 인증·rate limiter·requireTrip 대기는 이 handler 기한 이전이다. 전체 admission 기한을 구현했다고 표시하지 않는다.

화면의 저장 fetch 대기는 30초, 상태 확인 GET은 15초다. 이 숫자는 클라이언트 대기 상한이며 SLA나 서버 transaction 취소 보장이 아니다. 저장 fetch가 끝나지 않거나 실패해도 COMMIT 여부를 추정해 재전송하지 않는다. 현재 상태를 읽어 다시 표시하며 operation-result/idempotency/exactly-once는 구현하지 않았다. 상태 조회 당시에도 다른 쓰기가 진행 중일 수 있으므로 이 GET이 과거 command의 정확한 처리 이력을 증명한다는 주장을 하지 않는다.

## 재현과 회귀

첫 신규 테스트 실행에서는 수정 전 14개가 실패했다. 당시 실행한 subset과 로그 hash는 별도 [검증 증거](tourism-rereview-implementation-evidence-20261006.json)에 보존한다. 이후 테스트에는 반대 순서의 경합·항목 ID 보존·권한 변경·lock timeout·body 크기/취소 사례를 추가했다.

현재 원하는 동작의 검사는 `tests/review-write-boundaries.test.ts`, `tests/route-response-validation.test.ts`이며 test:ci에 포함된다. `tests/e2e/tourism-save-recovery.spec.ts`의 두 viewport 검사는 test:e2e:tourism에 포함되어 기존 GitHub Actions tourism-e2e job에서 실행된다. 과거 `docs/research/probes/tourism-rereview-*.mts`는 3fa83a1의 결함 존재를 검사하는 역사적 진단이므로 최신 운영 코드에서 회귀 검사로 실행하지 않는다.

전체 실행 중 발견한 조회 재시도 UI 회귀는 기존 E2E를 그대로 유지해 잡고 수정했다. 실제 제한 응답 뒤 이전 목록을 유지하는 기존 429 검사도 통과해야 한다. 초기 실패·수정 과정의 실행과 최종 성공 결과를 구분한다.

## 최종 로컬 검증

전체 Vitest 54파일·463개, 일회용 PostgreSQL CI 묶음 48파일·395개, Python 34개, 전체 Playwright 35개와 lint/typecheck/format/spec/build가 통과했다. Playwright는 기존 로컬 발행 자료 E2E를 켠 실행이다. 원본 catalog 20,810곳·tourism snapshot 7개·record 184개·withdrawal 0개 및 출처 설정이 검증 전후 정확히 같다. 일회용 CI DB는 제거했다. 실제 catalog 적재·신규 HARP 수집·운영 부하·복원은 실행하지 않았다.

GitHub CI 결과는 해당 ver2 커밋의 Actions 기록과 이 작업의 최종 응답에서 확인한다. 아래 증거 JSON은 로컬 검증과 파일 해시를 보존한다.

## 남은 목표

- pre-admission/session/rate store까지 포함한 상위 read deadline와 실패 사유별 내부 enum
- CI whitelist 밖의 catalog 의존 6개 전체 테스트 파일을 빈 DB fixture로 전환
- graph의 Router/SQL helper 결합 제거와 DTO 타입 확장
- 자동 재전송 요구가 있을 때 operation-result/idempotency, context version과 저장 proposal 계약
- 실제 배포의 부하·다중 프로세스 provider 용량·backup/restore, 필요할 때만 distributed origin lease/checkpoint
- 이전 일회성 인증 401의 원인 조사. 이번 성공을 원인 해결로 주장하지 않음

LLM/AWS 연결, 자동 수집 스케줄·분산 worker·운영 배포는 이번 코드 수정 범위가 아니다. 기존 LangGraph의 규칙 생성·자료 권리/철회 재검사·TRANSIT 독립 비교 의미는 유지한다.
