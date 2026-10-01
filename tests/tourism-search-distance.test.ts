import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pool, migrate } from '../server/db';
import { searchTourism } from '../server/tourism-search';
import { candidatesAround } from '../server/day-alternatives';
const ids = Array.from({ length: 601 }, () => randomUUID());
const anchor = { latitude: 45.95, longitude: 146.95 };
beforeAll(async () => {
  await migrate();
  await pool.query(
    `INSERT INTO geo_data.place(id,region_id,category,name_ja,name_ko,normalized_name,latitude,longitude,location,region_distance_km,website)
    SELECT id,'furano','ATTRACTION','距離QA'||id,CASE WHEN n=1 THEN NULL ELSE 'preferred' END,id,
    45.95+CASE WHEN n=1 THEN 0.001 ELSE 0.05+n*0.000001 END,146.95,
    ST_SetSRID(ST_MakePoint(146.95,45.95+CASE WHEN n=1 THEN 0.001 ELSE 0.05+n*0.000001 END),4326)::geography,
    0,CASE WHEN n=1 THEN NULL ELSE 'https://example.test' END FROM unnest($1::text[]) WITH ORDINALITY AS fixture(id,n)`,
    [ids],
  );
});
afterAll(async () => {
  await pool.query('DELETE FROM geo_data.place WHERE id=ANY($1::text[])', [ids]);
  await pool.end();
});
it('keeps the nearest tourism candidate when 600 farther places have richer metadata', async () => {
  const found = await searchTourism({
    anchor,
    regionId: 'furano',
    date: '2026-10-01',
    radius: 20000,
    interests: '',
  });
  expect(found.candidates).toHaveLength(600);
  expect(found.candidates[0].id).toBe(ids[0]);
  expect(found.candidates.some((p) => p.id === ids.at(-1))).toBe(false);
});
it('also keeps the nearest place in the original day-alternative search', async () => {
  const found = await candidatesAround(anchor);
  expect(found).toHaveLength(600);
  expect(found[0].id).toBe(ids[0]);
  expect(found.some((p) => p.id === ids.at(-1))).toBe(false);
});
