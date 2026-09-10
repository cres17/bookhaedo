import { it, expect } from 'vitest';
import { dedupePlaces } from '../server/place-dedupe';
const p = (id: number, nameJa: string, latitude: number, brand?: string) => ({
  id: String(id),
  regionId: 'sapporo',
  category: 'RESTAURANT',
  nameJa,
  latitude,
  longitude: 141.35,
  tags: brand ? { brand } : {},
});
it('같은 이름이 3곳 이상인 체인은 대표 한 곳만 남긴다', () => {
  const rows = [
    p(1, 'マクドナルド', 43.01),
    p(2, 'マクドナルド', 43.05),
    p(3, 'マクドナルド', 43.1),
  ];
  expect(dedupePlaces(rows)).toHaveLength(1);
});
it('지점명이 붙은 체인도 같은 브랜드로 묶는다', () => {
  expect(
    dedupePlaces([p(1, 'マクドナルド', 43.01), p(2, 'マクドナルド江別3番通店', 43.2)]),
  ).toHaveLength(1);
});
it('서로 먼 동명 소규모 장소는 유지하고 근접 중복만 합친다', () => {
  expect(dedupePlaces([p(1, '喫茶店', 43.01), p(2, '喫茶店', 43.05)])).toHaveLength(2);
  expect(dedupePlaces([p(1, '喫茶店', 43.0101), p(2, '喫茶店', 43.0102)])).toHaveLength(1);
});
