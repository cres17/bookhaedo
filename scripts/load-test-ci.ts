process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.API_RATE_LIMIT = '1000000';

const [{ app }, { migrate, pool }, { runLoadTest }] = await Promise.all([
  import('../server/app.js'),
  import('../server/db.js'),
  import('./load-test.js'),
]);

await migrate();
const server = app.listen(0, '127.0.0.1');
try {
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not expose a port');
  const report = await runLoadTest({
    url: `http://127.0.0.1:${address.port}/api/regions`,
    durationSeconds: 5,
    concurrency: 20,
    p95LimitMs: 250,
    errorRateLimit: 0,
  });
  console.log(JSON.stringify(report));
} finally {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await pool.query("DELETE FROM planner.rate_limit_bucket WHERE namespace LIKE 'api-test-%'");
  await pool.end();
}
