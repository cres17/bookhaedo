// AI claim under test: "deleting only the withdrawal row releases a withdrawn record".
import { it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { pool, migrate } from '../server/db';
import { publishTourismBatch } from '../server/tourism-knowledge';
import { searchTourism } from '../server/tourism-search';
import { withdrawTourismRecord } from '../server/tourism-withdrawal';
import { tourismBatch, tourismRecord } from './tourism-fixtures';
it('claim: removing only the withdrawal row releases the record', async () => {
  await migrate();
  const orig = (await pool.query("SELECT * FROM tourism_knowledge.source WHERE id='furano-places'")).rows[0];
  const placeId = randomUUID(), name = '主張検証施設' + placeId, ext = 'claim-' + randomUUID();
  await pool.query(
    `INSERT INTO geo_data.place(id,region_id,category,name_ja,normalized_name,latitude,longitude,location,region_distance_km)
     VALUES($1,'furano','ATTRACTION',$2,$2,43.34,142.39,ST_SetSRID(ST_MakePoint(142.39,43.34),4326)::geography,0)`, [placeId, name]);
  const visible = async () => (await searchTourism({ anchor: { latitude: 43.34, longitude: 142.39 }, regionId: 'furano', date: '2026-10-01', radius: 20000, interests: '' }))
    .evidence.some((e) => e.externalId === ext);
  const log: Record<string, unknown> = {};
  let snapshotId = '';
  try {
    const rec = tourismRecord({ externalId: ext, titleJa: name, latitude: 43.34, longitude: 142.39 });
    snapshotId = (await publishTourismBatch(pool, tourismBatch([rec], 'furano-places', new Date().toISOString()))).snapshotId;
    log['1 published → visible in search'] = await visible();
    await withdrawTourismRecord(pool, { sourceId: 'furano-places', externalId: ext });
    log['2 after withdraw tool → visible'] = await visible();
    await pool.query('DELETE FROM tourism_knowledge.withdrawal WHERE source_id=$1 AND external_id=$2', ['furano-places', ext]);
    log['3 AI claim: delete ONLY withdrawal row → visible (claim predicts true)'] = await visible();
    await pool.query('UPDATE tourism_knowledge.record SET withdrawn_at=NULL WHERE snapshot_id=$1 AND external_id=$2', [snapshotId, ext]);
    log['4 additionally clear record.withdrawn_at → visible'] = await visible();
    // control for the opposite direction: withdraw again, then clear only the record flag
    await withdrawTourismRecord(pool, { sourceId: 'furano-places', externalId: ext });
    await pool.query('UPDATE tourism_knowledge.record SET withdrawn_at=NULL WHERE snapshot_id=$1 AND external_id=$2', [snapshotId, ext]);
    log['5 control: clear ONLY record.withdrawn_at (withdrawal row kept) → visible'] = await visible();
  } finally {
    await pool.query('DELETE FROM tourism_knowledge.withdrawal WHERE source_id=$1 AND external_id=$2', ['furano-places', ext]);
    await pool.query('UPDATE tourism_knowledge.source SET active_snapshot_id=$2 WHERE id=$1', ['furano-places', orig?.active_snapshot_id ?? null]);
    if (snapshotId) await pool.query('DELETE FROM tourism_knowledge.snapshot WHERE id=$1', [snapshotId]);
    await pool.query('DELETE FROM geo_data.place WHERE id=$1', [placeId]);
    if (!orig) await pool.query("DELETE FROM tourism_knowledge.source WHERE id='furano-places'");
    await pool.end();
  }
  writeFileSync(process.env.PROBE_OUT!, JSON.stringify(log, null, 1));
});
