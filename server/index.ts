import { app } from './app.js';
import { migrate, verifyMigrations } from './db.js';
import express from 'express';
import path from 'node:path';
import { pool } from './db.js';
import { validateProduction } from './config.js';
import { logger } from './observability/logger.js';
import { startMaintenance } from './maintenance.js';
validateProduction();
if (process.env.NODE_ENV === 'production') await verifyMigrations();
else await migrate();
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.resolve('dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(path.resolve('dist/index.html')));
}
const server = app.listen(
  Number(process.env.API_PORT || 3001),
  process.env.API_HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'),
  () => logger.info('SERVER_READY', { port: Number(process.env.API_PORT || 3001) }),
);
const stopMaintenance = startMaintenance(pool);
server.requestTimeout = 30000;
server.headersTimeout = 15000;
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  stopMaintenance();
  logger.info('SERVER_SHUTDOWN_STARTED');
  server.close(async () => {
    await pool.end();
    logger.info('SERVER_SHUTDOWN_COMPLETE');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
