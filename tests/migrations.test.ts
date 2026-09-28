import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
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
      dir + '/005_failure.sql',
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
