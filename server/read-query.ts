import pg, { type Pool, type QueryResultRow } from 'pg';
import { pool } from './db.js';
import { abortable, operationBudget, operationError } from './operation-budget.js';
import { BoundedConcurrencyGate } from './concurrency-gate.js';
import { rollback, release } from './transactions.js';
import { logger } from './observability/logger.js';
// Reserve cancellation transports outside the saturated application pool; both concurrency and queue are bounded.
const cancellationGate = new BoundedConcurrencyGate(2, 32, 'READ_QUERY_CANCEL_QUEUE_FULL');
async function cancelQuery(database: Pool, pid: number) {
  const budget = operationBudget(1000);
  try {
    await cancellationGate.run(async () => {
      const connection = new pg.Client({
        ...database.options,
        connectionTimeoutMillis: 500,
        statement_timeout: 500,
        query_timeout: 500,
      });
      try {
        await connection.connect();
        if (budget.signal.aborted) return;
        await connection.query('SELECT pg_cancel_backend($1)', [pid]);
      } finally {
        await connection.end();
      }
    }, budget.signal);
  } finally {
    budget.dispose();
  }
}
export async function readQuery<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  values: unknown[] = [],
  signal?: AbortSignal,
  database: Pool = pool,
) {
  if (!signal) {
    const budget = operationBudget();
    try {
      return await readQuery<T>(sql, values, budget.signal, database);
    } finally {
      budget.dispose();
    }
  }
  if (signal.aborted) throw operationError(signal);
  const waiting = database.connect();
  let db;
  try {
    db = await abortable(() => waiting, signal);
  } catch (error) {
    void waiting.then((client) => client.release()).catch(() => {});
    throw error;
  }
  let pid: number | undefined,
    running = false,
    cancelling: Promise<void> | undefined;
  const cancel = () => {
    if (running && pid !== undefined)
      cancelling = cancelQuery(database, pid).catch(() => {
        logger.warn('READ_QUERY_CANCEL_FAILED');
      });
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    if (signal.aborted) throw operationError(signal);
    await db.query('BEGIN READ ONLY');
    const configuration = await db.query(
      "SELECT pg_backend_pid() AS pid,set_config('statement_timeout','3000',true)",
    );
    pid = configuration.rows[0].pid;
    if (signal.aborted) throw operationError(signal);
    running = true;
    const result = await db.query<T>(sql, values);
    running = false;
    // Hold the target connection until a queued cancellation has finished; it must never cancel another borrower's query.
    await cancelling;
    if (signal.aborted) throw operationError(signal);
    await db.query('COMMIT');
    if (signal.aborted) throw operationError(signal);
    return result;
  } catch (error) {
    running = false;
    await cancelling;
    await rollback(db);
    if (signal.aborted) throw operationError(signal);
    throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
    if (signal.aborted) db.release(true);
    else release(db);
  }
}
