import { regions } from './domain.js';
export const searchKinds = [
  {
    id: 'vintage-clothes',
    label: '빈티지 의류',
    group: 'shopping',
    words: ['빈티지 옷가게', '빈티지 의류', '구제 옷가게', '구제샵', '구제 숍'],
    sql: "(osm_tags->>'shop' IN ('clothes','fashion','boutique','second_hand') AND (osm_tags->>'second_hand' IN ('yes','only') OR osm_tags->>'shop'='second_hand' OR name_ja ~* '(古着|ヴィンテージ|ビンテージ)'))",
  },
  {
    id: 'workshop',
    label: '공방·체험',
    group: 'culture',
    words: [
      '원데이 클래스',
      '체험 공방',
      '공예 체험',
      '도예 체험',
      '공방',
      '공예',
      '도예',
      '유리공예',
      '목공',
      '워크숍',
      '워크샵',
    ],
    sql: "(category='ATTRACTION' AND (osm_tags->>'craft' IN ('pottery','ceramics','glassblower','artist','carpenter','woodworker','jeweller','handicraft','basket_maker','sculptor','painter','bookbinder','printmaker','textile','paper') OR osm_tags->>'shop' IN ('craft','art','pottery') OR name_ja ~* '(工房|陶芸|硝子|ガラス|クラフト|手作り体験)'))",
  },
  {
    id: 'vintage',
    label: '빈티지·중고',
    group: 'shopping',
    words: ['빈티지샵', '빈티지 숍', '빈티지', '중고샵', '중고 가게', '앤티크', '골동품'],
    sql: "(osm_tags->>'shop' IN ('second_hand','antiques','charity') OR osm_tags->>'second_hand' IN ('yes','only') OR name_ja ~* '(古着|骨董|アンティーク|ヴィンテージ|ビンテージ)')",
  },
  {
    id: 'clothes',
    label: '옷가게',
    group: 'shopping',
    words: ['옷가게', '의류점', '의류 매장', '패션샵', '패션 숍', '부티크', '신발가게'],
    sql: "(osm_tags->>'shop' IN ('clothes','fashion','boutique','shoes'))",
  },
  {
    id: 'souvenir',
    label: '기념품',
    group: 'shopping',
    words: ['기념품', '선물가게', '잡화점', '굿즈샵', '굿즈 숍'],
    sql: "(osm_tags->>'shop' IN ('gift','variety_store','craft','art'))",
  },
  {
    id: 'bookstore',
    label: '서점·음반',
    group: 'shopping',
    words: ['독립서점', '서점', '책방', '레코드샵', '음반가게'],
    sql: "(osm_tags->>'shop' IN ('books','music'))",
  },
  {
    id: 'market',
    label: '시장',
    group: 'shopping',
    words: ['재래시장', '벼룩시장', '플리마켓', '시장'],
    sql: "(osm_tags->>'amenity'='marketplace' OR osm_tags->>'shop' IN ('mall','department_store'))",
  },
  {
    id: 'shopping',
    label: '쇼핑',
    group: 'shopping',
    broad: true,
    words: ['쇼핑몰', '백화점', '상점', '가게', '쇼핑'],
    sql: "(osm_tags ? 'shop' OR osm_tags->>'amenity'='marketplace')",
  },
  {
    id: 'park',
    label: '공원·정원',
    group: 'nature',
    words: ['국립공원', '자연공원', '공원', '정원', 'park'],
    sql: "(osm_tags->>'leisure' IN ('park','garden','nature_reserve'))",
  },
  {
    id: 'nature',
    label: '자연 명소',
    group: 'nature',
    words: ['자연명소', '자연 명소', '산책로', '트레킹', '폭포', '해변', '전망대', '산', '바다'],
    sql: "(osm_tags->>'natural' IN ('peak','volcano','waterfall','beach','cape','geyser','cave_entrance') OR osm_tags->>'tourism'='viewpoint')",
  },
  {
    id: 'culture',
    label: '문화·예술',
    group: 'culture',
    words: ['문화시설', '문화 공간', '전시', '갤러리', '미술관', '박물관', '공연장', '극장'],
    sql: "(osm_tags->>'tourism' IN ('museum','gallery','artwork') OR osm_tags->>'amenity' IN ('arts_centre','theatre','cinema','planetarium'))",
  },
  {
    id: 'worship',
    label: '신사·사찰',
    group: 'culture',
    words: ['신사', '절', '사찰', '성당', '교회'],
    sql: "(osm_tags->>'amenity'='place_of_worship' OR osm_tags->>'historic' IN ('shrine','temple','church'))",
  },
  {
    id: 'onsen',
    label: '온천',
    group: 'activity',
    words: ['노천탕', '온천', '료칸 온천', 'onsen'],
    sql: "(osm_tags->>'natural'='hot_spring' OR osm_tags->>'bath_type'='onsen' OR name_ja LIKE '%温泉%')",
  },
  {
    id: 'ski',
    label: '스키·눈 체험',
    group: 'activity',
    words: ['스노보드', '스노우보드', '스키장', '스키', '눈썰매'],
    sql: "(osm_tags->>'piste:type' IS NOT NULL OR osm_tags->>'leisure' IN ('sports_centre','winter_sports') OR name_ja ~* '(スキー|スノーボード)')",
  },
  {
    id: 'fun',
    label: '놀거리·액티비티',
    group: 'activity',
    broad: true,
    words: ['놀거리', '즐길거리', '액티비티'],
    sql: "(osm_tags->>'tourism' IN ('theme_park','zoo','aquarium','museum','attraction') OR osm_tags->>'leisure' IN ('water_park','amusement_arcade','sports_centre','playground','bowling_alley','escape_game'))",
  },
  {
    id: 'korean',
    label: '한식',
    group: 'food',
    words: ['한국 음식', '한국요리', '한식'],
    sql: "(category='RESTAURANT' AND osm_tags->>'cuisine' ~* '(^|;)[ ]*korean[ ]*(;|$)')",
  },
  {
    id: 'japanese',
    label: '일식',
    group: 'food',
    words: ['일본 음식', '일본요리', '일식', 'japanese'],
    sql: "(category='RESTAURANT' AND osm_tags->>'cuisine' ~* '(^|;)[ ]*(japanese|sushi|ramen|udon|soba|tempura|yakitori|tonkatsu|donburi|unagi|yakiniku)[ ]*(;|$)')",
  },
  {
    id: 'western',
    label: '양식',
    group: 'food',
    words: ['서양 음식', '이탈리안', '프렌치', '양식', 'western'],
    sql: "(category='RESTAURANT' AND osm_tags->>'cuisine' ~* '(^|;)[ ]*(western|italian|french|american|pizza|burger|steak_house|pasta)[ ]*(;|$)')",
  },
  {
    id: 'chinese',
    label: '중식',
    group: 'food',
    words: ['중국 음식', '중국요리', '중식'],
    sql: "(category='RESTAURANT' AND osm_tags->>'cuisine' ~* '(^|;)[ ]*(chinese|gyoza|dim_sum)[ ]*(;|$)')",
  },
  {
    id: 'asian',
    label: '아시아 음식',
    group: 'food',
    words: [
      '태국 음식',
      '태국요리',
      '베트남 음식',
      '베트남요리',
      '인도 음식',
      '인도요리',
      '아시아 음식',
    ],
    sql: "(category='RESTAURANT' AND osm_tags->>'cuisine' ~* '(^|;)[ ]*(thai|vietnamese|indian|asian)[ ]*(;|$)')",
  },
  {
    id: 'ramen',
    label: '라멘',
    group: 'food',
    words: ['라멘', '라면'],
    sql: "(category='RESTAURANT' AND osm_tags->>'cuisine' ~* '(^|;)[ ]*(ramen|noodle)[ ]*(;|$)')",
  },
  {
    id: 'sushi',
    label: '스시·해산물',
    group: 'food',
    words: ['초밥', '스시', '해산물', '회', '카이센동'],
    sql: "(category='RESTAURANT' AND osm_tags->>'cuisine' ~* '(^|;)[ ]*(sushi|seafood|fish)[ ]*(;|$)')",
  },
  {
    id: 'curry',
    label: '카레',
    group: 'food',
    words: ['수프카레', '스프카레', '카레', '커리'],
    sql: "(category='RESTAURANT' AND osm_tags->>'cuisine' ~* '(^|;)[ ]*(curry|soup_curry|indian)[ ]*(;|$)')",
  },
  {
    id: 'meat',
    label: '고기·야키니쿠',
    group: 'food',
    words: ['야키니쿠', '징기스칸', '고깃집', '고기집', '바비큐'],
    sql: "(category='RESTAURANT' AND osm_tags->>'cuisine' ~* '(^|;)[ ]*(yakiniku|barbecue|steak_house|regional)[ ]*(;|$)')",
  },
  {
    id: 'dessert',
    label: '디저트·베이커리',
    group: 'food',
    words: ['베이커리', '빵집', '디저트', '아이스크림', '도넛', '과자점'],
    sql: "(category='RESTAURANT' AND (osm_tags->>'shop' IN ('bakery','confectionery','chocolate') OR osm_tags->>'amenity'='ice_cream' OR osm_tags->>'cuisine' ~* '(^|;)[ ]*(donut|ice_cream|dessert)[ ]*(;|$)'))",
  },
  {
    id: 'cafe',
    label: '카페',
    group: 'food',
    words: ['커피숍', '커피샵', '카페', '커피', 'cafe'],
    sql: "(category='RESTAURANT' AND (osm_tags->>'amenity'='cafe' OR osm_tags->>'cuisine' ~* '(^|;)[ ]*(coffee_shop|tea)[ ]*(;|$)'))",
  },
  {
    id: 'bar',
    label: '술집·바',
    group: 'food',
    words: ['이자카야', '술집', '펍', '와인바', '바'],
    sql: "(category='RESTAURANT' AND (osm_tags->>'amenity' IN ('bar','pub') OR osm_tags->>'cuisine' ~* '(^|;)[ ]*(izakaya|wine)[ ]*(;|$)'))",
  },
  {
    id: 'food',
    label: '음식점',
    group: 'food',
    broad: true,
    words: ['레스토랑', '음식점', '식당', '맛집', '먹거리'],
    sql: "category='RESTAURANT'",
  },
  {
    id: 'ryokan',
    label: '료칸',
    group: 'stay',
    words: ['료칸', '전통 숙소'],
    sql: "(category='LODGING' AND (name_ja ~ '(旅館|温泉)' OR osm_tags->>'tourism' IN ('guest_house','hotel')))",
  },
  {
    id: 'camping',
    label: '캠핑',
    group: 'stay',
    words: ['글램핑', '캠핑장', '캠핑', '오토캠핑'],
    sql: "(category='LODGING' AND osm_tags->>'tourism' IN ('camp_site','caravan_site','wilderness_hut','alpine_hut'))",
  },
  {
    id: 'hostel',
    label: '호스텔·게스트하우스',
    group: 'stay',
    words: ['게스트하우스', '호스텔', '도미토리'],
    sql: "(category='LODGING' AND osm_tags->>'tourism' IN ('hostel','guest_house'))",
  },
  {
    id: 'stay',
    label: '숙소',
    group: 'stay',
    broad: true,
    words: ['숙박시설', '숙박', '숙소', '호텔'],
    sql: "category='LODGING'",
  },
];
const aliases = regions.flatMap((r) =>
  [r.id, ...r.name.split('·'), ...r.ja.split('・')].map((word) => ({ word, id: r.id })),
);
aliases.push(
  { word: '노보리베츠', id: 'toya-noboribetsu' },
  { word: '굿찬', id: 'niseko-kutchan' },
  { word: '치토세', id: 'new-chitose' },
);
aliases.sort((a, b) => b.word.length - a.word.length);
export function parsePlaceSearch(query: string, selectedRegion?: string) {
  let text = query.trim().toLowerCase();
  const found: string[] = [];
  for (const a of aliases)
    if (text.includes(a.word.toLowerCase())) {
      found.push(a.id);
      text = text.split(a.word.toLowerCase()).join(' ');
    }
  const regionIds = [...new Set(found.length ? found : selectedRegion ? [selectedRegion] : [])];
  const matched: (typeof searchKinds)[number][] = [];
  // Only consume whole expressions. Substring matching corrupts names such as 스스키노.
  const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const kind of searchKinds) {
    let hit = false;
    for (const word of [...kind.words].sort((a, b) => b.length - a.length)) {
      const pattern = new RegExp('(^|[\\s,])' + escape(word) + '(?=$|[\\s,])', 'gu');
      if (pattern.test(text)) {
        hit = true;
        text = text.replace(pattern, ' ');
      }
    }
    if (hit) matched.push(kind);
  }
  const kinds = matched.filter(
    (kind) =>
      !kind.broad ||
      !matched.some((other) => other !== kind && other.group === kind.group && !other.broad),
  );
  return { regionIds, kinds, text: text.trim().replace(/\s+/g, ' ') };
}
