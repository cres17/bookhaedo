import 'dotenv/config';
import { resolve } from 'node:path';
import { restoreDrill } from './database-tools.js';

const option = process.argv.indexOf('--archive');
if (option < 0 || !process.argv[option + 1])
  throw new Error('Usage: npm run db:restore:drill -- --archive /secure/path/bookhaedo.dump');
const databaseUrl =
  process.env.DATABASE_URL ||
  (process.env.NODE_ENV === 'production'
    ? ''
    : 'postgresql://kita_plan:kita_plan_local@127.0.0.1:5433/kita_plan');
if (!databaseUrl) throw new Error('DATABASE_URL is required in production');
const result = await restoreDrill(databaseUrl, resolve(process.argv[option + 1]!));
console.log(JSON.stringify({ event: 'RESTORE_DRILL_COMPLETE', ...result, databaseRemoved: true }));
