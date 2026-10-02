# 별칭 2건 적용·삿포로 103행 수집과 장소 연결 — 2026-10-02

북토 별칭 2건을 적용해 시설 연결은 **2/10 → 4/10**으로 늘었다. 이전 검토의 미연결 23건 중 **21건이 남는다**. 삿포로 103행을 실제 수집·정제·발행했고 **15건(14.6%)**이 연결됐다. 삿포로의 새 미연결 88건은 명칭 불일치 87건·지역 불일치 1건(`Half Note`)이다. 두 분모를 섞어 기존 23건이 109건으로 악화됐다고 해석하지 않는다. catalog 20,810곳은 보존했다.

[실행·해시·요청 간격·검증 기록](tourism-alias-sapporo-20261002.json), [최종 읽기 전용 감사](tourism-after-alias-sapporo-audit-20261002.json), [실행한 재현 노트북](tourism-alias-sapporo-20261002.ipynb)을 보존한다. 원문 CSV 전체·연락처·실행 로그·브라우저 trace는 Git 밖에 둔다.

## 별칭 검증과 적용

북토 외부 ID 6(전망대)·7(캠핑장)은 공식 명칭 `きじひき`와 catalog `きじびき`의 검토된 표기 차이다. [시청 전망대 안내](https://www.city.hokuto.hokkaido.jp/docs/1959.html)와 [캠핑장 안내](https://www.city.hokuto.hokkaido.jp/institution/shisetsu/kijihiki-campjo/)를 다시 확인했다. 임의 공식 URL을 catalog에 넣지 않았다. 승인 파일은 URL의 명시적 null과 이름·분류·주소(null 포함)·좌표를 모두 요구하며, 이후 값이 조금이라도 달라지면 별칭 연결을 거절한다. 원문 출처·외부 ID·제목·CSV SHA·같은 지역·250m 조건도 유지한다. 기존 와인하우스 별칭도 같은 강화 지문으로 옮겼다.

새 회귀 테스트는 변경 전 6개 실패·14개 통과였다. null과 누락·새 URL을 구분하고 분류·주소·좌표 변경, 전망대와 캠핑장 ID 혼동, 승인 스키마의 필수값을 검사한다.

북토의 실제 CSV 새 수집은 두 회차 모두 시간 초과됐다. 두 번째 회차의 재시도는 조건부 헤더를 제거했으며 60초 간격은 유지했다. 최신 수집에 성공했다고 보고하지 않는다. 이미 발행된 동일 원문·수집 시각을 재처리해 새 snapshot을 만들었다. 원래 fetchedAt `2026-10-01T10:57:19.165Z`, 정제 내용 SHA와 이전 snapshot은 보존했다. 새 snapshot은 `4bd7b7d8-9f38-4743-a6b2-5bc0e17f0a9b`다.

재처리 명령은 명시적으로 지정한 활성 snapshot ID, 동일 record 내용 SHA, 동일 fetchedAt이 모두 맞아야 작동한다. 출처 철회·비활성, record 철회, 달라진 활성 버전·원문·수집 시각은 거절한다. 기본 발행의 중복 건너뛰기는 그대로다. 테스트에서 이전 snapshot의 미연결 상태와 fetchedAt을 보존하고 새 snapshot에서만 재연결되는 동작을 확인했다.

```bash
npm run tourism:publish -- <existing-curated-json> --reprocess-snapshot <expected-active-snapshot-uuid>
```

이 명령은 새로운 수집이 아니다. 기존 curated 파일이 현재 활성 버전과 정확히 일치해야 하고, 90일 발행 기간 및 권리 검사를 그대로 적용한다. 수집 실패 직후 normalize가 오래된 성공을 최신 결과로 고르는 동작을 추가하지 않았다.

## 삿포로 수집·정제·발행

[札幌市 도심 관광 자료](https://ckan.pf-sapporo.jp/dataset/sapporo_kankou_spot)의 CC BY 4.0과 [플랫폼 이용규약](https://data.pf-sapporo.jp/tos)을 확인했다. 공개 CSV의 정확한 URL을 등록부에 고정하고 `sapporo-csv-v1`만 허용한다. 다른 CKAN host/resource, query·fragment, 다른 지역·parser는 DB 쓰기 전에 거절한다. HARP의 기존 도메인·버전 검사도 유지한다.

robots를 확인한 뒤 10초 이상 간격으로 페이지·고정 CSV를 요청했다. `/api/`를 사용하지 않았고 JPEG·TTL은 다운로드하지 않았다. 실제 UTF-8 BOM CSV 103행은 모두 고유 NO·유효 좌표이며 원문 SHA는 `a8ef3ebea11c75f3bab39b9c48c12c29a1a520d28c58a22e6ee6a23177352bce`다. 정제는 NO의 앞자리 0, 제목, 제공 좌표, 원문·라이선스 근거를 보존한다. 설명·전화·이미지·요금·운영 표현은 복사하지 않고 hours/date 상태는 unknown으로 둔다. 출처 수정 시각이 없어 null이며 다운로드 시각을 자료 수정일로 만들지 않는다.

```bash
python3 scripts/tourism/collector.py --source sapporo-places --state-dir <shared-state-dir>
python3 scripts/tourism/normalize.py --source sapporo-places --state-dir <shared-state-dir> --output <sapporo-curated-json>
npm run tourism:publish -- <sapporo-curated-json>
npm run tourism:audit -- --date 2026-10-02 --output <audit-json>
```

103행은 관광 지식 DB에 저장되고, 15행만 기존 catalog와 연결된다. 88행 때문에 catalog 장소를 새로 만들거나 지역·명칭·좌표를 추측해 변경하지 않았다. 삿포로 도심 7개 권역 자료이며 시 전체 확보가 아니다. 활성 자료 지역은 후라노·하코다테·신치토세·삿포로 4개이고 나머지 8개 지역의 후보 출처는 아직 적재 전이다.

## 실제 검증과 범위

최종 Vitest 38개 파일·262개, Python 28개, 기본 E2E 25개(선택 실행 6개 제외), 실제 발행 자료 E2E 4개(후라노 2·삿포로 2), build·lint·format:check·spec:check(45 paths/28 tables)가 통과했다. 삿포로는 실제 추천 응답과 데스크톱·모바일 화면의 기관명·CSV·CC BY 4.0, 빈 설명·unknown 영업정보, 조회 후 일정 보존을 확인했다. 서버의 일반 매칭·발행 테스트는 가상 시설로 CI에서 실행할 수 있고, 실제 발행 자료 E2E는 기존 자료를 요구하므로 CI에 편입하지 않았다.

전체 테스트에서 자료 없음 시나리오 3개가 실제 삿포로 활성 자료 때문에 실패하는 것을 확인했다. 테스트의 자료 없음 조건만 명시적으로 격리하고 인증·DB 후보·확정 경로는 실제로 유지했다. 브라우저 반복 실행의 가입 429도 trace의 50회/900초·Retry-After로 확인했으며 서비스 한도·카운터를 바꾸지 않고 만료 후 재실행했다.

이번 발행은 로컬 DB다. 원격 ver2 코드 푸시와 운영 배포는 구분한다. 명칭 불일치 87건·지역 불일치 1건을 다음 수동 검토 대상으로 남기며, 전체 연결률을 높이기 위해 자동 매칭 조건을 완화하지 않았다.
