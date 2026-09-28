import 'dotenv/config';
import { resolve } from 'node:path';
import { createBackup } from './database-tools.js';

const option = process.argv.indexOf('--output');
if (option < 0 || !process.argv[option + 1])
  throw new Error('Usage: npm run db:backup -- --output /secure/path/bookhaedo.dump');
const databaseUrl =
  process.env.DATABASE_URL ||
  (process.env.NODE_ENV === 'production'
    ? ''
    : 'postgresql://kita_plan:kita_plan_local@127.0.0.1:5433/kita_plan');
if (!databaseUrl) throw new Error('DATABASE_URL is required in production');
const output = resolve(process.argv[option + 1]!);
const result = await createBackup(databaseUrl, output);
console.log(
  JSON.stringify({
    event: 'BACKUP_COMPLETE',
    output,
    checksum: result.checksum,
    tables: result.counts,
  }),
);
