import express from 'express';
import request from 'supertest';
import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { securityHeaders } from '../server/http/security';

it('production sends a restrictive CSP compatible with map and external Swagger assets', async () => {
  const app = express()
    .use(securityHeaders({ NODE_ENV: 'production' }))
    .get('/', (_req, res) => res.send('ok'));
  const response = await request(app).get('/');
  const policy = response.headers['content-security-policy'];
  expect(policy).toContain("default-src 'self'");
  expect(policy).toContain("object-src 'none'");
  expect(policy).toContain("frame-ancestors 'none'");
  expect(policy).toContain('https://maps.googleapis.com');
  expect(policy).toContain('https://unpkg.com');
});

it('Swagger contains no inline script block that would require unsafe-inline', async () => {
  const html = await readFile(new URL('../frontend/public/swagger.html', import.meta.url), 'utf8');
  expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
  expect(html).toContain('/swagger-init.js');
});
