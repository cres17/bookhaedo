import { it } from 'vitest';
import request from 'supertest';
import { readFileSync, writeFileSync } from 'node:fs';
import { app } from '../server/app';
import { migrate, pool } from '../server/db';
it('doc→code: every documented operation is actually registered', async () => {
  await migrate();
  const spec = JSON.parse(readFileSync('docs/openapi-rest.json', 'utf8'));
  const uuid = '00000000-0000-4000-8000-000000000000';
  const fill = (p: string) => '/api' + p.replace(/\{[^}]*[dD]ate[^}]*\}/g, '2026-10-01').replace(/\{[^}]+\}/g, uuid);
  const missing: string[] = [], ok: string[] = [];
  for (const [path, item] of Object.entries<any>(spec.paths))
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      if (!item[method]) continue;
      const res = await (request(app) as any)[method](fill(path)).send({});
      const unregistered = res.status === 404 && res.body?.error === 'API 경로를 찾을 수 없습니다.';
      (unregistered ? missing : ok).push(`${method.toUpperCase()} ${path} -> ${res.status}`);
    }
  writeFileSync(process.env.PROBE_OUT!, JSON.stringify({ documented: ok.length + missing.length, registered: ok.length, unregistered: missing }, null, 1));
  await pool.end();
});
