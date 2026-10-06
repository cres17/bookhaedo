# Drift Gate 대조군에 따른 운영 코드 수정

검증일: 2026-10-06. 기준 Book해도 커밋: `454a8707078d46d50db978df3ce539b9b0fa775c`. 도구: Drift Gate `01e28e1620941a539d3e9c14972201b30adafd3b`, Python 3.11, optional LLM 비활성.

[이전 리뷰](../bookhaedo-drift-gate-review-20261006.md)와 [원본 증거](../drift-gate-validation-20261006/manifest.json)는 수정 전 기록이다. 원본 해시를 보존하고 수정·검증 기록을 이 폴더에 분리했다.

## 반례와 수정

| 항목 | 수정 전 재현 | 수정 후 |
|---|---|---|
| B1 저장 결과 불명확 상태의 수명 | 숨기기/다시 켜기 뒤 복구 안내가 사라짐. 양성 회귀 검사 두 화면 폭 실패 | 사용자·여행·날짜별 패널 외부 상태, 같은 탭 sessionStorage 최소 메타데이터 복원 |
| B2 실제 409와 문서 불일치 | 실제 세 HTTP 잠금 충돌은 409인데 OpenAPI 응답 누락. 기존 10개 통과/새 1개 실패 | 세 작업에 TripWriteConflict 선언, 실제 상태·코드·필수 필드·변경 없음 대조 |
| 추가 경계: 늦은 성공 | 날짜 전환 뒤 성공 응답의 완료 알림 없음. 두 화면 폭 실패 | 사용자·여행별 완료 버전으로 현재 부모 화면 갱신. 다른 여행에 알림을 전파하지 않음 |
| D1 미설정 Gate 통과 | 기존 CLI는 정책 없음에도 PASS/규칙 0개 | Book해도 wrapper는 정책 없음·빈 규칙·실행 오류를 exit 2로 거절 |

코스 저장의 원래 endpoint와 payload를 캡처한다. 늦은 응답이 다른 날짜의 미리보기를 지우지 않으며, 이전 command의 완료가 새 command를 해제하지 않는다. 조회 성공 snapshot은 부모에 직접 적용해 확인 직후 동일 여행의 두 번째 GET을 제거한다. 성공 알림은 저장 완료를 나타내며 snapshot 갱신 실패 시 부모 오류 안내를 유지한다.

[복구 계약](../../architecture/recommendation-recovery.md), [품질 검사 계약](../../quality-gates.md), `.drift-gate.yml`이 지속 문서/검증 경로다. 날짜가 고정된 이 보고서 자체를 매 PR마다 갱신하도록 요구하지 않는다.

## 최종 로컬 검증

- 전체 Vitest: 55개 파일 **471개 통과**.
- 새로 만든 빈 PostgreSQL/PostGIS DB의 CI 묶음: 49개 파일 **403개 통과**, DB 제거 확인.
- Python: **34개 통과**.
- 전체 Playwright: **35개 통과**. `TOURISM_PUBLISHED_E2E=1`로 기존 발행 DB 자료 검증도 포함. 이번에 새 자료를 수집/발행한 결과는 아니다.
- lint, typecheck, format:check, spec:check, build 통과. OpenAPI 45 paths/DBML 29 tables.
- 별도 빈 DB의 지역 조회 CI 부하 검사: 동시성 20/5초/오류 0, p95 13.18ms. 이는 `/api/regions` 회귀 기준이며 추천·Valhalla 운영 용량으로 환산하지 않는다.
- 저장 복구 상태 단위 검사 7개와 실제 409 검사 1개는 `test:ci` 목록에 포함. 확장된 두 화면 폭의 저장 E2E는 기존 관광 CI 작업에 포함.

`before-api-contract.log`, `before-recovery-e2e.log`, `before-late-success-e2e.log`는 의도한 수정 전 실패 기록이다. 최종 `test-ci.log`, `full-vitest.log`, `full-e2e.log`는 실패 기록과 구분한다. 이전 중간 성공 결과에 추가 결함을 덮어쓰지 않고 최종 전체 실행을 다시 수행했다.

