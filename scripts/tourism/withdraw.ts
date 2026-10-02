import { pool } from '../../server/db.js';
import { withdrawTourismRecord } from '../../server/tourism-withdrawal.js';
try {
  if (process.argv.length !== 4)
    throw new Error('Usage: tourism:withdraw <source-id> <external-id>');
  console.log(
    await withdrawTourismRecord(pool, { sourceId: process.argv[2], externalId: process.argv[3] }),
  );
} finally {
  await pool.end();
}
