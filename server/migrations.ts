import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import type { Pool } from 'pg';
export async function migrationFiles(directory = new URL('../db/migrations/', import.meta.url)) {
  const names = (await readdir(directory))
    .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  if (!names.length || new Set(names.map((name) => name.slice(0, 3))).size !== names.length)
    throw new Error('Invalid migration versions');
  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(new URL(name, directory), 'utf8');
      return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    }),
  );
}
export async function runMigrations(pool: Pool, directory?: URL, verifyOnly = false) {
  const files = await migrationFiles(directory);
  const db = await pool.connect();
  let broken = false;
  try {
    await db.query('BEGIN');
    if (!verifyOnly) {
      await db.query("SELECT pg_advisory_xact_lock(hashtext('bookhaedo-schema'))");
      await db.query('CREATE SCHEMA IF NOT EXISTS planner');
      await db.query(
        'CREATE TABLE IF NOT EXISTS planner.schema_migration (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
      );
    }
    const applied = await db.query<{ name: string; checksum: string }>(
      'SELECT name,checksum FROM planner.schema_migration ORDER BY name',
    );
    for (const [index, row] of applied.rows.entries()) {
      if (files[index]?.name !== row.name || files[index]?.checksum !== row.checksum)
        throw new Error(
          'Migration history/checksum mismatch; restore the released migration files',
        );
    }
    for (const file of files.slice(applied.rows.length)) {
      if (verifyOnly)
        throw new Error('Pending database migration; run npm run db:migrate before starting');
      await db.query(file.sql);
      await db.query('INSERT INTO planner.schema_migration(name,checksum) VALUES($1,$2)', [
        file.name,
        file.checksum,
      ]);
    }
    await db.query('COMMIT');
  } catch (error) {
    try {
      await db.query('ROLLBACK');
    } catch {
      broken = true;
    }
    throw error;
  } finally {
    db.release(broken);
  }
}