## Drift Gate 판정과 차단 대조군

고정 도구의 독립 복제본을 사용했다. 사용자 Drift Gate 저장소에 진행 중인 코드 변경이 있어 원래 체크아웃을 수정하거나 최신 검증에 섞지 않았다.

| 입력 | 기대/실제 종료 코드 | 의미 |
|---|---|---|
| 최신 수정안 | 0 / 0 | 6개 구성 규칙 중 발동한 3개 동반 변경 규칙 충족 |
| OpenAPI 3개 변경만 되돌림 | 1 / 1 | api-contract 차단 |
| 복구 E2E 변경만 되돌림 | 1 / 1 | course-recovery 차단 |
| 정책 삭제 | 2 / 2 | 검증 미설정을 PASS로 취급하지 않음 |
| 빈 정책 | 2 / 2 | 규칙 0개를 PASS로 취급하지 않음 |
| 도구 추적 소스 변경 | 2 / 2 | 고정 코드 보호 |
| 도구 미추적 소스 추가 | 2 / 2 | HEAD만 같고 코드가 다른 실행 차단 |
| 잘못된 Git 기준 + 기존 PASS JSON | 2 / 2 | 이전 PASS 파일 제거, 실행 실패 차단 |

원본은 [gate/controls.json](gate/controls.json)에 있다. 정책은 `content: paths`인 동반 변경 검사다. 세 발동 규칙 통과를 세 기능의 정확성 증명으로 해석하지 않는다. 앞선 provider 회귀 대조군은 문서가 함께 바뀌면 Gate가 PASS해도 실제 테스트 9개가 실패함을 보여 준다. 이번에도 실제 DB·HTTP·브라우저 검증을 별도로 실행했다.

## 재실행

새 파일을 Git diff에 포함하고 고정한 도구 버전을 사용한다. `.env` 값이나 키를 출력하지 않는다. 의존성은 이전 자료 README의 Python 설치 설명을 따른다.

```sh
npm run check:drift -- --base 454a8707078d46d50db978df3ce539b9b0fa775c --tool "$BOOKHAEDO_DRIFT_TOOL" --python "$BOOKHAEDO_DRIFT_PYTHON"
python3 docs/research/drift-gate-fixes-20261006/run-controls.py --repo . --base 454a8707078d46d50db978df3ce539b9b0fa775c --tool "$BOOKHAEDO_DRIFT_TOOL" --python "$BOOKHAEDO_DRIFT_PYTHON" --out /tmp/bookhaedo-gate-recheck
```

대조군 스크립트는 임시 복제본만 수정하며 종료 시 삭제한다. Book해도와 도구 원본은 수정하지 않는다. DB/API/E2E는 저장소의 기존 테스트 명령을 사용하고 필요한 DB와 브라우저를 준비한다.

## 남은 경계와 후속 작업

1. Drift Gate는 현재 로컬 사전 검사다. GitHub CI 연결 전 신뢰하는 기준 정책과 PR의 정책 약화를 구별해야 한다.
2. 브라우저 저장소 거절 시 살아 있는 탭의 상태만 유지한다. 현재 일정 GET은 조회 시점 확인이며 과거 명령의 처리 이력을 증명하지 않는다. 다중 탭·서버 idempotency·영구 명령 조회는 이번 구현 범위 밖이다.
3. CI 테스트 파일 목록 누락 감지, provider 실패 사유 지표, 인증/ACL을 포함한 전체 조회 시간 예산은 이전 리뷰의 후속 작업으로 남는다.
4. 실환경 추천·Valhalla 부하/복원 측정은 로컬 fixture 및 지역 조회 부하 검사와 구분한다.

실제 배포 또는 AWS 연결을 수행한 작업은 아니다. 소유자/수락 동행자 접근 검사, revision·이동수단·장소 순서 검증과 쓰기 잠금은 계속 적용된다.
