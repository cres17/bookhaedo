import { it, expect } from 'vitest';
import { parsePlaceSearch } from '../server/place-search';
import { beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../server/app';
import { pool, migrate } from '../server/db';
beforeAll(migrate);
afterAll(() => pool.end());
it('실제 지역·분류 AND 검색과 페이지 결과를 검증한다', async () => {
  for (const [q, region, type] of [
    ['삿포로 공원', 'sapporo', '공원·정원'],
    ['오타루 일식', 'otaru', '일식'],
    ['하코다테 양식', 'hakodate', '양식'],
    ['후라노 놀거리', 'furano', '놀거리·액티비티'],
  ]) {
    const r = await request(app).get('/api/places').query({ q, limit: 100 });
    expect(r.status).toBe(200);
    expect(r.body.filters.regions).toEqual([region]);
    expect(r.body.filters.types).toEqual([type]);
    expect(r.body.data.every((p: any) => p.regionId === region)).toBe(true);
    if (type === '공원·정원') {
      expect(r.body.count).toBeGreaterThan(0);
      expect(
        r.body.data.every((p: any) =>
          ['park', 'garden', 'nature_reserve'].includes(p.tags.leisure),
        ),
      ).toBe(true);
    }
    if (['양식', '일식'].includes(type)) {
      expect(r.body.data.every((p: any) => p.category === 'RESTAURANT' && p.tags.cuisine)).toBe(
        true,
      );
    }
  }
});
it('삿포로 음식점 결과에서 반복 체인명을 한 번만 반환한다', async () => {
  const r = await request(app)
    .get('/api/places')
    .query({ regionId: 'sapporo', category: 'RESTAURANT', limit: 100 });
  expect(r.status).toBe(200);
  for (const name of ['マクドナルド', 'かつや'])
    expect(r.body.data.filter((p: any) => p.nameJa === name).length).toBeLessThanOrEqual(1);
  const full = await request(app)
    .get('/api/places')
    .query({ regionId: 'sapporo', category: 'RESTAURANT', q: 'マクドナルド', limit: 100 });
  expect(full.body.count).toBe(1);
  expect(full.body.data).toHaveLength(1);
});
it('지역과 분류를 분리하고 명칭 검색어를 보존한다', () => {
  const r = parsePlaceSearch('삿포로 공원 오도리');
  expect(r.regionIds).toEqual(['sapporo']);
  expect(r.kinds.map((k) => k.id)).toEqual(['park']);
  expect(r.text).toBe('오도리');
});
it('입력한 지역이 드롭다운보다 우선하며 일식·양식·놀거리를 인식한다', () => {
  expect(parsePlaceSearch('오타루 일식', 'sapporo').regionIds).toEqual(['otaru']);
  expect(parsePlaceSearch('하코다테 양식').kinds[0]?.id).toBe('western');
  expect(parsePlaceSearch('후라노 놀거리').kinds[0]?.id).toBe('fun');
  expect(parsePlaceSearch('카페', 'sapporo').regionIds).toEqual(['sapporo']);
});
it('생활·문화·쇼핑과 음식 세부 의도를 구분한다', () => {
  for (const [query, id] of [
    ['삿포로 공방', 'workshop'],
    ['오타루 빈티지 옷가게', 'vintage-clothes'],
    ['하코다테 옷가게', 'clothes'],
    ['비에이 서점', 'bookstore'],
    ['삿포로 한식', 'korean'],
    ['오비히로 수프카레', 'curry'],
    ['하코다테 빵집', 'dessert'],
    ['니세코 캠핑장', 'camping'],
  ])
    expect(parsePlaceSearch(query).kinds.map((kind) => kind.id)).toContain(id);
});
it('확장된 실제 POI가 지역·의도 필터를 거쳐 반환된다', async () => {
  for (const [query, region, type] of [
    ['삿포로 공방', 'sapporo', '공방·체험'],
    ['오타루 빈티지', 'otaru', '빈티지·중고'],
    ['하코다테 옷가게', 'hakodate', '옷가게'],
    ['삿포로 서점', 'sapporo', '서점·음반'],
    ['삿포로 한식', 'sapporo', '한식'],
    ['니세코 캠핑장', 'niseko-kutchan', '캠핑'],
  ]) {
    const response = await request(app).get('/api/places').query({ q: query, limit: 5 });
    expect(response.status).toBe(200);
    expect(response.body.count).toBeGreaterThan(0);
    expect(response.body.filters).toMatchObject({ regions: [region], types: [type] });
    expect(response.body.data.every((place: any) => place.regionId === region)).toBe(true);
  }
});
it('지역 체인도 검색 결과에서 한 번만 노출한다', async () => {
  const response = await request(app)
    .get('/api/places')
    .query({ q: '오비히로 수프카레', limit: 100 });
  expect(response.status).toBe(200);
  expect(
    response.body.data.filter((place: any) => place.nameJa.startsWith('インデアン')),
  ).toHaveLength(1);
});
it('구체적인 검색에서는 같은 그룹의 포괄 분류를 제외한다', () => {
  expect(parsePlaceSearch('삿포로 한식 음식점').kinds.map((kind) => kind.id)).toEqual(['korean']);
  expect(parsePlaceSearch('오타루 옷가게 쇼핑').kinds.map((kind) => kind.id)).toEqual(['clothes']);
  expect(parsePlaceSearch('후라노 공방 체험').kinds.map((kind) => kind.id)).toEqual(['workshop']);
});
it('알 수 없는 키워드는 일반 장소명으로 유지한다', () => {
  expect(parsePlaceSearch('희귀한 장소').text).toBe('희귀한 장소');
  expect(parsePlaceSearch('희귀한 장소').kinds).toHaveLength(0);
});
