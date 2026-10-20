import { beforeAll, beforeEach, afterEach, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pool, migrate } from '../server/db';
import { pruneTourismSnapshots } from '../server/tourism-maintenance';

const sourceIds = [randomUUID(), randomUUID()].map((id) => 'retention-' + id);
let ids: string[] = [];
let otherId: string;
beforeAll(async () => {
  await migrate();
  for (const id of sourceIds)
    await pool.query(
      `INSERT INTO tourism_knowledge.source
    (id,publisher,source_url,license_id,license_url,rights_status,enabled)
    VALUES($1,'retention fixture','https://example.test','CC-BY-4.0','https://example.test/license','approved',true)`,
      [id],
    );
});
async function snapshot(source: string, age: number) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO tourism_knowledge.snapshot
    (id,source_id,content_sha256,parser_version,fetched_at,published_at,record_count)
    VALUES($1,$2,$3,'harp-csv-v1',now()-interval '100 days',now()-($4*interval '1 day'),1)`,
    [id, source, 'a'.repeat(64), age],
  );
  await pool.query(
    `INSERT INTO tourism_knowledge.record
    (snapshot_id,external_id,kind,region_id,title_ja,description_ja,resource_url,content_sha256,
     evidence_pointer,location_status,date_status,hours_status)
    VALUES($1,'fixture','event','furano','retention fixture','','https://example.test',$2,
     'fixture','missing','unknown','unknown')`,
    [id, 'a'.repeat(64)],
  );
  return id;
}
beforeEach(async () => {
  ids = [];
  for (const age of [100, 0, 15, 40, 50, 60]) ids.push(await snapshot(sourceIds[0], age));
  otherId = await snapshot(sourceIds[1], 80);
  await pool.query('UPDATE tourism_knowledge.source SET active_snapshot_id=$2 WHERE id=$1', [
    sourceIds[0],
    ids[0],
  ]);
});
afterEach(async () => {
  await pool.query(
    'UPDATE tourism_knowledge.source SET active_snapshot_id=NULL WHERE id=ANY($1::text[])',
    [sourceIds],
  );
  await pool.query('DELETE FROM tourism_knowledge.snapshot WHERE source_id=ANY($1::text[])', [
    sourceIds,
  ]);
});
afterAll(async () => {
  await pool.query('DELETE FROM tourism_knowledge.source WHERE id=ANY($1::text[])', [sourceIds]);
  await pool.end();
});
it('previews only old inactive snapshots beyond the latest three and changes no records', async () => {
  const result = await pruneTourismSnapshots(pool, { sourceId: sourceIds[0] });
  expect(result).toMatchObject({
    dryRun: true,
    snapshotCount: 2,
    recordCount: 2,
    policy: { days: 30, keepLatest: 3 },
  });
  expect(new Set(result.candidates.map((r) => r.snapshotId))).toEqual(new Set(ids.slice(4)));
  expect(
    (
      await pool.query(
        'SELECT count(*)::int AS n FROM tourism_knowledge.snapshot WHERE source_id=$1',
        [sourceIds[0]],
      )
    ).rows[0].n,
  ).toBe(6);
  expect(
    (
      await pool.query(
        'SELECT count(*)::int AS n FROM tourism_knowledge.record WHERE snapshot_id=ANY($1::uuid[])',
        [ids],
      )
    ).rows[0].n,
  ).toBe(6);
});
it('applies retention only to its source, cascades retired records and always preserves the old active snapshot', async () => {
  const result = await pruneTourismSnapshots(pool, { sourceId: sourceIds[0], apply: true });
  expect(result).toMatchObject({ dryRun: false, snapshotCount: 2, recordCount: 2 });
  expect(
    new Set(
      (
        await pool.query('SELECT id FROM tourism_knowledge.snapshot WHERE source_id=$1', [
          sourceIds[0],
        ])
      ).rows.map((r) => r.id),
    ),
  ).toEqual(new Set(ids.slice(0, 4)));
  expect(
    (
      await pool.query(
        'SELECT count(*)::int AS n FROM tourism_knowledge.record WHERE snapshot_id=ANY($1::uuid[])',
        [ids.slice(4)],
      )
    ).rows[0].n,
  ).toBe(0);
  expect(
    (await pool.query('SELECT id FROM tourism_knowledge.snapshot WHERE id=$1', [otherId])).rowCount,
  ).toBe(1);
  expect(
    (
      await pool.query('SELECT active_snapshot_id FROM tourism_knowledge.source WHERE id=$1', [
        sourceIds[0],
      ])
    ).rows[0].active_snapshot_id,
  ).toBe(ids[0]);
});
it('preserves recently published snapshots even when their fetch timestamps are old', async () => {
  await pool.query(
    "UPDATE tourism_knowledge.snapshot SET published_at=now()-interval '1 day' WHERE source_id=$1",
    [sourceIds[0]],
  );
  expect(
    (await pruneTourismSnapshots(pool, { sourceId: sourceIds[0], apply: true })).snapshotCount,
  ).toBe(0);
  expect(
    (
      await pool.query(
        'SELECT count(*)::int AS n FROM tourism_knowledge.snapshot WHERE source_id=$1',
        [sourceIds[0]],
      )
    ).rows[0].n,
  ).toBe(6);
});
it('rejects unsafe policy values and unknown sources without changing snapshots', async () => {
  for (const options of [
    { days: 0 },
    { keepLatest: 0 },
    { apply: 'true' },
    { days: 100000 },
    { extra: true },
    { sourceId: 'unknown-source' },
  ])
    await expect(pruneTourismSnapshots(pool, options)).rejects.toThrow();
  expect(
    (
      await pool.query(
        'SELECT count(*)::int AS n FROM tourism_knowledge.snapshot WHERE source_id=$1',
        [sourceIds[0]],
      )
    ).rows[0].n,
  ).toBe(6);
});
