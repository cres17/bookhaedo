# 검증 자료와 재현 방법

주 보고서: [Book해도 Drift Gate 검증·코드 리뷰](../bookhaedo-drift-gate-review-20261006.md).

- Book해도: `454a8707078d46d50db978df3ce539b9b0fa775c`
- 비교 기준: `3fa83a1cb386ca721ac2528b6401cf70592c8684`
- Drift Gate: `01e28e1620941a539d3e9c14972201b30adafd3b`
- 실행 정책: [review-policy.yml](review-policy.yml). 이번 평가에서 작성한 경로 동반 변경 규칙이며 CI에 설치하지 않았다.
- 선택적 LLM 호출 없음. 수집·발행·catalog 재적재 없음.

## 결과 읽기

`current.*`는 현재 38개 변경의 실제 CLI 판정이다. `no-policy.*`는 정책 미설정 대조군, `control-missing-api-docs.*`와 `control-missing-recovery-test.*`는 누락 차단 대조군이다. `control-old-provider-code.*`는 의도적 provider 회귀가 문서 검사에는 통과한 결과이고, 같은 두 파일을 되돌린 `control-old-provider-tests.log`는 9개 동작 테스트가 실패한 기록이다.

`historical-url-rejection.json`은 과거/현재 정책을 동일한 31개 URL에 실행한 Python·TypeScript 결과다. 원문 CSV를 지금 다운로드한 결과는 아니다. `source-url-cases.json`의 일부는 과거에 수집한 실제 URL, 나머지는 고정 경계 fixture다.

`contract-probe.test.ts.fixture`와 `browser-probe.spec.ts.fixture`는 **결함 존재를 확인하는 진단**이다. 통과는 제품이 정상이라는 뜻이 아니다. `.fixture` 확장자는 일반 회귀 테스트 자동 수집을 방지한다. 코드 수정 후에는 기대값을 바꾼 정상 회귀 검사를 별도로 작성한다.

`*-probe.log`와 `boundary-probe-results.json`이 이번 진단 결과다. `test-ci.log`, `full-vitest.log`, `full-e2e.log`, `python.log`와 정적 검사 로그는 이번 재실행의 기록이다. `checks.json`·`local-flow.json`에는 원래 실행 로그의 임시 경로도 남아 있으며, 같은 이름의 로그를 이 폴더에 보존했다.

## 재실행

아래 `$BOOKHAEDO`, `$DRIFT_GATE`, `$EVIDENCE`, `$PYTHON`은 각각 고정 커밋의 저장소, 도구 저장소, 새 출력 디렉터리, Drift Gate 의존성을 설치한 Python 경로로 설정한다. 비밀 환경변수나 `.env` 내용을 출력하지 않는다. 스크립트는 고정 커밋을 확인하며 다른 커밋을 같은 평가로 취급하지 않는다.

```sh
python3 -m venv /tmp/bookhaedo-dg-env
/tmp/bookhaedo-dg-env/bin/python -m pip install pyyaml 'tree-sitter>=0.26,<0.27' tree-sitter-language-pack==1.20.0
```

그 다음 해당 가상환경의 Python으로 실행한다. 최초 grammar 로딩은 네트워크/캐시 상태에 영향을 받을 수 있고 보고서 `analysis_notes`에 실제 분석 방법이 남는다.

```sh
"$PYTHON" run-gate.py --repo "$BOOKHAEDO" --tool "$DRIFT_GATE" --python "$PYTHON" --out "$EVIDENCE"
python3 run-behavior-controls.py --repo "$BOOKHAEDO" --out "$EVIDENCE"
```

첫 스크립트는 현재 변경과 문서 누락 대조군의 CLI 판정을 생성한다. 두 번째는 임시 복제본에서 이전 provider 코드의 테스트와 과거/현재 URL 정책을 실행한다. Book해도의 기존 `node_modules`를 읽으므로 의존성 설치가 필요하다. 두 스크립트 모두 원본 운영 코드를 변경하지 않는다. 외부 optional LLM 키는 빈 값으로 지정한다.

DB·브라우저 재현에는 PostgreSQL/PostGIS와 테스트 DB 생성 권한, Book해도 의존성, Chrome(macOS) 또는 Playwright Chromium이 필요하다. 실제 테스트용 DB는 runner가 새 이름으로 생성하고 종료 시 제거한다. **fixture를 원본 DB에서 직접 실행하지 않는다.**

```sh
python3 prepare-boundary-probes.py --repo "$BOOKHAEDO" --target /tmp/bookhaedo-boundary-review-copy
# Book해도 루트에서 실행: tsx와 기존 비공개 DB 설정을 정상적으로 읽기 위한 cwd
node --import tsx "$EVIDENCE_SOURCE/run-boundary-probes.mts" "$BOOKHAEDO" /tmp/bookhaedo-boundary-review-copy "$EVIDENCE"
```

`$EVIDENCE_SOURCE`는 이 README가 있는 자료 폴더다. 출력 디렉터리는 먼저 생성한다. UI 진단은 5273/3101 포트를 사용하며, 복제본에만 포트 설정과 두 진단 파일을 추가한다. 준비 스크립트는 이미 존재하는 대상 폴더를 덮어쓰지 않는다. 검증 후 임시 복제본은 정리할 수 있다.

## 해석 제한

이번 정책은 현재 변경의 동반 산출물 확인용이다. 고정 날짜의 보고서 경로를 가진 상태로 영구 CI에 넣으면 안 된다. 지속 정책, 정책 변경 승인, 필수 정책 옵션과 실제 응답 스키마 검사를 함께 설계한다.

Drift Gate 자체의 전체 테스트/설치형 앱 검증은 이번 범위가 아니다. 도구 소스 CLI의 실제 적용과 대조군을 검증했다. 과거의 합성 벤치마크 수치를 이번 Book해도 정확도로 환산하지 않는다.
