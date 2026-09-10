# 계절·운영기간·일정 검증 규칙

> 초기 설계 제안이며 현재 구현 명세가 아닙니다. 아래 운영기간 관리·availability·validate API는 구현 완료 기능으로 주장하지 않습니다. 실제 제공 API는 [OpenAPI](Bookhaedo-API.yml), 향후 운영 범위는 [운영 안내](operations.md)를 확인해주세요.

## 1. 왜 데이터를 분리하는가

관광지의 **추천 계절**과 **실제 방문 가능 여부**는 서로 다른 정보다.

- `PlaceSeasonProfile`: 그 계절에 얼마나 추천할 만한지 표현한다.
- `PlaceOperatingPeriod`: 특정 날짜에 실제로 운영하는지 표현한다.
- `OpeningHour`: 해당 요일의 영업시간을 표현한다.
- `PlaceNotice`: 임시 휴업, 통행 제한, 정비, 기상 주의처럼 갑자기 생긴 예외를 표현한다.

예를 들어 비에이의 한 전망대가 겨울 풍경 때문에 `BEST`여도, 제설 작업으로 임시 접근 제한 공지가 있다면 최종 방문 상태는 `CLOSED` 또는 `LIMITED`가 된다.

## 2. 계절 정의

초기 버전에서는 홋카이도 현지 날짜를 기준으로 아래처럼 구분한다.

| 계절 | 월 |
|---|---|
| SPRING | 3~5월 |
| SUMMER | 6~8월 |
| AUTUMN | 9~11월 |
| WINTER | 12~2월 |

관리자가 장소별 계절 적합도를 `BEST / GOOD / POSSIBLE / LIMITED / CLOSED`로 저장한다. 이는 추천과 안내용이며, 운영 여부 판정의 직접 근거로 사용하지 않는다.

## 3. 운영기간 표현

### ANNUAL

매년 반복되는 기간이다. 월·일만 저장한다.

- 예: 매년 4월 29일~11월 3일 운영
- `startMonth=4, startDay=29, endMonth=11, endDay=3`
- 연도를 넘는 기간도 허용한다.
- 예: 매년 12월 1일~다음 해 3월 31일

### FIXED_DATE

특정 연도에만 유효한 확정 기간이다.

- 예: 2027년 1월 10일~2월 25일 정비 휴업
- `startDate`, `endDate`를 사용한다.

`FIXED_DATE`와 `ANNUAL`이 동시에 해당되면 더 구체적인 `FIXED_DATE`를 우선한다.

## 4. 방문 가능 여부 판정 순서

`GET /places/{placeId}/availability?visitAt=...`는 다음 순서로 판정한다.

1. 장소의 기본 상태가 `PERMANENTLY_CLOSED`인지 확인한다.
2. 방문 시각에 유효한 `CRITICAL` 공지 또는 임시 휴업·접근 제한을 확인한다.
3. 해당 날짜에 적용되는 `FIXED_DATE` 운영기간을 확인한다.
4. 없으면 `ANNUAL` 운영기간을 확인한다.
5. 해당 요일의 `OpeningHour`를 확인한다.
6. 기간 한정 시간이 있으면 일반 영업시간보다 우선 적용한다.
7. 추천 계절과 기상 의존 여부를 참고해 안내 메시지를 추가한다.

최종 상태:

- `OPEN`: 계획한 시각에 방문 가능
- `LIMITED`: 운영하지만 시간·구간·장비 등의 제약 존재
- `CLOSED`: 휴업, 기간 외, 영업시간 외 또는 접근 불가
- `UNKNOWN`: 신뢰할 만한 최신 운영 정보를 확보하지 못함

## 5. 일정 검증

`POST /trips/{tripId}/validate`는 저장된 일정을 읽어 다음 문제를 반환한다.

| 문제 유형 | 기본 심각도 | 예시 |
|---|---|---|
| OUTSIDE_OPERATING_PERIOD | ERROR | 여름 한정 시설을 겨울 일정에 추가 |
| OUTSIDE_OPENING_HOURS | ERROR | 17시 폐장 장소를 18시에 방문 |
| CLOSED_ON_WEEKDAY | ERROR | 화요일 정기휴무 |
| TEMPORARY_CLOSURE | ERROR | 보수 공사로 임시 휴업 |
| OUT_OF_SEASON | WARNING | 방문은 가능하지만 추천 계절이 아님 |
| INSUFFICIENT_TRAVEL_TIME | WARNING | 이동 예상 90분인데 30분만 확보 |
| EVENT_NOT_ACTIVE | ERROR | 행사 종료일 이후 방문 |
| WEATHER_CAUTION | WARNING | 강풍 시 운휴 가능성이 높은 시설 |

`ERROR`가 하나라도 있으면 검증 결과의 `isValid`는 `false`다. `WARNING`만 있으면 일정 저장은 가능하며 사용자에게 재확인을 요구한다.

## 6. 데이터 신뢰도 규칙

- 운영기간과 공지는 가능한 한 공식 관광지 또는 지자체 URL을 저장한다.
- `lastVerifiedAt`이 90일 이상 지난 운영 정보는 화면에 “확인 필요”로 표시한다.
- 행사 일정은 `Event`와 실제 회차인 `EventOccurrence`를 분리한다.
- 출처 원문은 `PlaceSource.rawData`에 보존하고, 서비스용 표준 필드로 정규화한다.
- 날짜와 시간은 DB에 ISO 8601로 저장하고, 판정 시 `Asia/Tokyo` 시간대로 변환한다.

## 7. 초기 구현 범위

1차 버전은 실시간 날씨에 따라 일정을 자동 변경하지 않는다. 대신 운영기간·요일·영업시간·활성 공지를 기준으로 충돌을 찾아 사용자에게 대체 시간이나 장소를 제안한다. 이후 날씨 API를 붙이면 `WEATHER_CAUTION` 규칙을 확장할 수 있다.
