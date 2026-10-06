# 2026-10-06 경계 재현 자료

대상은 `ver2@9e29e46`이다. 이 코드는 **당시 결함이 재현되는지 확인하는 진단 자료**이며 CI 회귀 테스트가 아니다. 수정 후 assertion이 실패하면 문제가 해결된 것일 수 있다. 원하는 동작의 회귀 테스트는 반대 기대값과 정상 대조군으로 별도 작성한다.

저장소 루트에서 실행한다. 기존 설치 의존성(Node/tsx/pg)을 사용한다.

```sh
node --import tsx docs/research/probes/tourism-boundaries-20261006.mts "$PWD"
node --import tsx docs/research/probes/tourism-db-probe-runner-20261006.mts "$PWD"
```

첫 명령은 원본 함수와 LangGraph를 통제된 입력으로 호출하고 loopback HTTP 연결을 중단한다. 실제 provider를 호출하거나 DB 자료를 쓰지 않는다. `.env`는 기존 db 모듈의 초기화 때문에 로드될 수 있지만 값을 출력하지 않는다.

두 번째 명령은 설정된 PostgreSQL 연결에 CREATE DATABASE 권한과 PostGIS가 있어야 한다. UUID 이름의 일회용 DB를 만들고 빈 schema/migration과 가상 자료로 두 경계 사례를 재현한 다음 삭제한다. 원본 catalog를 복사하거나 원본 출처에 발행·철회를 하지 않는다. 하위 `tourism-db-boundaries` 파일을 원본 DB에 직접 실행하지 않는다. 강제 프로세스 종료/호스트 장애 시에는 finally가 실행되지 않을 수 있으므로 `bookhaedo_review_` 임시 DB 잔존을 확인해야 한다.

실험의 약 84ms는 80ms 지연을 넣은 한 번의 실행 결과다. 운영 성능 측정이나 항상 같은 밀리초 값을 보장하는 테스트가 아니다. 날씨·대중교통 응답은 합성 자료다. DB 반례는 실제 SQL과 트랜잭션 사이에 barrier를 넣어 순서를 고정했다.

결과와 해석은 [리뷰](../tourism-deep-review-20261006.md), [구조화된 증거](../tourism-deep-review-evidence-20261006.json), [목표 설계](../tourism-architecture-workflows-20261006.md)에 있다.

## 운영 수정 후 재리뷰: ver2@3fa83a1

새 진단은 과거 `9e29e46` 반례를 대체하지 않는다. 실제 PostgreSQL·HTTP에서 F1 이동 수단 변경과 확정의 경쟁, F2 revision/items의 서로 다른 읽기 시점, F3 날씨 대안의 정규화 시설 중복을 재현한다. F4는 주입한 provider 응답으로 geometry 검증·캐시를 확인한다. O1은 실제 HTTP 완료 지표에서 중첩 route 이름을 확인한다. F1의 결함 판정은 확정 시점의 제품 계약에 의존한다.

```sh
node --import tsx docs/research/probes/tourism-rereview-runner-20261006.mts "$PWD"
```

CREATE DATABASE 권한과 PostGIS가 필요하다. runner는 UUID로 이름을 만든 `bookhaedo_rereview_*` DB만 생성·제거하며 원본 catalog를 복사하지 않는다. 하위 진단은 해당 이름 guard가 있는 전용 DB에서만 실행한다. 쿠키는 메모리에만 두며 값·환경변수·접속 문자열을 출력하지 않는다. 정상 종료·실패 때 DB를 제거하지만 프로세스 강제 종료 시 잔여 DB는 생성 이름을 확인하고 관리자가 정리해야 한다.

이 파일 역시 **현재 경계 현상을 확인하는 진단 assertion**이다. 문제를 고치면 일부 assertion이 실패하는 것이 정상이며, CI에 그대로 편입하지 않는다. 원하는 동작을 검사하는 회귀 테스트는 반대 기대값과 정상 대조군으로 작성한다. 실제 provider 장애·브라우저 crash·운영 부하·인증 일회성 실패의 원인을 증명하지 않는다.

- [상세 리뷰](../tourism-rereview-20261006.md)
- [목표 아키텍처와 워크플로우](../tourism-rereview-architecture-20261006.md)
- [검증 증거](../tourism-rereview-evidence-20261006.json)
