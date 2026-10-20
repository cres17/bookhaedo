import { parseArgs } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { pool } from '../../server/db.js';
import { auditTourismData } from '../../server/tourism-quality.js';
try {
  const { values } = parseArgs({
    options: { output: { type: 'string' }, date: { type: 'string' } },
    allowPositionals: false,
  });
  const report = await auditTourismData(pool, values.date);
  if (values.output) await writeFile(values.output, JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify(
      {
        counts: report.counts,
        profile: report.profile,
        aliasReviews: report.diagnostics.flatMap((r) => (r.aliasReview ? [r.aliasReview] : [])),
        unlinkedReasons: report.diagnostics.reduce<Record<string, number>>((counts, r) => {
          counts[r.reason] = (counts[r.reason] ?? 0) + 1;
          return counts;
        }, {}),
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
