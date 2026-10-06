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
