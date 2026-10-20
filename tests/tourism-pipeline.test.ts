import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { pool, migrate } from '../server/db';
import { publishTourismBatch } from '../server/tourism-knowledge';
import { searchTourism } from '../server/tourism-search';
let original: any;
const placeId = randomUUID();
let snapshotId: string | undefined;
let folder: string;
beforeAll(async () => {
  await migrate();
  original = (await pool.query("SELECT * FROM tourism_knowledge.source WHERE id='sapporo-places'"))
    .rows[0];
  folder = await mkdtemp(tmpdir() + '/bookhaedo-pipeline-');
  await pool.query(
    `INSERT INTO geo_data.place(id,region_id,category,name_ja,normalized_name,latitude,longitude,location,region_distance_km)
    VALUES($1,'sapporo','ATTRACTION',$2,$2,43.06,141.35,ST_SetSRID(ST_MakePoint(141.35,43.06),4326)::geography,0)`,
    [placeId, 'pipeline-' + placeId],
  );
});
afterAll(async () => {
  if (original)
    await pool.query(
      'UPDATE tourism_knowledge.source SET active_snapshot_id=$1,enabled=$2,rights_status=$3,publisher=$4,source_url=$5,license_id=$6,license_url=$7 WHERE id=$8',
      [
        original.active_snapshot_id,
        original.enabled,
        original.rights_status,
        original.publisher,
        original.source_url,
        original.license_id,
        original.license_url,
        original.id,
      ],
    );
  else
    await pool.query(
      "UPDATE tourism_knowledge.source SET active_snapshot_id=NULL WHERE id='sapporo-places'",
    );
  if (snapshotId)
    await pool.query('DELETE FROM tourism_knowledge.snapshot WHERE id=$1', [snapshotId]);
  if (!original) await pool.query("DELETE FROM tourism_knowledge.source WHERE id='sapporo-places'");
  await pool.query('DELETE FROM geo_data.place WHERE id=$1', [placeId]);
  if (folder) await rm(folder, { recursive: true, force: true });
  await pool.end();
});
it('collects a 103-row Sapporo fixture, normalizes it, publishes it and retrieves linked attribution', async () => {
  const python = String.raw`
import csv,io,json,sys
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path.cwd()/'scripts/tourism'))
import collector
from normalize import normalize_report
source=collector.REGISTERED['sapporo-places']
text=io.StringIO(); fields=['NO','名称','説明','緯度（10進法）','経度（10進法）','利用可能時間特記事項','URL（公式）','連絡先電話番号','画像','料金']
writer=csv.DictWriter(text,fieldnames=fields);writer.writeheader()
for n in range(103):
 writer.writerow(dict(zip(fields,[f'{n+1:010d}','pipeline-'+sys.argv[2] if n==0 else 'synthetic-'+sys.argv[2]+'-'+str(n),'omit-description',43.06,141.35,'omit-hours','https://example.test','omit-contact','omit-photo','omit-price'])))
body=text.getvalue().encode('utf-8-sig')
class Response(io.BytesIO):
 status=200
 headers={}
class Opener:
 def open(self,request,timeout):
  url=request.full_url
  if url.endswith('/robots.txt'): return Response(b'User-agent: *\nAllow: /\n')
  if url==source['sourceUrl']: return Response(('<a href="'+source['resourceUrl']+'">CSV</a>').encode())
  if url==source['resourceUrl']: return Response(body)
  raise AssertionError('Unexpected URL: '+url)
c=collector.Collector(sys.argv[1],source['sourceUrl'],resource_url=source['resourceUrl'])
try:
 c.gate=lambda: 100.0
 with patch.object(collector.urllib.request,'build_opener',return_value=Opener()):
  c.robots(); report=c.run(source['id'])
 assert not report['errors'],report
 assert report['resources'][0]['rows']==103
 print(json.dumps(normalize_report(sys.argv[1],source['id'])))
finally:c.db.close()
`;
  const raw = JSON.parse(
    execFileSync('python3', ['-B', '-c', python, folder, placeId], {
      encoding: 'utf8',
      maxBuffer: 2_000_000,
    }),
  );
  expect(raw).toMatchObject({ sourceId: 'sapporo-places', parserVersion: 'sapporo-csv-v1' });
  expect(raw.records).toHaveLength(103);
  expect(raw.records[0].externalId).toBe('0000000001');
  expect(
    raw.records.every(
      (r: any) =>
        r.descriptionJa === '' &&
        r.scheduleRaw === '' &&
        r.hoursStatus === 'unknown' &&
        r.sourceUpdatedAt === null,
    ),
  ).toBe(true);
  for (const omitted of [
    'omit-description',
    'omit-contact',
    'omit-photo',
    'omit-price',
    'omit-hours',
  ])
    expect(JSON.stringify(raw)).not.toContain(omitted);
  const published = await publishTourismBatch(pool, raw);
  snapshotId = published.snapshotId;
  expect(published.records).toBe(103);
  const result = await searchTourism({
    anchor: { latitude: 43.06, longitude: 141.35 },
    regionId: 'sapporo',
    date: '2026-11-01',
    radius: 20000,
    interests: '',
  });
  expect(result.evidence.find((e) => e.sourceId === 'sapporo-places')).toMatchObject({
    placeId,
    externalId: '0000000001',
    snapshotId,
    licenseId: 'CC-BY-4.0',
    publisher: '札幌市',
  });
  expect(result.evidence.filter((e) => e.sourceId === 'sapporo-places')).toHaveLength(1);
});
