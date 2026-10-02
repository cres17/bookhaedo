# 미연결 시설 23건 검토 — 2026-10-02

활성 시설 34건 중 11건 연결·23건 미연결을 읽기 전용으로 검토했다. catalog는 20,810곳이다. 결과는 **별칭 적용 후보 2건, 연결하지 않음 14건, 250m 안 후보 없음 6건, 위치 재확인 1건**이다. 이번 검토에서는 DB·승인 별칭 파일을 변경하지 않아 실제 미연결은 여전히 23건이다.

판단 단위는 출처별 외부 ID다. [기준 감사 JSON](tourism-review-baseline-20261002.json)에는 관측 시각·snapshot·원문 SHA-256·근접 후보·읽기 전용 SQL을 보존했다. [행별 검토 JSON](tourism-facility-review-20261002.json)은 모든 23건을 일대일로 포함한다.

## 시설별 판단

| 출처 / 외부 ID | 원문 시설 | 판단 | 대조 근거와 후속 조치 |
| --- | --- | --- | --- |
| furano-places / TR0000000003 | 富良野ロープウェー | 연결하지 않음 | 로프웨이와 호텔·베이커리는 시설 기능이 다르다. 공식 단지 안내에 별도 시설로 나오며 호텔 전체를 로프웨이로 연결할 근거가 없다. [공식 근거 1](https://www.princehotels.co.jp/shinfurano/files/2025_10_hotelmap.pdf) |
| furano-places / TR0000000005 | アンパンマンショップ | 250m 안 후보 없음 | 공식 운영자 사이트는 앙팡맨 숍을 잼원 안의 개별 숍으로 안내한다. 현재 동일 지역 250m 후보가 없다. 잼원 전체와 숍을 합치지 않는다. [공식 근거 1](https://www.furanojam.com/anpanman/) |
| furano-places / TR0000000006 | ふらのジャム園 | 250m 안 후보 없음 | 운영자 사이트의 잼원 직영점 안내와 원문 시설을 대조했다. 현재 동일 지역 250m 후보가 없다. [공식 근거 1](https://www.furanojam.com/jam/) |
| furano-places / TR0000000007 | 麓郷展望台 | 250m 안 후보 없음 | 운영자 사이트에 별도 전망대 안내가 있다. 현재 동일 지역 250m 후보가 없다. 인근 잼원 전체를 전망대로 치환하지 않는다. [공식 근거 1](https://www.furanojam.com/scenery/) |
| furano-places / TR0000000009 | 芦別岳登山口 | 연결하지 않음 | 관광협회 안내는 등산로 입구이다. catalog 후보는 캠핑장이며 접근 관계만으로 같은 시설이라는 근거가 되지 않는다. [공식 근거 1](https://www.furanotourism.com/jp/spot/spot_D.php?id=432) |
| furano-places / TR0000000010 | 原始ヶ原・富良野岳登山口 | 연결하지 않음 | 관광협회 안내는 등산로 입구이다. 가까운 관리동이 같은 catalog 객체라는 증거는 확인되지 않아 연결하지 않는다. [공식 근거 1](https://www.furanotourism.com/jp/spot/spot_D.php?id=434) |
| furano-places / TR0000000011 | 東大演習林樹木園 | 250m 안 후보 없음 | 도쿄대 홋카이도 연습림의 일반 공개 수목원 안내와 야마베 주소를 확인했다. 현재 동일 지역 250m 후보가 없다. [공식 근거 1](https://www.uf.a.u-tokyo.ac.jp/hokuen/ippan/01_jyumokuen.html) [공식 근거 2](https://www.uf.a.u-tokyo.ac.jp/hokuen/access/access.html) |
| furano-places / TR0000000014 | ふらのワインハウスラベンダー園 | 연결하지 않음 | 관광협회가 라벤더원을 와인공장·와인하우스에 인접한 명소로 안내한다. 인접한 공장에 연결하지 않는다. 이전 PENDING을 연결하지 않음으로 정리했다. [공식 근거 1](https://www.furanotourism.com/jp/spot/spot_D.php?id=399) |
| furano-places / TR0000000015 | へそ神社 | 연결하지 않음 | 시청의 배꼽 신사 안내와 원문을 대조했다. 근접 음식점·숙박시설은 신사와 동일 시설이라는 근거가 없다. [공식 근거 1](https://www.city.furano.hokkaido.jp/life/docs/2015022100407.html) |
| furano-places / TR0000000016 | 北海道中心標 | 연결하지 않음 | 공식 관광 안내는 중심 표식이다. catalog 신사·학교 주변 후보를 표식과 합칠 근거가 없다. [공식 근거 1](https://www.visit-hokkaido.jp/spot/detail_10287.html) |
| furano-places / TR0000000017 | 山部自然公園太陽の里 | 250m 안 후보 없음 | 시청은 태양의 리를 캠핑장·자연 산책로·인접 등산로 입구를 포함한 영역으로 소개한다. 현재 250m 안 적격 후보가 없으며 전체 catalog에는 관련 캠핑장이 있어 시설 범위 확인이 필요하다. 공원 전체와 캠핑장 한 곳을 합치지 않는다. [공식 근거 1](https://www.city.furano.hokkaido.jp/life/docs/93702.html) |
| furano-places / TR0000000019 | グラス・フォレスト in 富良野（ふらの硝子） | 연결하지 않음 | 유리 공방의 공식 사이트와 원문을 대조했다. catalog의 인근 음식점은 공방과 동일 시설이 아니다. [공식 근거 1](https://furano-glass.jimdofree.com/) |
| furano-places / TR0000000020 | 富良野演劇工場 | 250m 안 후보 없음 | 관광협회의 연극 공장 안내와 시청 시설 분류를 확인했다. 현재 동일 지역 250m 후보가 없다. 운영자 웹사이트의 본문은 이번 웹 도구에서 열리지 않아 현재 운영은 검증하지 않았다. [공식 근거 1](https://www.furanotourism.com/jp/spot/spot_D.php?id=141) [공식 근거 2](https://www.city.furano.hokkaido.jp/life/kyoikubunka/engekikoujou/) |
| furano-places / TR0000000021 | 富良野スキー場 | 연결하지 않음 | 운영자의 스키장 안내를 확인했다. 호텔·베이커리·쇼핑 테라스는 스키장과 기능·시설 범위가 다르므로 합치지 않는다. [공식 근거 1](https://www.princehotels.co.jp/ski/furano/) |
| furano-places / TR0000000024 | フラノマルシェ２ | 연결하지 않음 | 운영자의 마르셰 1·2 안내는 도로를 사이에 둔 두 구역을 구분한다. 마르셰 1이나 인근 음식점으로 마르셰 2를 치환하지 않는다. [공식 근거 1](https://marche.furano.jp/?page_id=1340) |
| hokuto-places / 1 | ほっとマルシェ　おがーる | 연결하지 않음 | 관광협회 상업시설 안내에서 오가루는 호쿠루 내 테넌트이다. 가까운 호텔 전체와 숍을 같은 시설로 연결하지 않는다. [공식 근거 1](https://hokkuru.hokutoinfo.com/) |
| hokuto-places / 10 | せせらぎ温泉 | 연결하지 않음 | 시청의 건강센터 온천 이름·주소(本町4丁目3番20号)가 원문과 일치한다. catalog는 녹지공원이며 온천 시설과 기능이 다르다. [공식 근거 1](https://www.city.hokuto.hokkaido.jp/docs/1579.html) |
| hokuto-places / 2 | ショッピング＆フードエリア　ほっくる | 연결하지 않음 | 관광협회는 호쿠루를 관광 교류센터 별관의 쇼핑·음식 상업시설로 안내한다. 호텔 전체를 상업시설과 합치지 않는다. [공식 근거 1](https://hokkuru.hokutoinfo.com/) |
| hokuto-places / 5 | 匠の森公園 | 위치 재확인 | 같은 이름의 공원이 있지만 원문과 catalog 좌표가 지리거리 410.4m 떨어져 250m 조건을 초과한다. 공원 영역의 중심과 입구 차이인지 아직 확인되지 않았다. 원문·catalog 좌표를 수정하거나 반경을 늘리지 않는다. [공식 근거 1](https://www.city.hokuto.hokkaido.jp/docs/takuminomori.html) |
| hokuto-places / 6 | きじひき高原パノラマ展望台 | 별칭 적용 후보 | 시청이 전망대를 きじひき 고원 시설로 안내한다. catalog의 きじびき 표기와 같은 시설 유형이며 44.5m 후보다. catalog 웹사이트가 null이어서 기존 승인 별칭 스키마가 거절한다. 웹사이트 null의 엄격한 처리와 좌표·시설 유형 지문을 추가한 뒤 별칭을 적용할 대상이다. [공식 근거 1](https://www.city.hokuto.hokkaido.jp/docs/1959.html) |
| hokuto-places / 7 | きじひき高原キャンプ場 | 별칭 적용 후보 | 시청 시설명·주소(村山174番地)가 원문과 일치하며 catalog는 きじびき 표기의 캠핑장이고 103.1m 후보다. catalog 웹사이트가 null이어서 기존 승인 별칭 스키마가 거절한다. 검증 지문 확장과 새 실제 수집 snapshot 발행이 필요하다. [공식 근거 1](https://www.city.hokuto.hokkaido.jp/institution/shisetsu/kijihiki-campjo/) [공식 근거 2](https://www.city.hokuto.hokkaido.jp/docs/2425.html) |
| hokuto-places / 8 | 上磯ダム公園キャンプ場 | 연결하지 않음 | 시청 안내는 댐 인접 캠핑장이다. catalog는 공원 전체이므로 현재 별칭으로 캠핑장과 공원을 동일시하지 않는다. [공식 근거 1](https://www.city.hokuto.hokkaido.jp/docs/2425.html) |
| hokuto-places / 9 | 湯の沢水辺公園キャンプ場 | 연결하지 않음 | 시청 안내는 캠핑장이다. catalog는 수변공원 전체여서 일대에 위치했다는 사실만으로 시설 범위를 합치지 않는다. [공식 근거 1](https://www.city.hokuto.hokkaido.jp/docs/2425.html) |

## 적용 전 필요한 작업

북토 외부 ID 6·7의 catalog 웹사이트는 null이다. 현재 `parseTourismAliases`는 URL을 필수로 요구하므로 임의 URL을 채워 넣지 않았다. null을 정확히 비교하는 정책과 catalog 좌표·시설 유형 지문을 구현·회귀 검증한 뒤 두 별칭을 등록하고, 실제 북토 CSV를 새로 수집해 새 snapshot으로 발행해야 한다. 유지 중인 snapshot의 연결을 직접 덮어쓰지 않는다.

`匠の森公園`의 410.4m 차이는 반경 확대나 좌표 추측으로 우회하지 않는다. 공원 입구·전체 영역·대표점 차이를 실제 지도로 확인할 대상이다. 여섯 후보 없음 항목은 catalog 보완 대상 검토이며, 특히 태양의 리는 관련 캠핑장이 전체 catalog에 존재하므로 공원과 캠핑장의 범위를 확인한다.

라벤더원은 관광협회가 와인공장·와인하우스에 인접한 별도 명소로 소개한다. 이전 미결정은 연결하지 않는 것으로 정리했다. 다른 KEEP_SEPARATE 항목은 현재 후보와 합치지 않는 결정이며 주변 시설의 모든 경계를 확정한 것은 아니다.

## 검증 범위

원문 CSV의 이름·주소·좌표, 활성 DB 후보·거리, 공식 시설·운영자 안내를 대조했다. 현재 영업·요금·여행일 행사 개최는 검증 범위 밖이다. 일반 관광 페이지의 본문·사진 재사용 권한은 이 동일성 검토에서 부여되지 않는다. 검토에 사용한 주소·이름·좌표만 분석 근거로 남기고 전화·메일·원문 전체 파일은 공개하지 않는다.
