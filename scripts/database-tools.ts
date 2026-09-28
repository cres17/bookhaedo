import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import pg from 'pg';

export type BackupMetadata = {
  format: 1;
  createdAt: string;
  checksum: string;
  counts: Record<string, number>;
  migrations: { name: string; checksum: string }[];
};

function connection(url: URL, database = url.pathname.slice(1)) {
  return {
    args: [
      '--host',
      url.hostname,
      '--port',
      url.port || '5432',
      '--username',
      url.username,
      '--dbname',
      database,
    ],
    env: { ...process.env, PGPASSWORD: url.password },
  };
}

async function run(program: string, args: string[], env: NodeJS.ProcessEnv) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(program, args, { env, stdio: ['ignore', 'ignore', 'pipe'] });
    let error = '';
    child.stderr.on('data', (chunk) => (error += String(chunk).slice(0, 4000)));
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${program} failed (${code}): ${error.trim()}`)),
    );
  });
}

const checksum = async (path: string) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex');

export async function createBackup(databaseUrl: string, output: string) {
  if (!output.endsWith('.dump')) throw new Error('Backup output must end in .dump');
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  const temporary = `${output}.${process.pid}.partial`;
  const url = new URL(databaseUrl);
  const source = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  try {
    const tables = ['geo_data.place', 'planner.app_user', 'planner.trip', 'planner.expense'];
    const counts: Record<string, number> = {};
    for (const table of tables)
      counts[table] = (
        await source.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${table}`)
      ).rows[0]!.count;
    const migrations = (
      await source.query<{ name: string; checksum: string }>(
        'SELECT name,checksum FROM planner.schema_migration ORDER BY name',
      )
    ).rows;
    const target = connection(url);
    await run(
      'pg_dump',
      [...target.args, '--format=custom', '--no-owner', '--no-acl', '--file', temporary],
      target.env,
    );
    const digest = await checksum(temporary);
    const metadata: BackupMetadata = {
      format: 1,
      createdAt: new Date().toISOString(),
      checksum: digest,
      counts,
      migrations,
    };
    await rename(temporary, output);
    await writeFile(`${output}.sha256`, `${digest}  ${output.split('/').at(-1)}\n`, {
      mode: 0o600,
    });
    await writeFile(`${output}.json`, JSON.stringify(metadata, null, 2) + '\n', { mode: 0o600 });
    return metadata;
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  } finally {
    await source.end();
  }
}

export async function restoreDrill(databaseUrl: string, archive: string) {
  const metadata = JSON.parse(await readFile(`${archive}.json`, 'utf8')) as BackupMetadata;
  const digest = await checksum(archive);
  const sidecar = (await readFile(`${archive}.sha256`, 'utf8')).trim().split(/\s+/)[0];
  if (digest !== metadata.checksum || digest !== sidecar)
    throw new Error('Backup checksum does not match metadata');
  const url = new URL(databaseUrl);
  const databaseName = `bookhaedo_restore_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  let restored: pg.Pool | undefined;
  let created = false;
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    const target = connection(url, databaseName);
    await run(
      'pg_restore',
      [
        ...target.args,
        '--exit-on-error',
        '--single-transaction',
        '--no-owner',
        '--no-acl',
        archive,
      ],
      target.env,
    );
    const restoredUrl = new URL(databaseUrl);
    restoredUrl.pathname = `/${databaseName}`;
    restored = new pg.Pool({ connectionString: restoredUrl.toString(), max: 2 });
    const counts: Record<string, number> = {};
    for (const table of Object.keys(metadata.counts))
      counts[table] = (
        await restored.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${table}`)
      ).rows[0]!.count;
    const migrations = (
      await restored.query<{ name: string; checksum: string }>(
        'SELECT name,checksum FROM planner.schema_migration ORDER BY name',
      )
    ).rows;
    if (JSON.stringify(counts) !== JSON.stringify(metadata.counts))
      throw new Error('Restored row counts do not match the backup metadata');
    if (JSON.stringify(migrations) !== JSON.stringify(metadata.migrations))
      throw new Error('Restored migration history does not match the backup metadata');
    await restored.query('SELECT 1 FROM planner.trip LIMIT 1');
    return { databaseName, counts, migrations: migrations.length, checksum: digest };
  } finally {
    await restored?.end();
    if (created) {
      await admin.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
        [databaseName],
      );
      await admin.query(`DROP DATABASE "${databaseName}"`);
    }
    await admin.end();
  }
}
