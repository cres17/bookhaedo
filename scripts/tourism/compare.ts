import { parseArgs } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { pool } from '../../server/db.js';
import { auditTourismData } from '../../server/tourism-quality.js';
import {
  buildTourismComparison,
  formatTourismComparison,
} from '../../server/tourism-comparison.js';
try {
  const { values } = parseArgs({
    options: {
      source: { type: 'string' },
      date: { type: 'string' },
      output: { type: 'string' },
      markdown: { type: 'string' },
    },
    allowPositionals: false,
  });
  const report = buildTourismComparison(await auditTourismData(pool, values.date), values.source);
  if (values.output) await writeFile(values.output, JSON.stringify(report, null, 2) + '\n');
  if (values.markdown) await writeFile(values.markdown, formatTourismComparison(report));
  console.log(
    JSON.stringify(
      {
        checkedAt: report.checkedAt,
        summary: report.summary,
        pendingDecisions: report.rows.length,
        approvedMappingsApplied: 0,
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
