# 동시 수정·저장 복구 시나리오 대조표

기준: `main` a9a5f30 + PR #16. 각 시나리오가 어떤 자동 검사로 보장되는지, 검사가 없는 부분이 무엇인지 기록한다.

| # | 상황 | 기대 결과 | 근거 검사 | 상태 |
|---|---|---|---|---|
| 1 | 두 사용자가 같은 revision에서 전체 저장 | 하나만 성공, 다른 하나 409, 조용한 덮어쓰기 없음 | `tests/concurrency.test.ts` "동일 버전의 두 전체 저장 중 하나만 성공하고 다른 하나는 409다", "버전 없는 전체 저장은 428" | 기존 검사로 보장 |
| 1-1 | 동시에 서로 다른 장소 추가 | 둘 다 유지, 같은 장소 중복은 409 | `tests/concurrency.test.ts` "동시 장소 추가는 서로를 잃지 않고 중복은 409로 구분한다" | 기존 검사로 보장 |
| 2 | 저장은 커밋됐지만 응답 유실 — 하루 코스 확정 | 재조회로 결과 확인, 중복 쓰기·잘못된 성공 표시 없음 | `tests/e2e/tourism-save-recovery.spec.ts` (`fault: 'after'`, 390/1440px) | 기존 검사로 보장 |
| 2-1 | 저장은 커밋됐지만 응답 유실 — 일정 순서 변경·삭제 | 화면이 저장된 순서를 보여 주고 저장됨을 알림 | `tests/e2e/planner-save-recovery.spec.ts` | **결함 발견·수정 (PR #16).** 수정 전에는 화면이 저장 전 순서에 머묾 |
| 3 | 서버 도달 전 연결 실패 | 미완료 변경을 완료로 표시하지 않음 | `tourism-save-recovery.spec.ts` (`fault: 'before'`), `planner-save-recovery.spec.ts` (`before`) | 보장 |
| 4 | 동행자 권한이 사라진 뒤 수정 | 현재 권한 기준으로 거부, 일정 변경 없음 | `tests/review-write-boundaries.test.ts` "rechecks accepted membership after waiting for the parent trip lock" (락 대기 중 멤버십 삭제 → 404, 일정 불변), `tests/collaboration.test.ts` 탈퇴·초대 취소 검사 | 보장. 단, **동행자를 내보내는 API는 없음** (초대 취소·본인 탈퇴만 존재). 검사는 DB에서 멤버 행을 직접 지워 상황을 만든다 |
| 5 | 추천 조회 중 일정 변경 후 확정 | 오래된 추천 확정 거부 | `concurrency.test.ts` "메모 저장도 버전을 올려 … 대안 확정을 차단", `STALE_ITINERARY` 검사, `tests/e2e/reliability.spec.ts` "날짜를 바꾸면 이전 하루 추천을 닫고 확정할 수 없다" | 기존 검사로 보장 |

## 남은 빈틈

- `Planner.vue`의 `shiftVisit`, `saveVisit`, `saveNote`, `saveBudget`도 409일 때만 다시 불러온다. 응답이 유실되면 2-1과 같은 불일치가 생길 수 있지만 아직 재현 검사가 없다.
- `saveNote`는 성공 응답에서만 화면의 revision을 갱신한다. 응답이 유실되면 다음 쓰기가 409로 거절된 뒤에야 최신 상태를 불러온다.

## 실행

```bash
npm run db:init
npm run test:ci
npx playwright test tests/e2e/planner-save-recovery.spec.ts tests/e2e/tourism-save-recovery.spec.ts
```
