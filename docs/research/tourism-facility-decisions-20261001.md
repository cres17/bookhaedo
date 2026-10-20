# 시설 별칭 대조 결정 (2026-10-01)

기존 PENDING 보고서는 이력으로 유지한다. 새 결정은 CSV 행(출처·외부 ID·제목·원본 SHA)과 catalog ID·이름·공식 웹사이트·같은 지역·250m 이내 조건을 고정한다. 이 지문이 바뀌면 별칭 적용을 중단하고 다시 검토한다. exact-name 중복 후보를 별칭으로 우회하지 않는다.

공식 웹사이트는 시설 동일성 검토에만 읽었다. 비허가 사이트 설명을 재수집·발췌해 서비스 자료로 적재하지 않았다.

| 외부 ID | 시설 | 결정 | 근거 / 한계 |
|---|---|---|---|
| TR0000000003 | 富良野ロープウェー | KEEP_SEPARATE | 로프웨이 자료에 호텔·베이커리 후보가 잡힌다. 같은 단지 안 별도 시설일 수 있어 동일 장소로 연결할 근거가 없다. [공식 확인](https://www.princehotels.co.jp/shinfurano/files/2025_10_hotelmap.pdf) |
| TR0000000004 | ふらのワインハウス | APPROVED_ALIAS | Official name matches CSV; official address and website match catalog; distance 15.6m. Hiragana/kanji spelling alias only. [공식 확인](https://www.furano.ne.jp/winehouse/) |
| TR0000000009 | 芦別岳登山口 | KEEP_SEPARATE | 등산로 입구와 캠핑장 후보의 시설 범위가 다를 수 있다. 접근점 관계를 추가 확인해야 한다. [공식 확인](https://www.furanotourism.com/jp/spot/spot_D.php?id=432) |
| TR0000000010 | 原始ヶ原・富良野岳登山口 | KEEP_SEPARATE | 등산로 입구와 관리동 후보의 관계가 확인되지 않았다. 가까움만으로 같은 장소로 연결하지 않는다. [공식 확인](https://www.furanotourism.com/jp/spot/spot_D.php?id=434) |
| TR0000000014 | ふらのワインハウスラベンダー園 | PENDING | 라벤더원과 와인공장 사이 시설 범위·원문 좌표를 확정할 근거가 부족해 연결하지 않는다.  |
| TR0000000015 | へそ神社 | KEEP_SEPARATE | 신사 자료 주변에 음식점·숙박·상점 후보가 있다. 동일 시설을 뒷받침하는 명칭이나 독립 근거가 없다. [공식 확인](https://www.city.furano.hokkaido.jp/life/docs/2015022100407.html) |
| TR0000000016 | 北海道中心標 | KEEP_SEPARATE | 중심표와 주변 신사·상점은 다른 방문 지점일 수 있다. 별칭으로 처리할 근거가 없다. [공식 확인](https://www.visit-hokkaido.jp/spot/detail_10287.html) |
| TR0000000019 | グラス・フォレスト in 富良野（ふらの硝子） | KEEP_SEPARATE | 유리공방 자료의 가까운 후보는 とみ川 음식점이다. 동일 시설로 승인할 근거가 없다. [공식 확인](https://furano-glass.jimdofree.com/) |
| TR0000000021 | 富良野スキー場 | KEEP_SEPARATE | 스키장 자료 주변에 호텔·베이커리·닝구르테라스가 있다. 같은 리조트 안 별도 시설일 가능성이 있어 자동 연결을 보류한다. [공식 확인](https://www.princehotels.co.jp/ski/furano/) |
| TR0000000024 | フラノマルシェ２ | KEEP_SEPARATE | 공식 FAQ는 마르셰 1과 2가 도로를 사이에 두고 마주 선다고 설명한다. HARP도 TR0000000023/24를 따로 기록한다. 기존 フラノマルシェ를 2의 별칭으로 합치지 않는 보수적 판단을 기록한다. [공식 확인](https://marche.furano.jp/?page_id=1340) |

APPROVED_ALIAS 1건, KEEP_SEPARATE 8건, PENDING 1건이다. KEEP_SEPARATE는 근접 catalog 후보에 연결하지 않는다는 결정이며, 모든 후보 간의 독립 법적 시설 경계를 확정했다는 뜻은 아니다. 250m 안에 catalog가 아예 없는 6건은 별도 catalog 보완 대상이다. 기존 catalog는 수정하지 않는다.

와인하우스의 catalog 주소는 `〒076-0048 北海道富良野市清水山`, 웹사이트는 공식 사이트와 같다. 공식 시설명은 CSV와 같은 히라가나 표기이고 catalog는 한자 표기다. 15.6m 차이는 단독 근거가 아니며 명칭·주소·웹사이트 확인을 함께 사용했다.

활성 snapshot 레코드를 직접 고치지 않고 원문을 다시 수집·정규화한 새 snapshot에 별칭을 적용한다. 이전 snapshot은 그대로 보존한다. alias 단위 테스트는 출처/ID/SHA/제목/지역/거리/catalog 이름/웹사이트 변경, exact 중복, 비승인·중복 registry를 검사한다.

실제 재수집(CSV 304·내용 유지) 후 발행한 snapshot은 `f659c81a-beca-4415-96af-327e95d6e821`이다. 연결은 8/24(33.3%) → 9/24(37.5%). 전체 catalog 20,810개는 유지했으며 snapshot은 3 → 4개, 누적 record는 37 → 61개다. 활성 record 수는 37개로 유지됐다. 이전 snapshot을 삭제하지 않았다. 발행·감사 결과는 `tourism-after-alias-audit-20261001.json`에 보존했다.
