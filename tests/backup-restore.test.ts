import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { createBackup, restoreDrill } from '../scripts/database-tools';

// 서버와 같은 주 버전의 pg_dump/pg_restore가 필요하므로 RUN_BACKUP_RESTORE_TEST=1일 때만 실행한다.
// operations-drill 워크플로에서 PostgreSQL 17 클라이언트를 설치한 뒤 실행한다.
const enabled = process.env.RUN_BACKUP_RESTORE_TEST === '1';
const databaseUrl =
  process.env.DATABASE_URL || 'postgresql://kita_plan:kita_plan_local@127.0.0.1:5433/kita_plan';
const tag = randomUUID();
const users = [randomUUID(), randomUUID()];
const trip = randomUUID();
const day = randomUUID();
const place = `backup-test-${tag}`;
let pool: pg.Pool;
let dir = '';

describe.runIf(enabled)('백업·복원 훈련', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
    dir = await mkdtemp(join(process.env.BACKUP_TEST_DIR || tmpdir(), 'bookhaedo-backup-'));
    await pool.query(
      `INSERT INTO geo_data.place(id,region_id,category,name_ja,name_ko,normalized_name,latitude,longitude,location,region_distance_km,osm_tags)
     VALUES($1,'sapporo','ATTRACTION','백업 검사','백업 검사',$1,43.06,141.35,ST_SetSRID(ST_MakePoint(141.35,43.06),4326)::geography,0,'{"tourism":"museum"}')`,
      [place],
    );
    for (const id of users)
      await pool.query(
        `INSERT INTO planner.app_user(id,email,display_name,password_hash) VALUES($1,$2,'백업 검사','not-a-real-hash')`,
        [id, `backup-${id}@example.test`],
      );
    await pool.query(`INSERT INTO planner.trip(id,user_id,title) VALUES($1,$2,'백업 검사 여행')`, [
      trip,
      users[0],
    ]);
    await pool.query('INSERT INTO planner.trip_member(trip_id,user_id) VALUES($1,$2)', [
      trip,
      users[1],
    ]);
    await pool.query(
      `INSERT INTO planner.trip_day(id,trip_id,visit_date,revision) VALUES($1,$2,'2026-11-01',3)`,
      [day, trip],
    );
    await pool.query(
      `INSERT INTO planner.itinerary_item(id,day_id,place_id,position,note,start_minute,end_minute)
     VALUES($1,$2,$3,0,'남아야 하는 메모',600,660)`,
      [randomUUID(), day, place],
    );
  });

  afterAll(async () => {
    await pool.query('DELETE FROM planner.trip WHERE id=$1', [trip]);
    await pool.query('DELETE FROM planner.app_user WHERE id=ANY($1::uuid[])', [users]);
    await pool.query('DELETE FROM geo_data.place WHERE id=$1', [place]);
    await pool.end();
    await rm(dir, { recursive: true, force: true });
  });

  it('복원한 DB의 일정·동행자 내용이 백업 시점과 같은지 확인한다', async () => {
    const archive = join(dir, 'complete.dump');
    const metadata = await createBackup(databaseUrl, archive);
    expect(metadata.fingerprints?.['planner.itinerary_item']).toMatch(/^[0-9a-f]{32}$/);
    expect(metadata.fingerprints?.['planner.trip_member']).toMatch(/^[0-9a-f]{32}$/);
    const result = await restoreDrill(databaseUrl, archive);
    expect(result.contentVerified).toBe(true);
  });

  it('행 수 비교 대상이 아닌 테이블의 데이터가 백업에서 빠지면 복원 훈련이 실패한다', async () => {
    const complete = join(dir, 'complete.dump');
    const partial = join(dir, 'partial.dump');
    // 같은 DB에서 일정 항목 데이터만 빠진 덤프를 만들고, 메타데이터는 정상 백업의 것을 그대로 쓴다
    const url = new URL(databaseUrl);
    const dump = spawnSync(
      'pg_dump',
      [
        '--host',
        url.hostname,
        '--port',
        url.port || '5432',
        '--username',
        url.username,
        '--dbname',
        url.pathname.slice(1),
        '--format=custom',
        '--no-owner',
        '--no-acl',
        '--exclude-table-data=planner.itinerary_item',
        '--file',
        partial,
      ],
      { env: { ...process.env, PGPASSWORD: url.password }, encoding: 'utf8' },
    );
    expect(dump.status, dump.stderr).toBe(0);
    const metadata = JSON.parse(await readFile(`${complete}.json`, 'utf8'));
    const digest = createHash('sha256')
      .update(await readFile(partial))
      .digest('hex');
    await writeFile(`${partial}.json`, JSON.stringify({ ...metadata, checksum: digest }));
    await writeFile(`${partial}.sha256`, `${digest}  partial.dump\n`);

    await expect(restoreDrill(databaseUrl, partial)).rejects.toThrow(/planner\.itinerary_item/);
  });
});
