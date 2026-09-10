# Book해도. 최신 회귀 검증 — 날씨 대안 추천 추가

> 이전 구현·발표 시점의 기록입니다. 현재 동작·저장 계약은 [README](../README.md), [v2 검증 기록](quality-v2.md), [OpenAPI](Bookhaedo-API.yml)를 기준으로 확인해주세요. 기록 당시 화면 캡처는 소스 저장소에 포함하지 않습니다.

2026-09-09: 프로덕션 빌드, 단위·REST/DB **81개**, 전체 Chrome E2E **13개** 통과. 최종 모바일 패널 조정 후 신규 E2E **2개** 재통과. OpenAPI **25개 경로 / 29개 연산**, DBML **16개 테이블** 검증.

실제 삿포로 예보·실내 후보 3곳·Valhalla 전후 경로 비교를 확인했다. 통제된 자동 테스트와 실호출의 범위, 미검증 항목은 [날씨 대안 기능 평가](weather-alternatives-evaluation.md)를 참고한다.

---

## 이전 회귀 검증 기록 — 2026-09-09

- Vue/TypeScript production build 통과.
- Vitest 단위·실제 REST/DB: **61개 통과**.
- Chrome E2E: **7개 통과** (메모/여행 삭제/수단 비교 신규 1개 포함).
- 현재 장소 **20,810개 보존**, Google ID 연결 4개, 리뷰 import/stats 0개: 승인 전 실제 리뷰 수집 없음.
- Valhalla 자동차·도보·자전거 실호출 성공. Google 자동차 실호출 성공.
- Google 대중교통은 시계탑 부근 및 삿포로역→오타루역에서 경로 없는 200 응답: 실제 시간·운임 성공 미확인. 유료도로 통행료 반환 성공도 미확인.
- 실제 리뷰 수집·적재는 미실행. 집계/품질 로직은 합성 입력 단위 테스트이며 실데이터 검증과 구분합니다.
- API 명세 21개 경로, DBML 15개 테이블 파싱 성공.
- 자세한 범위와 재현 명령: [bookhaedo.md](bookhaedo.md)

---

# 최신 개선 검증

2026-09-08 추가 개선: 단위/REST 31개, Chrome 6개 통과. OSRM 경로와 Google Places 한국어·사진·리뷰를 실호출했습니다. 최신 범위는 [개선 결과](improvements.md)를 기준으로 확인하세요.

---

## 이전 리팩토링 검증 결과 — 2026-09-08

Vue 화면과 Express REST API, 실제 PostgreSQL 연결 및 날짜별 일정 저장은
검증을 통과했습니다. API 활성화 후 Google 지도와 실제 경로도 재검증했습니다.
Google Weather는 일본 일별 예보를 지원하지 않아 Open-Meteo로 교체했고,
실제 날씨 응답이 Vue 일정 화면에 표시되는 것까지 확인했습니다.

## 실행 결과

| 검사 | 결과 | 근거 |
| --- | --- | --- |
| Vue + 서버 TypeScript / Vite production build | 통과 | `npm run build` |
| 화이트박스 | 9 / 9 통과 | `tests/domain.test.ts` |
| REST 블랙박스 + 실제 DB | 13 / 13 통과 | `tests/api.test.ts` |
| 데스크톱 사용자 흐름 / 모바일 | 2 / 2 통과 | `tests/e2e/journey.spec.ts` |
| 실제 Google 지도·경로·날씨의 REST → Vue | 1 / 1 통과 | `tests/e2e/google-live.spec.ts` |
| 실제 Google Routes API | HTTP 200 | 거리·시간·폴리라인 수신 |
| 실제 Open-Meteo 날씨 | HTTP 200 | 최고/최저 기온·한국어 설명·출처 표시 |
| Google Weather | 일본 일별 예보 미지원 | HTTP 404: 대체 제공자로 해결 |
| DBML 파싱 | 통과 | `@dbml/core` · 11개 테이블 |

## 화이트박스

- 윤년·잘못된 날짜 구분, 월말/연말 날짜 연산.
- 30일 상한, 같은 날의 중복 장소 거절.
- Haversine 거리: 동일 지점 0, 대칭성, 삿포로–오타루 거리 범위.
- Google 성공 응답의 거리/초/폴리라인 처리. 이 성공 분기는 제공자 응답을
  대체한 단위 테스트이며, 실제 Google 성공을 의미하지 않습니다.
- 403/경로 없음 실패 시 직선거리 표시, 이동시간은 null 유지.
- 예보 범위 밖에서는 외부 API 호출 없이 안내문 반환.
- Open-Meteo 일별 데이터 매핑·날씨 코드·출처, 누락된 기온과 503 오류의 실패 처리.

## REST 블랙박스와 DB

