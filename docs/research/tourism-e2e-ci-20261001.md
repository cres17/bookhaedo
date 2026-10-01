# 관광 추천 E2E의 CI 편입 — 2026-10-01

`quality`에 독립 `tourism-e2e` 작업을 추가했다. 기존 `verify`의 단위·DB·부하·빌드 검사와 별도 빈 PostGIS 17/3.5 DB에서 `npm run test:e2e:tourism`을 실행한다. Playwright Chromium과 시스템 의존성을 설치하며, 데스크톱 1440px·모바일 390px의 관광 추천 검사 2개만 대상으로 한다.

## 재현 조건과 검사 범위

기존 검사는 적재된 삿포로 장소 5개를 조회했고 캡처를 `/private/tmp`에 저장했다. 수정 후에는 매 테스트의 UUID 장소 5개를 직접 삽입하고 자신의 ID로만 조회·정리한다. 계정·여행·초기 일정 생성 응답도 먼저 검사해 준비 단계의 실패 원인을 보여준다. 캡처는 `testInfo.outputPath`에 저장하므로 Linux와 macOS에서 같은 테스트 코드가 동작한다.

코스·근거·날씨·경로 표시에는 fixture를 사용한다. 출처·미확정 표기, HTML 문자 안전 표시, 409·429·네트워크 오류 뒤 목록 보존, 조건 변경 시 미리보기 무효화, 유지 장소 조건, 확정 저장을 검사한다. 실제 인증 사용자로 다른 빈 여행에 추천 POST 30개를 보내고, 화면의 코스 미리보기 POST를 실제 API로 전달해 31번째 429를 확인한다. 오류 코드·Retry-After, 기존 코스 유지·교체 버튼 제거·기존 일정 보존을 검사한다. 이후 fixture 미리보기를 복원해 실제 확정 PATCH와 저장 DB도 검사한다.

실제 HARP를 수집·발행하거나 실제 외부 경로를 CI에서 호출하지 않는다. `tourism-published.spec.ts`와 외부 서비스 연동을 사용하는 나머지 전체 E2E는 별도 로컬 검사로 유지한다. 관광 CI 명령은 하나의 파일만 선택한다.

## CI와 실패 기록

`CI=true`에서는 기존 서버를 재사용하지 않고 `test.only`를 거절한다. macOS에서도 CI 모드에서는 설치된 Playwright Chromium을 사용하므로 로컬에서 같은 브라우저 실행 경로를 확인할 수 있다. 로컬 기본 실행은 기존 Chrome/서버 재사용 정책을 유지한다. worker는 1개이며 자동 재시도로 실패를 숨기지 않는다.

실패 시 `playwright-report/`와 `test-results/`를 `tourism-e2e-failure` artifact에 7일 보관하도록 설정했다. 기본 오류 화면·trace와 HTML 보고서, 각 조건의 수동 캡처가 여기에 포함된다. 브라우저 설치나 준비 단계가 실패해 결과 파일이 생성되지 않으면 업로드할 파일이 없을 수 있다. [Playwright 공식 CI 안내](https://playwright.dev/docs/ci)와 [테스트별 출력 경로](https://playwright.dev/docs/api/class-testinfo#test-info-output-path)를 참고했다.

## 직접 실행한 검증

- 고유한 일회용 로컬 PostgreSQL 17.5/PostGIS 3.5.2 DB에 스키마만 초기화했다. 시작 시 catalog·관광 record·사용자는 모두 0개였다.
- 외부 Google 키를 비운 `CI=true` 환경에서 Playwright 제공 Chromium으로 관광 E2E 2개가 통과했다. 완료 후 catalog·record·사용자는 다시 모두 0개였다.
- 테스트 복사본의 마지막 저장 횟수 기대값을 임시로 틀리게 바꿔 1개 실패를 유도했다. 오류 화면 PNG·trace.zip·HTML 보고서 생성과 실패 뒤 장소·계정 정리를 확인했다. 복사본은 삭제하고 일회용 DB도 제거했다. 이 실패 코드는 커밋·푸시하지 않았다.
- 전체 Vitest 34개 파일·224개, 실제 발행 자료 2개를 포함한 전체 Playwright 27개와 build·lint·format:check·spec:check(45 paths·28 tables)가 통과했다. workflow YAML 파싱도 확인했다.
- 원래 로컬 catalog 20,810곳·관광 record 37건·snapshot 3개는 보존됐고 가상 장소·관광 UI 계정은 남지 않았다.

파일 해시와 빈 DB·실패 재현 결과는 [검증 JSON](tourism-e2e-ci-20261001.json)에 있다. 위 수치는 로컬 macOS 실행 결과이다. 실제 Linux CI 성공은 해당 커밋의 GitHub Actions에서 별도로 확인한다. GitHub에서 실패 artifact 업로드까지 실행하려고 고의로 실패하는 커밋을 올리지는 않았다.

빈 스키마 DB를 준비하고 외부 API 키가 없는 환경에서 다음 명령으로 관광 검사만 재현할 수 있다. CI 모드는 3001/5173에 기존 서버를 재사용하지 않는다.

```bash
npm run db:init
npx playwright install --with-deps chromium
CI=true npm run test:e2e:tourism
```
