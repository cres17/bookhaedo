import type { Season } from './region-guides';
export type CultureEvent = {
  name: string;
  seasons: Season[];
  origin: string;
  experience: string;
  url: string;
  source: string;
};
export type RegionCulture = {
  title: string;
  paragraphs: string[];
  source: string;
  events: CultureEvent[];
};
const tourism = (path: string) => `https://www.visit-hokkaido.jp/${path}.html`;
const event = (
  name: string,
  seasons: Season[],
  origin: string,
  experience: string,
  url: string,
  source = url,
): CultureEvent => ({ name, seasons, origin, experience, url, source });
export const eventSearchUrl = 'https://www.visit-hokkaido.jp/en/event/';
export const regionCulture: Record<string, RegionCulture> = {
  sapporo: {
    title: '공원이 도시의 달력이 되는 곳',
    paragraphs: [
      '삿포로를 이해하는 출발점은 오도리 공원입니다. 원래 도시의 화재 확산을 막는 공간으로 조성된 이곳은 지금은 산책로이자 시민의 만남터, 계절 행사의 무대입니다. 같은 공원을 걸어도 꽃과 분수, 먹거리 행사, 눈 조각에 따라 전혀 다른 도시를 만나게 됩니다.',
      '도심에서 조잔케이로 나가면 여행의 중심이 거리에서 계곡과 온천으로 바뀝니다. 낮에는 공원과 건축을 보고 저녁에는 행사나 식사를 즐기는 도시 일정, 숲에서 쉬는 근교 일정을 나누면 삿포로의 두 모습을 충분히 느낄 수 있습니다.',
    ],
    source: tourism('en/spot/detail_10004'),
    events: [
      event(
        '삿포로 눈축제',
        ['winter'],
        '1950년 지역 중·고등학생들이 오도리 공원에 눈 조각 여섯 개를 만든 것이 출발점입니다. 눈싸움과 카니발을 곁들인 시민 행사가 큰 호응을 얻으면서 도시를 대표하는 겨울 축제로 성장했습니다.',
        '대형 눈 조각과 얼음 작품을 감상하며 도시의 겨울 문화를 만납니다. 작품과 프로그램은 해마다 바뀌므로 회장별 안내를 보고 방문 구역을 고르세요.',
        'https://www.snowfes.com/en/',
        'https://www.snowfes.com/en/about/history/',
      ),
      event(
        '삿포로 화이트 일루미네이션',
        ['autumn', 'winter'],
        '겨울에도 도시의 매력을 전하기 위해 1981년에 시작됐습니다. 오도리 공원의 작은 조명 장식에서 출발해, 눈과 빛을 함께 즐기는 도시의 풍경으로 자리 잡았습니다.',
        '조형물과 가로수의 빛을 따라 밤 산책을 즐기는 행사입니다. 눈축제와 별개 행사이며, 회장마다 점등 기간과 시간이 다릅니다.',
        'https://www.sapporo.travel/white-illumination/',
        'https://www.sapporo.travel/en/bunkazaisanpo/fubutushi/',
      ),
      event(
        '삿포로 오텀 페스트',
        ['autumn'],
        '홋카이도의 수확철과 지역 먹거리를 함께 즐기는 행사로 2008년에 시작됐습니다. 섬 곳곳의 특산물과 요리를 도심에 모아 지역의 식문화를 소개합니다.',
        '오도리 공원 구역별로 다른 먹거리 주제를 만납니다. 한 곳에서 배를 채우기보다 관심 있는 지역의 음식을 골라 맛보는 방식으로 즐겨보세요.',
        'https://www.sapporo.travel/autumnfest/',
        'https://www.sapporo.travel/en/bunkazaisanpo/fubutushi/',
      ),
    ],
  },
  otaru: {
    title: '물류의 길이 산책의 길이 되기까지',
    paragraphs: [
      '오타루 운하는 항구에 도착한 화물을 작은 배로 나르기 위해 만들어졌고, 1923년에 완성됐습니다. 지금 사진 속 배경이 되는 석조 창고는 항구 도시가 번성하던 시절의 흔적입니다. 건물을 풍경으로만 보기보다 물건과 사람이 오가던 장소로 생각하면 산책이 더 흥미로워집니다.',
      '북운하는 옛 폭을 간직하고, 산책로가 정비된 구역은 물가를 따라 걷기 편합니다. 낮에는 창고와 건축의 질감을 보고, 해질 무렵에는 가스등이 물에 비치는 모습을 감상하세요. 미술관과 공예품 가게를 사이에 넣으면 거리의 역사와 오늘의 생활을 함께 만날 수 있습니다.',
    ],
    source: tourism('en/spot/detail_10040'),
    events: [
      event(
        '오타루 눈빛거리 축제',
        ['winter'],
        '관광객이 적었던 겨울과 밤에 활기를 더하고자 1999년에 시작됐습니다. 이름은 오타루와 인연이 깊은 작가 이토 세이의 시집에서 가져왔습니다. 화려함을 경쟁하기보다 사람들이 손으로 만든 불빛을 소중히 여기는 행사입니다.',
        '시민과 자원봉사자가 눈 장식과 촛불을 준비합니다. 운하와 거리의 작은 불빛을 걸으며 감상하고, 만든 사람들의 정성을 느끼는 방식으로 즐깁니다.',
        tourism('en/event/detail_11004'),
        'https://otaru.gr.jp/column/snowlightpath-and-itosei',
      ),
    ],
  },
  hakodate: {
    title: '항구의 기억과 언덕의 시선',
    paragraphs: [
      '하코다테는 항구, 언덕, 별 모양 요새가 서로 다른 이야기를 들려주는 도시입니다. 하치만자카에서는 곧게 뻗은 길 끝에 바다가 나타나고, 고료카쿠에서는 해자와 요새의 형태가 도시의 역사적인 풍경을 만듭니다. 전망을 보는 일과 거리를 걷는 일이 자연스럽게 이어집니다.',
      '봄의 고료카쿠는 벚꽃이 중심이지만 여름에는 녹음, 가을에는 나무의 색, 겨울에는 눈이 요새의 윤곽을 드러냅니다. 항구와 모토마치 일대는 걸어서 살펴보고, 고료카쿠와 고세쓰엔은 별도 구역으로 나눠 방문하는 편이 각 장소를 충분히 느끼기 좋습니다.',
    ],
    source: tourism('en/plan/detail_12'),
    events: [
      event(
        '하코다테 항구축제',
        ['summer'],
        '1934년 대화재로 큰 피해를 입은 시민들을 격려하고, 항구 개항 77주년을 기념하기 위해 1935년에 시작됐습니다. 항구 도시의 회복과 시민의 연대가 축제의 배경입니다.',
        '거리 행진과 항구 춤, 오징어 춤인 이카오도리, 불꽃놀이로 여름을 기념합니다. 오징어 춤의 익살스러운 동작은 시민과 여행자가 함께 분위기를 즐기는 대표 장면입니다.',
        'https://www.hakodate.travel/en/events/hakodate-port-festival/',
      ),
    ],
  },
  'asahikawa-biei': {
    title: '동물의 움직임에서 농촌의 풍경으로',
    paragraphs: [
      '아사히카와와 비에이는 하나의 도심이 아니라 서로 다른 경험을 이어주는 관광권입니다. 아사히야마 동물원은 동물의 움직임과 생활 방식을 관찰하는 전시로 알려져 있고, 비에이는 언덕과 꽃밭, 숲과 연못의 색을 바라보는 여행에 어울립니다.',
      '비에이의 풍경은 계절뿐 아니라 날씨와 빛에 따라서도 달라집니다. 푸른 연못은 늘 같은 색을 보여주는 수조가 아니며, 언덕 주변 농지는 실제로 농사를 짓는 생활 공간입니다. 사진 한 장을 위해 서두르기보다 허용된 관람 구역에서 풍경이 달라지는 모습을 기다려보세요.',
    ],
    source: tourism('en/plan/detail_13'),
    events: [
      event(
        '아사히카와 겨울축제',
        ['winter'],
        '지역 사람들이 겨울에 축제를 열자는 뜻을 모아 1960년에 첫 행사를 열었습니다. 눈과 얼음, 빛을 축제의 재료로 삼아 긴 겨울을 함께 즐기는 지역 행사로 이어지고 있습니다.',
        '대형 눈 조각과 무대 행사, 겨울 먹거리 공간을 둘러봅니다. 눈 조각의 주제와 체험 프로그램이 해마다 달라 같은 장소에서도 다른 겨울을 만날 수 있습니다.',
        'https://asahikawa-winterfes.jp/',
        'https://asahikawa-winterfes.jp/history/',
      ),
    ],
  },
  furano: {
    title: '사진 속 보랏빛 들판에 담긴 농장의 시간',
    paragraphs: [
      '후라노의 라벤더는 처음부터 사진 촬영만을 위한 장식이 아니었습니다. 팜 도미타는 라벤더를 작물로 재배해 온 역사를 전하는 농장으로, 꽃밭과 함께 향유 증류와 라벤더 제품을 만날 수 있습니다. 꽃을 보는 일에 향과 농장의 이야기를 더하면 여행이 더 깊어집니다.',
      '라벤더가 피지 않는 계절에도 후라노의 모습은 이어집니다. 계절 꽃이 바뀌고, 닝구르 테라스에서는 나무·유리·가죽 등 숲에서 영감을 얻은 공예를 만납니다. 여름에는 들판에, 겨울에는 눈 덮인 숲의 공방에 시간을 더 배분하는 방식이 잘 어울립니다.',
    ],
    source: tourism('en/spot/detail_10174'),
    events: [
      event(
        '홋카이 배꼽축제',
        ['summer'],
        '후라노가 홋카이도의 지리적 중심, 즉 배꼽에 해당한다는 발상에서 탄생했습니다. 지역의 위치를 유쾌한 춤으로 표현하며 사람들의 유대를 다지는 축제입니다.',
        '배에 커다란 얼굴을 그리고 모자로 머리를 가린 뒤 배를 움직여 춤을 춥니다. 몸이 하나의 얼굴처럼 보이는 익살스러운 행렬이 대표 장면이며, 참가 방식은 주최 측 안내에서 확인할 수 있습니다.',
        'https://hesomatsuri.com/guide',
      ),
    ],
  },
  'niseko-kutchan': {
    title: '설산만큼 중요한 산 아래의 일상',
    paragraphs: [
      '니세코·굿찬을 겨울 스키장으로만 기억하면 산 아래의 풍경을 놓치기 쉽습니다. 요테이산 주변에는 용출수가 솟는 공원과 농촌, 산속 습원이 이어집니다. 굿찬은 감자가 지역의 대표 특산물일 만큼 농업의 일상도 뚜렷한 곳입니다.',
      '여름에는 물과 숲을 따라 움직이고, 가을에는 신센누마의 풀과 나무가 바뀌는 색을 감상합니다. 겨울에는 고지대 관광도로가 닫히므로 여름 드라이브 동선을 그대로 사용할 수 없습니다. 같은 지역이라도 계절마다 여행 지도를 다시 그려야 하는 곳입니다.',
    ],
    source: 'https://www.town.kutchan.hokkaido.jp/tourism/',
    events: [
      event(
        '굿찬 감자축제',
        ['summer'],
        '지역 특산물인 굿찬 감자를 주제로 여는 여름 축제입니다. 산의 풍경뿐 아니라 농산물과 주민의 생활을 여행자에게 소개하는 자리입니다.',
        '감자를 주제로 한 먹거리와 거리 행사, 지역 공연을 즐깁니다. 해마다 프로그램이 달라지므로 굿찬정 공식 페이지에서 해당 회차의 행사 안내를 선택하세요.',
        'https://www.town.kutchan.hokkaido.jp/tourism/jaga-matsuri/',
      ),
    ],
  },
  'toya-noboribetsu': {
    title: '화산이 만든 풍경, 온천으로 이어진 생활',
    paragraphs: [
      '도야코와 노보리베쓰의 공통점은 화산입니다. 도야코에서는 호수와 우스산의 지형을 넓게 바라보고, 노보리베쓰에서는 김이 솟는 지옥계곡을 가까이에서 만납니다. 같은 화산의 흔적이 전망과 온천이라는 서로 다른 여행 경험으로 이어집니다.',
      '노보리베쓰의 도깨비는 온천을 지키는 존재로 행사와 마을의 상징에 등장합니다. 풍경을 본 뒤 관련 이야기를 알고 온천가를 걸으면 장식 하나도 다르게 보입니다. 도야코와 노보리베쓰는 떨어져 있으므로 한 온천가를 숙박 거점으로 정하고 나누어 둘러보세요.',
    ],
    source: tourism('en/spa/plan/detail_43'),
    events: [
      event(
        '지옥계곡 도깨비 불꽃',
        ['summer', 'autumn'],
        '온천의 수호신인 유키진이 방문객의 건강과 안녕을 기원하는 행사입니다. 화산에서 솟는 온천과 지역의 도깨비 전승을 불꽃 공연으로 연결합니다.',
        '도깨비 탈과 붉은 옷을 입은 연희자가 북과 징 소리에 맞춰 등장하고, 손에 든 불꽃 장치에서 큰 불기둥을 쏘아 올립니다. 일반 불꽃놀이와 달리 온천의 수호와 기원을 표현하는 공연입니다.',
        tourism('en/event/detail_11443'),
      ),
    ],
  },
  'obihiro-tokachi': {
    title: '밭과 정원, 과자가 이어지는 풍경',
    paragraphs: [
      '도카치는 넓은 평야의 농업과 지역 먹거리, 정원 여행을 함께 만나는 곳입니다. 롯카노모리에서는 과자 브랜드의 꽃 그림과 연결된 자연을 숲과 갤러리로 만나고, 마나베 정원에서는 다양한 나무가 만드는 정원 풍경을 걸을 수 있습니다.',
      '여름의 정원 여행이 겨울까지 그대로 이어지는 것은 아닙니다. 정원이 문을 닫는 시기에는 오비히로의 먹거리와 도카치가와 온천, 겨울 빛 행사로 여행의 중심을 바꿔보세요. 농업의 지역이라는 배경을 알고 보면 축제의 재료와 지역 간식도 여행의 일부가 됩니다.',
    ],
    source: tourism('en/plan/detail_42'),
    events: [
      event(
        '도카치가와 사이린카',
        ['winter'],
        '도카치가와 온천에 해마다 찾아오는 백조에서 유래한 겨울 행사입니다. 눈 덮인 온천 지역을 빛과 소리로 채우며 겨울의 자연을 기념합니다.',
        '농업용 보온재를 활용한 조형물이 음악에 맞춰 색을 바꾸는 빛 공연을 감상합니다. 따뜻한 온천 휴식과 야간 관람을 연결해 즐기는 방식이 잘 어울립니다.',
        'https://www.tokachigawa.net/event/sairinka.html',
        tourism('en/event/detail_11026'),
      ),
    ],
  },
  'kushiro-akan': {
    title: '자연을 보는 여행에서 지키는 이야기를 듣는 여행으로',
    paragraphs: [
      '구시로의 습원은 넓은 풍경을 바라보는 곳이면서 두루미와 다양한 생물이 살아가는 환경입니다. 전망대의 전시를 먼저 살펴보면 물길과 식생, 계절에 따라 달라지는 동물의 모습을 이해하며 풍경을 볼 수 있습니다.',
      '아칸 호수에서는 마리모와 아이누 문화를 함께 만납니다. 호수의 자연은 주민의 생활과 기도, 보호 활동과 분리되어 있지 않습니다. 온천과 호숫가 산책에 문화 관람을 더하면 단순한 경치 여행을 넘어 이곳 사람들이 자연과 관계 맺어 온 방식을 배울 수 있습니다.',
    ],
    source: tourism('en/plan/detail_63'),
    events: [
      event(
        '아칸 마리모 축제',
        ['autumn'],
        '불법 채취와 수위 변화 등으로 위기에 놓인 마리모를 보호하고 호수로 돌려보내기 위해 1950년에 시작됐습니다. 자연 보호의 뜻과 아이누의 기도·의례가 함께 이어지는 행사입니다.',
        '마리모를 맞이하고 지킨 뒤 통나무배로 호수에 돌려보내는 의식을 진행합니다. 횃불 행진과 전통 춤도 이어집니다. 의례는 관람 안내를 존중하며 조용히 지켜보세요.',
        tourism('event/detail_11017'),
      ),
    ],
  },
  'abashiri-shiretoko': {
    title: '같은 바다, 다른 방식으로 만나는 자연',
    paragraphs: [
      '아바시리는 오호츠크해와 유빙을 전시·전망·배로 만나는 거점이고, 시레토코는 원시림과 호수의 생태를 가까이에서 경험하는 지역입니다. 유빙관에서 바다의 계절을 이해한 뒤 실제 해안을 보면 겨울 풍경이 만들어지는 과정까지 생각하게 됩니다.',
      '시레토코 오호는 자유롭게 어디든 걷는 공원이 아닙니다. 자연과 야생동물을 보호하기 위해 탐방 방식이 시기별로 달라집니다. 여름의 숲길, 겨울의 가이드 투어, 아바시리의 실내 관람을 같은 종류의 일정으로 생각하지 말고 체험 조건에 맞춰 선택하세요.',
    ],
    source: 'https://www.shiretoko.asia/detail/scenic/shiretoko_goko',
    events: [
      event(
        '아바시리 오호츠크 유빙축제',
        ['winter'],
        '지역의 겨울을 상징하는 유빙을 더 가까이 이해하고 그 매력과 보전의 필요성을 알리는 축제입니다. 단순히 얼음 풍경을 소비하는 것을 넘어 유빙을 지키기 위해 할 수 있는 일을 함께 생각하게 합니다.',
        '눈·얼음 조형물과 행사장을 둘러보며 겨울 도시의 분위기를 즐깁니다. 유빙 관광선과는 별개 행사이므로 축제 관람과 승선 예약을 각각 확인해야 합니다.',
        'https://visit-abashiri.visit-abashiri.jp/event/b9b5c81d6a90669b636d2b1511eafef4416fbcc5.html',
      ),
    ],
  },
  'wakkanai-rishiri-rebun': {
    title: '북쪽 항구에서 섬의 시간을 만나다',
    paragraphs: [
      '왓카나이는 북쪽 바다와 섬 여행을 잇는 출발점입니다. 리시리는 산의 실루엣과 물가 풍경, 레분은 해안을 따라 걷는 길과 고산 식물로 서로 다른 인상을 남깁니다. 두 섬을 이름만 보고 비슷한 여행지로 묶기보다, 산을 보고 싶은지 꽃길을 걷고 싶은지부터 골라보세요.',
      '섬 여행의 속도는 배편과 바람이 정합니다. 여름에는 꽃과 탐방을 중심으로 머물고, 추운 계절에는 교통과 숙소 운영을 먼저 확인해야 합니다. 왕복 이동으로 하루를 채우기보다 한 섬에 충분히 머물고 본섬 복귀에 여유를 남기는 계획이 어울립니다.',
    ],
    source: tourism('en/plan/detail_16'),
    events: [
      event(
        '왓카나이 항구·남극축제',
        ['summer'],
        '왓카나이는 남극 관측에 참여한 사할린개들과 인연이 있는 도시입니다. 남극과의 인연을 주제로 시작된 남극축제와 기존 항구축제가 오늘의 행사로 이어졌습니다. 북쪽 항구에서 남극을 기억하는 이유입니다.',
        '홋카이 텟펜 춤과 남극 춤, 불꽃놀이로 짧은 여름을 함께 즐깁니다. 지역의 남극 관련 역사와 추모의 의미를 알고 보면 축제 이름을 더 깊이 이해할 수 있습니다.',
        'https://www.north-hokkaido.com/event/detail_1411.html',
        'https://www.north-hokkaido.com/event/detail_1411.html',
      ),
    ],
  },
  'new-chitose': {
    title: '공항 밖으로 이어지는 물의 여행',
    paragraphs: [
      '신치토세는 공항만을 뜻하는 여행지로 보기보다 치토세강과 호수로 이어지는 관문으로 생각해보세요. 연어의 고향 수족관은 강 속을 직접 바라보는 관찰창이 있어 봄의 어린 연어와 가을의 회귀처럼 살아 있는 강의 계절을 만날 수 있습니다.',
      '시코쓰코는 겨울에 호수의 물을 얼려 만든 조형물로 또 다른 모습을 드러냅니다. 자연의 차가움을 피하기만 하는 대신 여행의 자원으로 바꾼 지역의 선택입니다. 공항과 호수는 별도 이동이 필요하므로 비행 전 짧은 빈 시간보다는 충분한 반나절 이상을 따로 확보하는 편을 권합니다.',
    ],
    source: tourism('en/spot/detail_10144'),
    events: [
      event(
        '치토세·시코쓰코 얼음축제',
        ['winter'],
        '관광객이 줄어드는 겨울에도 시코쓰코로 사람들을 맞이하고자 1979년에 시작됐습니다. 호수의 물과 겨울의 추위를 거대한 얼음 작품으로 바꾼 지역 행사입니다.',
        '호수의 물을 뿌려 얼린 조형물을 낮에는 푸른 얼음빛으로, 밤에는 조명과 함께 감상합니다. 봄·여름·가을에 방문하면 겨울 축제의 얼음 전시를 볼 수 없습니다.',
        'https://www.1000sai-chitose.or.jp/feature/detail_47.html',
      ),
    ],
  },
};

