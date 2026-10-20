import { createServer, connect, type Socket } from 'node:net';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import pg from 'pg';
import { pool } from '../server/db';
import { readQuery } from '../server/read-query';
afterAll(() => pool.end());
for (const phase of ['running-query', 'begin-response', 'protocol-timeout', 'cancel-response'])
  it('closes a read connection with a withheld PG response: ' + phase, async () => {
    const target = new URL(pool.options.connectionString!);
    const sockets = new Set<Socket>();
    let first: Socket | undefined;
    const proxy = createServer((client) => {
      const upstream = connect({ host: target.hostname, port: Number(target.port) || 5432 });
      sockets.add(client);
      sockets.add(upstream);
      if (first && phase === 'cancel-response')
        client.on('data', (chunk: Buffer) => {
          if (chunk.includes('SELECT pg_cancel_backend')) upstream.pause();
        });
      first ??= upstream;
      client.on('error', () => {});
      upstream.on('error', () => {});
      client.once('close', () => {
        upstream.destroy();
        sockets.delete(client);
      });
      upstream.once('close', () => {
        client.destroy();
        sockets.delete(upstream);
      });
      client.pipe(upstream);
      upstream.pipe(client);
    });
    proxy.listen(0, '127.0.0.1');
    await once(proxy, 'listening');
    const proxied = new URL(target);
    proxied.hostname = '127.0.0.1';
    proxied.port = String((proxy.address() as any).port);
    const database = new pg.Pool({ ...pool.options, connectionString: proxied.toString(), max: 1 });
    const controller = new AbortController();
    const tag = 'wire-' + randomUUID();
    const actualConnect = database.connect.bind(database);
    if (phase === 'begin-response')
      database.connect = (async () => {
        const client = await actualConnect();
        first!.pause();
        return client;
      }) as any;
    const running = readQuery(`SELECT pg_sleep(8) /* ${tag} */`, [], controller.signal, database);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (phase !== 'begin-response') {
        let active = false;
        for (let i = 0; i < 100 && !active; i++) {
          active =
            (
              await pool.query("SELECT 1 FROM pg_stat_activity WHERE query=$1 AND state='active'", [
                `SELECT pg_sleep(8) /* ${tag} */`,
              ])
            ).rowCount === 1;
          if (!active) await new Promise((r) => setTimeout(r, 5));
        }
        expect(active).toBe(true);
        first!.pause();
      } else {
        for (let i = 0; i < 100 && !first?.isPaused(); i++)
          await new Promise((r) => setTimeout(r, 5));
        expect(first?.isPaused()).toBe(true);
      }
      if (phase !== 'protocol-timeout') controller.abort();
      const outcome = await Promise.race([
        running.then(
          () => ({ code: 'unexpected success' }),
          (error) => error,
        ),
        new Promise<never>(
          (_, reject) =>
            (timer = setTimeout(
              () => reject(Error('PG response acknowledgement held read slot')),
              phase === 'protocol-timeout' ? 5000 : phase === 'cancel-response' ? 2000 : 1000,
            )),
        ),
      ]);
      expect(outcome.code).toBe(
        phase === 'protocol-timeout' ? 'READ_QUERY_TIMEOUT' : 'REQUEST_CANCELLED',
      );
      expect(database.totalCount).toBe(0);
    } finally {
      clearTimeout(timer);
      for (const socket of sockets) socket.resume();
      await running.catch(() => {});
      await database.end();
      for (const socket of sockets) socket.destroy();
      proxy.close();
      await once(proxy, 'close');
    }
  });
