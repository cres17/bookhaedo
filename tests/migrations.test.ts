import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { pool, migrate, verifyMigrations } from '../server/db';
import { migrationFiles, runMigrations } from '../server/migrations';
const uid = randomUUID(),
  tid = randomUUID();
beforeAll(async () => {
  await migrate();
  await pool.query(
    "INSERT INTO planner.app_user(id,email,display_name,password_hash) VALUES($1,$2,'migration test','unused')",
    [uid, uid + '@example.test'],
  );
  await pool.query("INSERT INTO planner.trip(id,user_id,title) VALUES($1,$2,'migration test')", [
    tid,
    uid,
  ]);
});
afterAll(async () => {
  await pool.query('DELETE FROM planner.app_user WHERE id=$1', [uid]);
  await pool.end();
});
it('repeat and concurrent migrations preserve history and existing data', async () => {
  const before = await pool.query('SELECT * FROM planner.schema_migration ORDER BY name');
  await Promise.all([migrate(), migrate()]);
  await verifyMigrations();
  expect((await pool.query('SELECT * FROM planner.schema_migration ORDER BY name')).rows).toEqual(
    before.rows,
  );
  expect((await pool.query('SELECT id FROM planner.trip WHERE id=$1', [tid])).rowCount).toBe(1);
});
it('edited applied SQL fails closed without modifying history', async () => {
  const dir = await mkdtemp(tmpdir() + '/bookhaedo-migration-');
  try {
    for (const file of await migrationFiles())
      await writeFile(dir + '/' + file.name, file.sql + '\n-- changed');
    await expect(runMigrations(pool, pathToFileURL(dir + '/'))).rejects.toThrow(
      'checksum mismatch',
    );
    await verifyMigrations();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it('DB rejects unbalanced expense and accepts atomic share replacement', async () => {
  const db = await pool.connect(),
    eid = randomUUID();
  try {
    await db.query('BEGIN');
    await db.query(
      "INSERT INTO planner.expense(id,trip_id,label,amount,payer_id) VALUES($1,$2,'test',11,$3)",
      [eid, tid, uid],
    );
    await expect(db.query('COMMIT')).rejects.toMatchObject({ code: '23514' });
    await db.query('ROLLBACK');
    await db.query('BEGIN');
    await db.query(
      "INSERT INTO planner.expense(id,trip_id,label,amount,payer_id) VALUES($1,$2,'test',11,$3)",
      [eid, tid, uid],
    );
    await db.query('INSERT INTO planner.expense_share VALUES($1,$2,11)', [eid, uid]);
    await db.query('COMMIT');
    await db.query('BEGIN');
    await db.query('UPDATE planner.expense SET amount=12 WHERE id=$1', [eid]);
    await db.query('DELETE FROM planner.expense_share WHERE expense_id=$1', [eid]);
    await db.query('INSERT INTO planner.expense_share VALUES($1,$2,12)', [eid, uid]);
    await db.query('COMMIT');
  } finally {
    await db.query('ROLLBACK');
    db.release();
  }
});
it('pending migrations block startup and failed DDL rolls back without recording history', async () => {
  const dir = await mkdtemp(tmpdir() + '/bookhaedo-pending-');
  try {
    for (const file of await migrationFiles()) await writeFile(dir + '/' + file.name, file.sql);
    await writeFile(
      dir + '/' + String((await migrationFiles()).length + 1).padStart(3, '0') + '_failure.sql',
      'CREATE TABLE planner.migration_failure_probe(id integer); SELECT 1/0;',
    );
    await expect(runMigrations(pool, pathToFileURL(dir + '/'), true)).rejects.toThrow(
      'Pending database migration',
    );
    await expect(runMigrations(pool, pathToFileURL(dir + '/'))).rejects.toMatchObject({
      code: '22012',
    });
    expect(
      (await pool.query("SELECT to_regclass('planner.migration_failure_probe') AS relation"))
        .rows[0].relation,
    ).toBeNull();
    await verifyMigrations();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('backfills existing record withdrawals before the persistent-ID migration is activated', async () => {
  const name = 'bookhaedo_withdrawal_' + randomUUID().replaceAll('-', '');
  const dir = await mkdtemp(tmpdir() + '/bookhaedo-withdraw-migration-');
  let fresh: pg.Pool | undefined;
  let created = false;
  try {
    await pool.query(`CREATE DATABASE "${name}"`);
    created = true;
    const connection = new URL(pool.options.connectionString!);
    connection.pathname = '/' + name;
    fresh = new pg.Pool({ connectionString: connection.toString() });
    await fresh.query(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
    for (const file of (await migrationFiles()).filter((f) => f.name < '006_'))
      await writeFile(dir + '/' + file.name, file.sql);
    await runMigrations(fresh, pathToFileURL(dir + '/'));
    const id = randomUUID();
    await fresh.query(
      "INSERT INTO tourism_knowledge.source(id,publisher,source_url,license_id,license_url,rights_status,enabled) VALUES('legacy','test','https://example.test','test','https://example.test','approved',true)",
    );
    await fresh.query(
      "INSERT INTO tourism_knowledge.snapshot(id,source_id,content_sha256,parser_version,fetched_at,record_count) VALUES($1,'legacy',$2,'harp-csv-v1',now(),1)",
      [id, 'a'.repeat(64)],
    );
    await fresh.query(
      "INSERT INTO tourism_knowledge.record(snapshot_id,external_id,kind,region_id,title_ja,description_ja,resource_url,content_sha256,evidence_pointer,location_status,date_status,hours_status,withdrawn_at) VALUES($1,'old-withdrawal','place','furano','test','','https://example.test',$2,'test','missing','unknown','unknown',now())",
      [id, 'a'.repeat(64)],
    );
    await fresh.query(
      "UPDATE tourism_knowledge.source SET active_snapshot_id=$1 WHERE id='legacy'",
      [id],
    );
    await runMigrations(fresh);
    await runMigrations(fresh, undefined, true);
    expect(
      (
        await fresh.query(
          "SELECT external_id FROM tourism_knowledge.withdrawal WHERE source_id='legacy'",
        )
      ).rows,
    ).toEqual([{ external_id: 'old-withdrawal' }]);
    expect((await fresh.query('SELECT count(*)::int AS n FROM geo_data.place')).rows[0].n).toBe(0);
  } finally {
    await fresh?.end();
    if (created) await pool.query(`DROP DATABASE "${name}"`);
    await rm(dir, { recursive: true, force: true });
  }
});
