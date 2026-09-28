import { migrate, pool } from '../server/db.js';
try {
  await migrate();
  console.log('Database migrations applied.');
} finally {
  await pool.end();
}