테스트는 실제 로컬 PostgreSQL을 사용합니다. 테스트마다 고유한 QA 계정을
만들고 종료 시 그 계정과 소속 일정만 삭제합니다. 수집 장소 원본은 보존합니다.

- 20,810개 실제 장소 확인, 지역/분류/검색 의도, 페이지네이션.
- API 장소명과 SQL 조회값 비교, 장소 상세 출처 확인.
- SQL 주입 문자열, 음수 페이지 크기, 잘못된 분류 입력 처리.
- 가입, 이메일 중복, 비밀번호 불일치, HttpOnly 세션, 로그아웃/재로그인.
- 3일 여행 생성, 월말 날짜, 날짜별 독립 장소 저장.
- 순서 변경·삭제 후 영속성, 없는 장소 입력 시 이전 일정 유지.
- 다른 계정의 조회·수정·삭제·경로 요청을 404로 거절.
- 새 날짜 추가/중복 날짜 거절, 다른 출처의 변경 요청 차단.

## 브라우저 블랙박스

실제 Chrome에서 Vue와 REST/DB를 연결해 진행했습니다. 외부 지도 스크립트만
실패시킨 회복성 테스트와, 실제 Google 키를 사용하는 검사를 분리했습니다.

1. 소개 화면 → 회원가입 → 지도 탐색.
2. 3일 여행 생성 → 삿포로 검색 → 장소 상세 → 날짜 선택 → 장소 추가.
3. 두 번째 장소 추가 → 구간 거리 표시 → 위/아래 순서 변경.
4. 새로고침 후 복원 → DAY 02의 독립된 빈 일정 → DAY 01 복원.
5. 장소 삭제 → 새 날짜 추가 → 로그아웃 → 로그인 후 이전 일정 복원.
6. 390px 모바일 레이아웃의 가로 넘침 없음, 소개 CTA 접근 확인.
7. 해당 사용자 흐름에서 Vue의 미처리 JavaScript 오류 0건.

검사 중 Google Map 생성자 성공 뒤 비동기 인증 오류가 뒤늦게 오는 점을
발견했습니다. 이를 반영해 지도 컴포넌트는 `tilesloaded`를 기다리며,
실제 Google 테스트는 최종 인증 오류와 대체 화면까지 검사하도록 수정했습니다.

## 실제 외부 연결 재검증 완료

현재 Google 프로젝트: `779226512286`.

- [Maps JavaScript API](https://console.cloud.google.com/apis/library/maps-backend.googleapis.com?project=779226512286)
- [Routes API](https://console.cloud.google.com/apis/library/routes.googleapis.com?project=779226512286)
- [Weather API](https://console.cloud.google.com/apis/library/weather.googleapis.com?project=779226512286)

API 키의 허용 목록과 프로젝트의 API 사용 설정은 별개입니다.
사용자가 세 서비스를 활성화한 뒤 지도와 Routes는 정상화됐습니다.
Google Weather는 활성화 이후에도 일본 좌표에 404를 반환했고,
[공식 지원 범위](https://developers.google.com/maps/documentation/weather/coverage)에서
일본의 일별 예보 미지원을 확인했습니다.
날씨는 [Open-Meteo](https://open-meteo.com/en/docs)로 연결했습니다.
무료 API는 비상업적 개발 범위에서 사용하며 상업 배포 시
[이용 조건](https://open-meteo.com/en/terms)을 다시 확인해야 합니다.

삿포로역 → 오도리공원의 실제 Routes 응답: 1,376m / 366초 / 폴리라인 있음.
브라우저에서는 DB에 있는 오도리공원·삿포로 시계탑으로 하루 일정을 만들고,
REST 응답의 Google 경로·이동시간과 Open-Meteo 예보가 실제 표시되는지 검사했습니다.
전체 브라우저 검사 3/3, 단위/REST 검사 22/22 통과입니다.
다음 명령으로 재검증할 수 있습니다. 키 값은 출력되지 않습니다.

```sh
npx tsx scripts/check-google.ts
npm run test:e2e
```

실제 응답 증거: `google-live-check.json`, `google-browser-check.json`.
지도 이미지를 수집한 시점의 화면은 `screenshots/`에 있습니다.

## 알려진 범위

- CSV/OSM의 운영시간은 미등록/오래된 경우가 있어 상세 화면에서 확인 필요로
  표시합니다. 계절별 운영기간은 아직 원천 데이터가 없으며 임의 생성하지 않습니다.
- 관광권은 기존 근사 분류를 사용합니다. 행정구역 기반으로 확정된 구분은 아닙니다.
- Google Routes의 대중교통 경로는 지역·경로별 제공 여부가 달라 항상 보장하지 않습니다.
  경로가 없으면 직선거리와 확인 불가 안내만 표시합니다.
