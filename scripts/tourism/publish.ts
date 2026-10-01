import { readFile } from 'node:fs/promises';
import { pool } from '../../server/db.js';
import { publishTourismBatch } from '../../server/tourism-knowledge.js';
const file = process.argv[2];
if (!file) throw new Error('Usage: npm run tourism:publish -- /absolute/path/curated.json');
try {
  const stat = await import('node:fs/promises').then((fs) => fs.stat(file));
  if (stat.size > 20_000_000) throw new Error('Batch exceeds size limit');
  console.log(await publishTourismBatch(pool, JSON.parse(await readFile(file, 'utf8'))));
} finally { await pool.end(); }
