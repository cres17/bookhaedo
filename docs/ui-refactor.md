# KITA UI / UX

> 이전 구현·발표 시점의 기록입니다. 현재 동작·저장 계약은 [README](../README.md), [v2 검증 기록](quality-v2.md), [OpenAPI](Bookhaedo-API.yml)를 기준으로 확인해주세요. 기록 당시 화면 캡처는 소스 저장소에 포함하지 않습니다.

현재 구현: Vue 3 + Vue Router + Vite → Express REST → PostgreSQL/PostGIS.

## 화면

| 경로 | 목적 |
| --- | --- |
| `/` | 눈 결정 인터랙션, 홋카이도 지도, 12개 관광권 소개, 실제 요테이산 사진 |
| `/login`, `/signup` | 이메일 계정 + HttpOnly 세션 |
| `/explore` | 지역/장소 검색, 지도 확대, 분류 필터, 더 보기 |
| `/places/:id` | 장소 위치·운영시간·출처·공식 링크·여행에 담기 |
| `/trips` | 여행 서랍, 출발일·기간·교통수단으로 여행 생성 |
| `/trips/:id` | 날짜 탭, 순서 변경, 장소 삭제, 거리/시간, 날씨, 새 날짜 추가 |

## 표현

- 남색 `#2e314e`, 눈빛 화이트 `#f9fafc`, 포인트 레드 `#d8404c`.
- 일곱 방향 눈 결정에서 영감을 받은 SVG 심볼. 공식 로고로 오인되지 않도록
  자체 워드마크 KITA를 사용합니다.
- 넓은 여백, 유리처럼 반투명한 카드, 부드러운 화면 전환, 느린 눈 결정 움직임.
- 접근성: 의미 있는 버튼/입력 레이블, 키보드 포커스, 모달 포커스 잠금 및 Escape,
  `prefers-reduced-motion`, 모바일 하단 탐색 메뉴, 로딩/빈 결과/오류/재시도 상태.

## 이미지·지도 출처

- 실제 요테이산 사진: Oga, CC BY-SA 3.0.
  https://commons.wikimedia.org/wiki/File:Yotei-zan-from-hirafu.jpg
  원본 파일을 보존하고 크롭·그라데이션은 CSS로 적용합니다. 웹 화면에 출처 링크 포함.
- 홋카이도 개요: Natural Earth 1:10m 육지 윤곽 / Public domain. 도시 점은 OSM 도시 노드 좌표 / ODbL.
  동일한 위경도 투영을 적용하며 항법용 정밀 해안선은 아닙니다.
- 장소 목록: `geo_data.place`, 출처: `geo_data.place_source`.

## 데이터 흐름

일정의 추가·삭제·순서 변경은 해당 날짜의 장소 ID 배열을 REST API로 보내며,
서버가 소유자/존재 여부/중복을 검사한 후 트랜잭션으로 저장합니다.
저장 직후와 순서 변경 시 인접 장소마다 OSRM(렌터카·택시) 또는 Google Routes(대중교통)를 요청합니다.
실패 시 직선거리임을 명확히 표시하고 이동시간을 추정하지 않습니다.
