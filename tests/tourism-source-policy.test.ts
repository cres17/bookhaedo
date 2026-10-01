import { expect, it, vi } from 'vitest';
import { publishTourismBatch, sourceRegistry } from '../server/tourism-knowledge';
import { tourismBatch, tourismRecord } from './tourism-fixtures';
it('pins the approved Hokuto version and rejects old/other resource URLs before DB writes', async () => {
  const source = (await sourceRegistry()).find((s) => s.id === 'hokuto-places')!;
  expect(source).toMatchObject({
    publisher: '北斗市',
    regionId: 'hakodate',
    rightsStatus: 'approved',
    enabled: true,
    licenseId: 'CC-BY-4.0',
  });
  const db = { connect: vi.fn() };
  for (const url of [
    'https://www.harp.lg.jp/opendata/dataset/1657/resource/old/old.csv',
    'https://www.harp.lg.jp/opendata/dataset/1657/resource/9136/other.csv',
  ]) {
    const raw = tourismBatch(
      [tourismRecord({ regionId: 'hakodate', resourceUrl: url })],
      'hokuto-places',
      new Date().toISOString(),
    );
    await expect(publishTourismBatch(db as any, raw)).rejects.toThrow(
      'outside its registered source',
    );
  }
  expect(db.connect).not.toHaveBeenCalled();
});
