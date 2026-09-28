// Creates and removes only a uniquely named disposable database; never changes the catalog DB.
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pool } from '../server/db.js';
import { runMigrations } from '../server/migrations.js';
const name = 'bookhaedo_verify_' + randomUUID().replaceAll('-', '');
let created = false;
let fresh: pg.Pool | undefined;
try {
  await pool.query(`CREATE DATABASE "${name}"`);
  created = true;
  const connection = new URL(pool.options.connectionString!);
  connection.pathname = '/' + name;
  fresh = new pg.Pool({ connectionString: connection.toString() });
  await fresh.query(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  await runMigrations(fresh);
  await runMigrations(fresh);
  await runMigrations(fresh, undefined, true);
  const result = await fresh.query('SELECT count(*)::int AS count FROM geo_data.place');
  if (result.rows[0].count !== 0) throw new Error('Unexpected catalog data');
  console.log('Fresh database: migration, repeat, verification passed; catalog remains empty.');
} finally {
  await fresh?.end();
  if (created) await pool.query(`DROP DATABASE "${name}"`);
  await pool.end();
}
