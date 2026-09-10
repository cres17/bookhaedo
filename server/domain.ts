import { z } from 'zod';
export const uuid = z.string().uuid();
export const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const d = new Date(`${value}T00:00:00Z`);
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
  }, '유효한 날짜를 입력해주세요.');
export const registerInput = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((x) => x.toLowerCase()),
  password: z.string().min(10).max(128),
  name: z.string().trim().min(1).max(40),
});
export const loginInput = registerInput.omit({ name: true });
export const tripInput = z.object({
  title: z.string().trim().min(1).max(100),
  startDate: dateOnly,
  days: z.number().int().min(1).max(30),
  transportMode: z.enum(['DRIVE', 'TAXI', 'TRANSIT', 'WALK', 'BICYCLE']).default('DRIVE'),
});
export const orderInput = z.object({
  placeIds: z
    .array(uuid)
    .max(30)
    .refine(
      (ids) => new Set(ids).size === ids.length,
      '같은 날에 동일 장소를 두 번 추가할 수 없습니다.',
    ),
});
export function addDate(date: string, offset: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
export function straightDistance(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const rad = Math.PI / 180,
    x =
      Math.sin(((b.latitude - a.latitude) * rad) / 2) ** 2 +
      Math.cos(a.latitude * rad) *
        Math.cos(b.latitude * rad) *
        Math.sin(((b.longitude - a.longitude) * rad) / 2) ** 2;
  return Math.round(6371008.8 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x))));
}
export const regions = [
  ['sapporo', '삿포로', '札幌', 43.0687, 141.3508, '도시의 온도, 눈의 고요함', 'sapporo'],
  ['otaru', '오타루', '小樽', 43.197, 140.9937, '운하에 내려앉은 푸른 시간', 'otaru'],
  ['hakodate', '하코다테', '函館', 41.7737, 140.7266, '항구 너머, 빛나는 밤', 'hakodate'],
  [
    'asahikawa-biei',
    '아사히카와·비에이',
    '旭川・美瑛',
    43.591,
    142.4611,
    '언덕과 푸른 호수 사이',
    'biei',
  ],
  ['furano', '후라노', '富良野', 43.342, 142.3913, '계절이 색으로 피어나는 곳', 'furano'],
  [
    'niseko-kutchan',
    '니세코·굿찬',
    'ニセコ・倶知安',
    42.8615,
    140.7048,
    '가장 부드러운 겨울',
    'niseko',
  ],
  [
    'toya-noboribetsu',
    '도야코·노보리베쓰',
    '洞爺湖・登別',
    42.565,
    140.821,
    '따뜻한 물, 깊은 쉼',
    'toya',
  ],
  [
    'obihiro-tokachi',
    '오비히로·도카치',
    '帯広・十勝',
    42.9178,
    143.202,
    '끝없이 펼쳐지는 초록',
    'tokachi',
  ],
  [
    'kushiro-akan',
    '구시로·아칸',
    '釧路・阿寒',
    43.4356,
    144.0956,
    '자연이 들려주는 오래된 이야기',
    'akan',
  ],
  [
    'abashiri-shiretoko',
    '아바시리·시레토코',
    '網走・知床',
    44.0706,
    144.995,
    '야생과 만나는 동쪽 끝',
    'shiretoko',
  ],
  [
    'wakkanai-rishiri-rebun',
    '왓카나이·리시리·레분',
    '稚内・利尻・礼文',
    45.417,
    141.677,
    '바람을 따라, 더 북쪽으로',
    'rishiri',
  ],
  ['new-chitose', '신치토세', '新千歳', 42.7752, 141.6923, '여행의 첫 페이지', 'chitose'],
].map(([id, name, ja, latitude, longitude, description, image]) => ({
  id: String(id),
  name: String(name),
  ja: String(ja),
  latitude: Number(latitude),
  longitude: Number(longitude),
  description: String(description),
  image: String(image),
}));
export const placeSelect = `id, region_id AS "regionId", category, name_ja AS "nameJa", name_ko AS "nameKo", name_en AS "nameEn", COALESCE(name_ko,name_ja) AS name, latitude, longitude, address, municipality_name AS municipality, website, phone, opening_hours AS "openingHours", osm_tags AS tags`;
