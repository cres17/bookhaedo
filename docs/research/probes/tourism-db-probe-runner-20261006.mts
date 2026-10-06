// Run from the checkout root. Creates and drops only its own unique review database.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = resolve(process.argv[2] ?? process.cwd());
const imp = (relative: string) => import(pathToFileURL(`${root}/${relative}`).href);
const { pool } = await imp('server/db.ts');
const { runMigrations } = await imp('server/migrations.ts');
const { default: pg } = await imp('node_modules/pg/lib/index.js');
const name = 'bookhaedo_review_' + randomUUID().replaceAll('-', '');
let created = false;
let database: InstanceType<typeof pg.Pool> | undefined;

try {
  await pool.query(`CREATE DATABASE "${name}"`);
  created = true;
  const connection = new URL(pool.options.connectionString);
  connection.pathname = '/' + name;
  database = new pg.Pool({ connectionString: connection.toString() });
  await database.query(await readFile(`${root}/db/schema.sql`, 'utf8'));
  await runMigrations(database);
  const exitCode = await new Promise<number | null>((done, fail) => {
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        fileURLToPath(new URL('./tourism-db-boundaries-20261006.mts', import.meta.url)),
        root,
      ],
      {
        cwd: root,
        env: { ...process.env, DATABASE_URL: connection.toString(), NODE_ENV: 'test' },
        stdio: 'inherit',
        timeout: 60000,
      },
    );
    child.once('error', fail);
    child.once('close', done);
  });
  if (exitCode !== 0) throw Error(`Review DB probe did not complete successfully (${exitCode})`);
} finally {
  await database?.end();
  if (created) await pool.query(`DROP DATABASE "${name}"`);
  await pool.end();
}
