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
  // 테이블별 전체 행 내용의 md5. 이 필드가 없는 이전 백업은 행 수만 비교한다
  fingerprints?: Record<string, string>;
};

// 행 수만으로는 내용 손실·변경을 알 수 없으므로, 사용자가 만든 여행 데이터는 내용 지문까지 비교한다.
// 대용량 카탈로그(geo_data.place)는 행 수만 비교한다.
const FINGERPRINT_TABLES = [
  'planner.app_user',
  'planner.trip',
  'planner.trip_member',
  'planner.trip_invitation',
  'planner.trip_day',
  'planner.itinerary_item',
  'planner.expense',
  'planner.expense_share',
  'planner.trip_message',
  'planner.checklist_item',
];

async function fingerprints(client: pg.Pool | pg.PoolClient) {
  const result: Record<string, string> = {};
  for (const table of FINGERPRINT_TABLES)
    result[table] = (
      await client.query<{ fingerprint: string }>(
        `SELECT md5(coalesce(string_agg(t::text, E'\\n' ORDER BY t::text), '')) AS fingerprint FROM ${table} t`,
      )
    ).rows[0]!.fingerprint;
  return result;
}

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
  const client = await source.connect();
  try {
    // 메타데이터와 pg_dump가 같은 시점을 보도록 스냅샷을 내보내고 그 스냅샷으로 덤프한다.
    // 그렇지 않으면 백업 도중 들어온 쓰기 때문에 정상 백업도 복원 검증에서 불일치가 난다
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshot = (await client.query<{ id: string }>('SELECT pg_export_snapshot() AS id'))
      .rows[0]!.id;
    const tables = ['geo_data.place', 'planner.app_user', 'planner.trip', 'planner.expense'];
    const counts: Record<string, number> = {};
    for (const table of tables)
      counts[table] = (
        await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${table}`)
      ).rows[0]!.count;
    const migrations = (
      await client.query<{ name: string; checksum: string }>(
        'SELECT name,checksum FROM planner.schema_migration ORDER BY name',
      )
    ).rows;
    const contents = await fingerprints(client);
    const target = connection(url);
    await run(
      'pg_dump',
      [
        ...target.args,
        '--format=custom',
        '--no-owner',
        '--no-acl',
        `--snapshot=${snapshot}`,
        '--file',
        temporary,
      ],
      target.env,
    );
    await client.query('COMMIT');
    const digest = await checksum(temporary);
    const metadata: BackupMetadata = {
      format: 1,
      createdAt: new Date().toISOString(),
      checksum: digest,
      counts,
      migrations,
      fingerprints: contents,
    };
    await rename(temporary, output);
    await writeFile(`${output}.sha256`, `${digest}  ${output.split('/').at(-1)}\n`, {
      mode: 0o600,
    });
    await writeFile(`${output}.json`, JSON.stringify(metadata, null, 2) + '\n', { mode: 0o600 });
    return metadata;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    await rm(temporary, { force: true });
    throw error;
  } finally {
    client.release();
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
    if (metadata.fingerprints) {
      const restoredContents = await fingerprints(restored);
      const changed = Object.keys(metadata.fingerprints).filter(
        (table) => restoredContents[table] !== metadata.fingerprints![table],
      );
      if (changed.length)
        throw new Error(
          `Restored contents do not match the backup metadata: ${changed.join(', ')}`,
        );
    }
    await restored.query('SELECT 1 FROM planner.trip LIMIT 1');
    return {
      databaseName,
      counts,
      migrations: migrations.length,
      checksum: digest,
      contentVerified: Boolean(metadata.fingerprints),
    };
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
