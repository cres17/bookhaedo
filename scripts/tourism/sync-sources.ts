import { pool } from '../../server/db.js';
import { syncTourismSources } from '../../server/tourism-knowledge.js';
try {
  if (process.argv.length > 2) throw new Error('Usage: npm run tourism:sync-sources');
  console.log(JSON.stringify(await syncTourismSources(pool), null, 2));
} finally {
  await pool.end();
}