export type AccessNotice = { label: string; text: string; source: string };
export const accessNotices: Record<string, Partial<Record<Season, AccessNotice[]>>> = {
  furano: {
    spring: [
      {
        label: '라벤더 꽃밭 관람 불가',
        text: '봄에는 야외 라벤더가 개화하지 않습니다. 농장 방문은 가능하지만 여름의 보랏빛 꽃밭은 볼 수 없습니다.',
        source: tourism('en/spot/detail_10174'),
      },
    ],
    winter: [
      {
        label: '야외 꽃밭 관람 불가',
        text: '겨울에는 야외 라벤더 꽃밭을 볼 수 없습니다. 숲의 공방과 겨울 운영 시설을 중심으로 계획하세요.',
        source: tourism('en/spot/detail_10174'),
      },
    ],
  },
  'niseko-kutchan': {
    spring: [
      {
        label: '겨울 도로 통제 잔여 기간',
        text: '신센누마 방면 도도 66호선은 겨울 통제 해제 전에는 차량으로 갈 수 없습니다. 봄 여행도 도로 개통 공지를 먼저 확인해야 합니다.',
        source: 'https://www.town.kyowa.hokkaido.jp/tourism/?content=201',
      },
    ],
    autumn: [
      {
        label: '늦가을 도로 폐쇄',
        text: '신센누마 방면 도도 66호선은 겨울 통제가 시작되면 차량으로 갈 수 없습니다. 단풍 여행도 도로 폐쇄 전 일정으로 잡아야 합니다.',
        source: 'https://www.town.kyowa.hokkaido.jp/tourism/?content=201',
      },
    ],
    winter: [
      {
        label: '겨울 차량 접근 불가',
        text: '신센누마 방면 도도 66호선은 겨울에 통행이 금지됩니다. 여름 관광도로를 이용하는 신센누마 드라이브는 할 수 없습니다.',
        source: 'https://www.town.kyowa.hokkaido.jp/tourism/?content=201',
      },
    ],
  },
  'obihiro-tokachi': {
    winter: [
      {
        label: '겨울 휴장 · 입장 불가',
        text: '롯카노모리는 겨울에 문을 닫습니다. 겨울 정원 관람 일정에 넣을 수 없습니다. 개원 기간은 운영사 안내에서 확인하세요.',
        source: 'https://www.rokkatei.co.jp/facilities/六花の森-2/',
      },
    ],
    spring: [
      {
        label: '개원 전 입장 불가',
        text: '롯카노모리는 봄 개원일 이전에는 입장할 수 없습니다. 봄 전체를 관람 가능한 기간으로 생각하면 안 됩니다.',
        source: 'https://www.rokkatei.co.jp/facilities/六花の森-2/',
      },
    ],
    autumn: [
      {
        label: '시즌 종료 후 입장 불가',
        text: '롯카노모리는 가을에 시즌 운영을 마칩니다. 폐원일 이후에는 정원에 입장할 수 없습니다.',
        source: 'https://www.rokkatei.co.jp/facilities/六花の森-2/',
      },
    ],
  },
  'abashiri-shiretoko': {
    winter: [
      {
        label: '겨울 자유 탐방 불가',
        text: '시레토코 오호의 일반 탐방로와 고가 목도는 겨울에 폐쇄됩니다. 겨울 탐방은 지정 기간에 인증 가이드가 동행하는 유료 생태 투어로만 가능합니다.',
        source: 'https://www.shiretoko.asia/detail/tourist/gentouki_goko',
      },
      {
        label: '유빙 관찰 · 운항은 조건부',
        text: '겨울이라고 매일 유빙이 보이거나 배가 출항하는 것은 아닙니다. 당일 유빙 상태와 운항 공지에 따라 승선 일정을 정해야 합니다.',
        source: tourism('en/spot/detail_10045'),
      },
    ],
  },
};

/** Keep each practical instruction on its own line without rewriting its meaning. */
export function tipSentences(tip: string): string[] {
  return tip.split(/(?<=[.!?])\s+/).filter(Boolean);
}
