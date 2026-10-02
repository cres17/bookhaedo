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

it('rejects other CKAN resources, hosts and parser profiles before DB writes', async () => {
  const source = (await sourceRegistry()).find((s) => s.id === 'sapporo-places')!;
  expect(source).toMatchObject({
    publisher: '札幌市',
    regionId: 'sapporo',
    licenseId: 'CC-BY-4.0',
    parserVersion: 'sapporo-csv-v1',
  });
  const db = { connect: vi.fn() };
  const record = tourismRecord({ regionId: 'sapporo', resourceUrl: source.resourceUrl });
  const raw = { ...tourismBatch([record], 'sapporo-places'), parserVersion: 'sapporo-csv-v1' };
  for (const resourceUrl of [
    source.resourceUrl!.replace('011002_tourism.csv', 'other.csv'),
    source.resourceUrl!.replace('ckan.pf-sapporo.jp', 'example.test'),
    source.resourceUrl! + '?token=x',
    source.resourceUrl! + '#changed',
  ]) {
    await expect(
      publishTourismBatch(db as any, { ...raw, records: [{ ...record, resourceUrl }] }),
    ).rejects.toThrow();
  }
  await expect(
    publishTourismBatch(db as any, { ...raw, parserVersion: 'harp-csv-v1' }),
  ).rejects.toThrow('Parser version');
  await expect(
    publishTourismBatch(db as any, { ...raw, records: [{ ...record, regionId: 'furano' }] }),
  ).rejects.toThrow('outside its registered source');
  expect(db.connect).not.toHaveBeenCalled();
});

it('shares the reviewed source policy between Python and TypeScript, independently of registry approval flags', async () => {
  const { execFileSync } = await import('node:child_process');
  const { approvedSourcePolicy, resourceBelongsToSource } =
    await import('../server/tourism-source-policy');
  const source = (await sourceRegistry()).find((s) => s.id === 'sapporo-places')!;
  const harp = (await sourceRegistry()).find((s) => s.id === 'hokuto-places')!;
  const cases = [
    { source, url: source.resourceUrl! },
    {
      source: { ...source, id: 'new-ckan-source', enabled: true, rightsStatus: 'approved' },
      url: source.resourceUrl!,
    },
    { source: { ...source, sourceUrl: source.sourceUrl + '/other' }, url: source.resourceUrl! },
    {
      source: {
        ...source,
        resourceUrl: source.resourceUrl!.replace('011002_tourism.csv', 'other.csv'),
      },
      url: source.resourceUrl!.replace('011002_tourism.csv', 'other.csv'),
    },
    { source: { ...source, parserVersion: 'harp-csv-v1' }, url: source.resourceUrl! },
    { source: harp, url: harp.resourceUrl! },
    { source: harp, url: harp.resourceUrl!.replace('/1657/', '/1823/') },
    { source: harp, url: harp.resourceUrl!.replace('/1657/resource/', '/1657/../1823/resource/') },
    {
      source: harp,
      url: harp.resourceUrl!.replace('/1657/resource/', '/1657/%2e%2e/1823/resource/'),
    },
    { source: harp, url: harp.resourceUrl! + '#' },
    { source: harp, url: ' ' + harp.resourceUrl! },
    { source: harp, url: harp.resourceUrl!.replace('https://', 'HTTPS://') },
    ...['?x=1', '#changed'].map((suffix) => ({ source, url: source.resourceUrl! + suffix })),
    {
      source,
      url: source.resourceUrl!.replace('ckan.pf-sapporo.jp', 'ckan.pf-sapporo.jp.example.test'),
    },
    { source, url: source.resourceUrl!.replace('https://', 'https://user:password@') },
  ];
  const typescript = cases.map((c) => ({
    approved: !!approvedSourcePolicy(c.source),
    resource: resourceBelongsToSource(c.source, c.url),
  }));
  const python = JSON.parse(
    execFileSync(
      'python3',
      [
        '-B',
        '-c',
        "import sys,json;sys.path.insert(0,'scripts/tourism');from source_policy import approved_source_policy,resource_belongs_to_source;cases=json.loads(sys.stdin.read());print(json.dumps([{'approved':bool(approved_source_policy(c['source'])),'resource':resource_belongs_to_source(c['source'],c['url'])} for c in cases]))",
      ],
      { input: JSON.stringify(cases), encoding: 'utf8' },
    ),
  );
  expect(python).toEqual(typescript);
  expect(typescript[0]).toEqual({ approved: true, resource: true });
  expect(typescript.slice(1, 5).every((c) => !c.approved && !c.resource)).toBe(true);
  expect(typescript[5]).toEqual({ approved: true, resource: true });
  expect(typescript.slice(6).every((c) => !c.resource)).toBe(true);
});
