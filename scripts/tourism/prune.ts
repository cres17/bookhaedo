import { parseArgs } from 'node:util';
import { pool } from '../../server/db.js';
import { pruneTourismSnapshots } from '../../server/tourism-maintenance.js';
try {
  const { values } = parseArgs({
    options: {
      days: { type: 'string' },
      'keep-latest': { type: 'string' },
      source: { type: 'string' },
      apply: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });
  const result = await pruneTourismSnapshots(pool, {
    ...(values.days === undefined ? {} : { days: Number(values.days) }),
    ...(values['keep-latest'] === undefined ? {} : { keepLatest: Number(values['keep-latest']) }),
    ...(values.source === undefined ? {} : { sourceId: values.source }),
    apply: values.apply,
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await pool.end();
}
