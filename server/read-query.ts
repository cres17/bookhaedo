import pg, { type Pool, type QueryResultRow } from 'pg';
import { Socket } from 'node:net';
import { pool } from './db.js';
import { abortable, OperationError, operationBudget, operationError } from './operation-budget.js';
import { BoundedConcurrencyGate } from './concurrency-gate.js';
import { rollback, release } from './transactions.js';
import { logger } from './observability/logger.js';
// Reserve cancellation transports outside the saturated application pool; both concurrency and queue are bounded.
const cancellationGate = new BoundedConcurrencyGate(2, 32, 'READ_QUERY_CANCEL_QUEUE_FULL');
async function cancelQuery(database: Pool, pid: number) {
  const budget = operationBudget(1000);
  try {
    await cancellationGate.run(async () => {
      // Own the public transport so the budget also bounds the driver's connect/query/end acknowledgements.
      const socket = new Socket();
      const destroy = () => socket.destroy();
      budget.signal.addEventListener('abort', destroy, { once: true });
      const connection = new pg.Client({
        ...database.options,
        stream: () => socket,
        pipeline: false,
        connectionTimeoutMillis: 500,
        statement_timeout: 500,
        query_timeout: 500,
      });
      try {
        await connection.connect();
        if (budget.signal.aborted) return;
        await connection.query('SELECT pg_cancel_backend($1)', [pid]);
      } finally {
        try {
          await connection.end();
        } finally {
          budget.signal.removeEventListener('abort', destroy);
          socket.destroy();
        }
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
  // Bound protocol acknowledgements as well as server execution. A server-side timeout alone cannot release a partitioned socket.
  const queryBudget = operationBudget(3500, signal);
  const query = <Row extends QueryResultRow = QueryResultRow>(text: string, args: unknown[] = []) =>
    abortable(() => db.query<Row>(text, args), queryBudget.signal);
  let pid: number | undefined,
    running = false,
    cancelling: Promise<void> | undefined;
  const cancel = () => {
    if (running && pid !== undefined)
      cancelling = cancelQuery(database, pid).catch(() => {
        logger.warn('READ_QUERY_CANCEL_FAILED');
      });
  };
  queryBudget.signal.addEventListener('abort', cancel, { once: true });
  try {
    await query('BEGIN READ ONLY');
    const configuration = await query(
      "SELECT pg_backend_pid() AS pid,set_config('statement_timeout','3000',true)",
    );
    pid = configuration.rows[0].pid;
    if (queryBudget.signal.aborted) throw operationError(queryBudget.signal);
    running = true;
    const result = await query<T>(sql, values);
    running = false;
    // Hold the target slot until any cancellation transport is done; a late cancellation must never affect another borrower.
    await cancelling;
    await query('COMMIT');
    if (queryBudget.signal.aborted) throw operationError(queryBudget.signal);
    return result;
  } catch (error) {
    running = false;
    await cancelling;
    if (!queryBudget.signal.aborted)
      await abortable(() => rollback(db), queryBudget.signal).catch(() => undefined);
    if (signal.aborted) throw operationError(signal);
    if (queryBudget.signal.aborted) throw new OperationError('READ_QUERY_TIMEOUT');
    throw error;
  } finally {
    queryBudget.signal.removeEventListener('abort', cancel);
    queryBudget.dispose();
    // A canceled or unacknowledged transaction is rolled back by physically closing its connection, never by queueing more SQL on it.
    if (queryBudget.signal.aborted) db.release(true);
    else release(db);
  }
}
