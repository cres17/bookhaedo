# 요구사항 구현 평가

> 이전 구현·발표 시점의 기록입니다. 현재 동작·저장 계약은 [README](../README.md), [v2 검증 기록](quality-v2.md), [OpenAPI](Bookhaedo-API.yml)를 기준으로 확인해주세요. 기록 당시 화면 캡처는 소스 저장소에 포함하지 않습니다.

평가일: 2026-09-10

| ID | 구현 상태 | 구현 근거 | 검증 근거 |
| --- | --- | --- | --- |
| FR_AUT_01 | 충족 | 회원가입·로그인·로그아웃, HttpOnly 세션 | `tests/api.test.ts`, 인증 E2E |
| FR_SCH_01 | 충족 | 지역·키워드·테마 통합 검색, 목록·지도 갱신 | `tests/place-search.test.ts`, `explore-journey.spec.ts` |
| FR_PLC_01 | 충족 | 장소 상세, 일본어 원문, 출처, Google 보강정보 | `tests/api.test.ts`, `places-live.spec.ts`, `place-links.spec.ts` |
| FR_TRP_01 | 충족 | 여행 생성·조회·수정·삭제, 날짜·순서·메모 | `tests/api.test.ts`, `bookhaedo.spec.ts` |
| FR_RTE_01 | 충족 | 날짜별 날씨, 인접 경로·거리·시간, 이동수단 비교 | `tests/api.test.ts`, `google-live.spec.ts` |
| FR_ADM_01 | 충족 | 회원 검색, 권한·상태 변경, 변경 이력 | `tests/admin.test.ts`, `admin.spec.ts` |
| FR_ALT_01 | 충족·확장 | 장소 단위 실내 교체와 하루 전체 날씨 맞춤·실내·근거리 코스 추천 | `tests/weather-alternatives.test.ts`, `tests/day-alternatives.test.ts`, 관련 E2E |
| NFR_SEC_01 | 충족 | 세션 인증, 관리자 권한, 여행 소유권 검증 | API 보안 테스트 |
| NFR_INT_01 | 충족 | 날짜 행 잠금, 트랜잭션, 중복 방지, 오래된 일정 충돌 감지 | 일정·대안 API 테스트 |
| NFR_USA_01 | 충족 | 목록·마커·미리보기 지도 동기화, 실제 경로 실패와 미제공 정보 구분 | 지도·대안 E2E |
| NFR_CTL_01 | 충족 | 대안 조회·미리보기는 비저장, 사용자가 확정할 때만 PATCH, 취소 시 원본 유지 | 날씨·하루 코스 E2E |

## 하루 전체 코스 추천

`GET /api/trips/{id}/days/{date}/day-alternatives`는 현재 하루 일정의 중심과 날짜별 예보를 기준으로 다음 코스를 만든다.

- `AUTO`: 악천후이면 실내 근거가 있는 장소를 우선하고, 맑으면 야외·실내·식사 장소를 섞는다.
- `INDOOR`: OSM `indoor=yes` 또는 박물관·미술관·수족관 분류를 우선한다.
- `NEARBY`: 기존 일정 중심에서 가까운 장소를 우선한다.

전략을 선택하면 같은 GET API가 실제 인접 경로를 계산해 미리보기를 반환한다. 이 단계에서는 DB를 변경하지 않는다. 사용자가 `이 코스로 하루 교체`를 선택하면 `PATCH` API가 기존 일정 순서를 다시 확인하고 트랜잭션으로 하루 전체 장소를 교체한다. 일정이 다른 탭에서 바뀌었으면 `409`를 반환하고 기존 일정을 유지한다.

## 한계

- 날씨는 Open-Meteo의 일별 예보를 사용하며 오늘부터 10일 이내만 제공한다.
- 추천은 직선 20km 이내의 저장 장소와 OSM 태그를 사용한다. 영업 여부, 예약 가능 여부, 최적 동선을 보장하지 않는다.
- 실제 경로 조회 실패 시 직선거리만 표시하고 이동시간을 생성하지 않는다.
- 빈 날짜는 추천 지역을 정할 기준이 없으므로 첫 장소를 하나 담은 뒤 사용할 수 있다.
