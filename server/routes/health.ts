import { Router } from 'express';
import { pool } from '../db.js';
import { wrap } from '../http/async-handler.js';
export const probeRoutes = Router();
export const healthRoutes = Router();
probeRoutes.get('/api/health/live', (_req, res) => res.json({ status: 'ok' }));
probeRoutes.get(
  '/api/health/ready',
  wrap(async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', database: 'connected' });
    } catch {
      res.status(503).json({ error: '데이터베이스에 연결할 수 없습니다.' });
    }
  }),
);
healthRoutes.get(
  '/api/health',
  wrap(async (_req, res) => {
    const q = await pool.query('SELECT count(*)::int AS count FROM geo_data.place');
    res.json({ status: 'ok', database: 'connected', places: q.rows[0].count });
  }),
);
