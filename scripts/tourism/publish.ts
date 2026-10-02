import { readFile, stat } from 'node:fs/promises';
import { pool } from '../../server/db.js';
import { publishTourismBatch } from '../../server/tourism-knowledge.js';
const file = process.argv[2];
const args = process.argv.slice(3);
if (args.length && (args.length !== 2 || args[0] !== '--reprocess-snapshot'))
  throw new Error('Usage: tourism:publish <file> [--reprocess-snapshot <active-snapshot-uuid>]');
const reprocessSnapshotId = args[1];
if (!file) throw new Error('Usage: npm run tourism:publish -- /absolute/path/curated.json');
try {
  const info = await stat(file);
  if (info.size > 20_000_000) throw new Error('Batch exceeds size limit');
  console.log(
    await publishTourismBatch(pool, JSON.parse(await readFile(file, 'utf8')), reprocessSnapshotId),
  );
} finally {
  await pool.end();
}
