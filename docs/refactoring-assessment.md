# Book해도 엔터프라이즈 운영 준비 평가

기존 평가 기록: 2026-09-14. 아래 수치와 판정은 당시 작업본의 기록이다. 최신 병합본의 재검증 범위는 [2026-09-28 통합 검증](release-verification-20260928.md)을 기준으로 확인한다. 클라우드 운영 승인을 뜻하지 않는다.

## 판정

**저장소 기준 엔터프라이즈 운영 후보 수준**이다. 인증·여행별 접근 제어·데이터 무결성뿐 아니라 다중 인스턴스 요청 제한, 구조화 관측, 경보 규칙, 백업 복원 훈련, 부하 임계값과 반복 CI가 실행 가능한 형태로 연결됐다.

이 판정은 실제 클라우드 운영 승인이 아니다. 운영 계정·TLS·비밀 회전, 관리자 MFA/SSO, 다중 AZ 장애조치, 리전 외 복원, 실제 트래픽 형태의 장시간 시험은 배포 환경에서만 검증할 수 있다.

## 구현·검증 근거

| 영역 | 구현 | 검증 근거 |
|---|---|---|
| 아키텍처 | `app.ts`는 보안·관측·제한·권한·라우터를 조립한다. HTTP·인증·관측·도메인 책임을 디렉터리로 분리했다. 프런트 라우터, 여행 도구 상태, 동시편집 polling을 별도 모듈로 캡슐화했다. | 타입 검사·린트·기존 화면 회귀. 경계와 확장 규칙은 `docs/architecture.md`에 명시 |
| 접근 제어 | 모든 여행 하위 API는 소유자 또는 수락 동행자를 확인한다. 삭제·초대 관리는 소유자만 가능하다. | API, 공동 여행, 관리자, 동시성 테스트 |
| 인증·세션 | 비동기 scrypt, 저장 해시·쿠키 형식 검사, HttpOnly/SameSite/Secure 쿠키. 회원과 첫 세션을 한 트랜잭션에서 만든다. 만료 세션은 정기 제거한다. | 정상·오류 비밀번호, 변형 쿠키, 탈퇴·세션 회귀 |
| API 오류 | `code`, `error`, `requestId` 공통 계약. 입력 400, 충돌 409, 일부 DB 장애 503, 내부 오류 500. | JSON 파싱·크기·없는 경로·인증·DB 실패 테스트. SQL·토큰·원본 오류 메시지는 응답에서 제외 |
| DB 무결성 | revision·행 잠금, 지연 constraint trigger 정산 합계, 개인 지출 소유자, rollback 실패 연결 폐기. | 경쟁 수정, 불균형 COMMIT 거절, 원자적 분담 교체, 연결 누수 회귀 |
| 마이그레이션 | 버전·SHA-256·적용 이력, 순서 검증, 트랜잭션과 advisory lock. production 기동은 DDL을 실행하지 않고 이력만 검증한다. | 기존·신규 DB, 재실행·동시 실행·변조·누락·실패 rollback 검사 |
| 중앙 요청 제한 | PostgreSQL 원자 카운터를 모든 인스턴스가 공유한다. 원문 IP·세션·사용자 ID 대신 SHA-256을 저장하고 정책별 window를 분리한다. | 독립 store 2개에서 20개 동시 증가가 정확히 1..20, 원문 미저장 확인. 부하 시험이 실제 limiter를 통과 |
| 관측 | 요청 ID JSON 로그, 정상 요청 표본화, 5xx·느린 요청 전량 기록. Prometheus 요청·지연 histogram·in-flight·DB pool·process 지표. | query 값 미수집, path cardinality 정규화, production bearer 인증 테스트. 수집·경보 예시 제공 |
| 브라우저 보안 | production CSP 활성화. Swagger inline script/style을 정적 파일로 이동하고 Google·Swagger 출처를 명시. Origin 검사와 제한된 proxy hop 설정 검증. | production 설정 validation과 빌드·브라우저 회귀 |
| 백업 복원 | custom-format dump, SHA-256, 행 수·migration metadata. 고유 임시 DB 복원·대조·항상 삭제. | 실제 로컬 DB 20,810개 장소 포함 복원 성공, 4개 migration 이력 일치, 임시 DB 제거 확인 |
| 부하 | 중앙 limiter와 `geo_data.place` 집계를 지나는 재현 가능한 load gate. 원격 오실행 방지. | 최종 로컬 5초·동시성 20: 12,752 요청, 2,550.4 req/s, 오류 0%, p95 10.37ms, p99 13.45ms, 최대 105.19ms |
| 자동화 | PR CI의 정적·DB·계약·빌드·부하 검사와 주간 PostgreSQL 17 백업·복원 훈련 workflow. | 로컬 명령 검증 완료. 새 GitHub workflow의 원격 첫 실행은 아직 없음 |

## 이번 실행 결과

- `npm test`: 23개 파일, 137개 테스트 통과
- `npm run test:load:ci`: 12,752 요청, 오류 0%, p95 10.37ms로 기준 통과
- 실제 백업·복원: SHA-256 일치, 장소 20,810·사용자 6·여행 2·지출 0, migration 4개 일치, 임시 DB 제거
- `npm run test:e2e`: 최종 요청 제한 정책으로 Chrome 21개 통과. 관리자·공동여행·정산·일정·재로그인·실제 Google/날씨/경로·모바일 흐름 포함
- 타입 검사, 린트, 서식, OpenAPI 44 paths, DBML 25 tables, production 빌드 통과

## 운영 배포 승인에 필요한 외부 증거

| 우선순위 | 승인 항목 | 완료 기준 |
|---|---|---|
| 높음 | 실제 DB 복구 | 관리형 DB snapshot과 리전 외 archive에서 격리 환경 복원, 합의한 RPO/RTO 달성 기록 |
| 높음 | 비밀·권한 | 앱 DML/배포 DDL 계정 분리, TLS 강제, secret manager 회전, 접근 로그 확인 |
| 높음 | 관측 연결 | 중앙 로그, Prometheus, Alertmanager 수신자와 dashboard 연결 후 인위적 5xx·pool 대기 경보 수신 확인 |
| 높음 | staging 용량 | 예상 peak의 2배로 30분 이상 soak test, p95/SLO·CPU·메모리·DB pool·외부 할당량 통과 |
| 높음 | 관리자 보안 | MFA/SSO 또는 동등한 강화 인증, break-glass·감사 검토 절차 운영 승인 |
| 중간 | 장애 대응 | DB failover, Google·Open-Meteo·Valhalla 전체 장애, 종료 신호 중 요청 처리 game day |
| 중간 | 계정 수명주기 | 이메일 검증·비밀번호 재설정·전체 세션 폐기·개인정보 보존 정책 확정 |

로컬 수치를 production 처리량이나 SLA로 사용하면 안 된다. 배포 환경의 첫 workflow·복원·경보·soak 결과가 위 기준을 만족하면 운영 승인으로 전환할 수 있다.
