import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { pool } from './db.js';
export const admin = Router();
admin.use((_req, res, next) => {
  if (res.locals.user.role !== 'ADMIN')
    return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
  res.set('Cache-Control', 'no-store');
  next();
});
admin.get('/users', async (req, res) => {
  const { q, offset } = z
    .object({
      q: z.string().max(100).default(''),
      offset: z.coerce.number().int().min(0).default(0),
    })
    .parse(req.query);
  const search = '%' + q.replace(/[\\%_]/g, '\\$&') + '%';
  const where = 'WHERE email ILIKE $1 OR display_name ILIKE $1';
  const count = await pool.query('SELECT count(*)::int AS count FROM planner.app_user ' + where, [
    search,
  ]);
  const users = await pool.query(
    'SELECT id,email,display_name AS name,role,status,created_at AS "createdAt" FROM planner.app_user ' +
      where +
      ' ORDER BY created_at DESC,id LIMIT 20 OFFSET $2',
    [search, offset],
  );
  res.json({ data: users.rows, count: count.rows[0].count });
});
admin.patch('/users/:id', async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const input = z
    .object({ role: z.enum(['MEMBER', 'ADMIN']), status: z.enum(['ACTIVE', 'SUSPENDED']) })
    .strict()
    .parse(req.body);
  if (id === res.locals.user.id)
    return res.status(409).json({ error: '자신의 권한·상태는 변경할 수 없습니다.' });
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query('LOCK TABLE planner.app_user IN SHARE ROW EXCLUSIVE MODE');
    const actor = await db.query('SELECT role,status FROM planner.app_user WHERE id=$1', [
      res.locals.user.id,
    ]);
    if (actor.rows[0]?.role !== 'ADMIN' || actor.rows[0]?.status !== 'ACTIVE') {
      await db.query('ROLLBACK');
      return res.status(403).json({ error: '관리자 권한이 변경되었습니다.' });
    }
    const target = await db.query('SELECT role,status FROM planner.app_user WHERE id=$1', [id]);
    if (!target.rowCount) {
      await db.query('ROLLBACK');
      return res.status(404).json({ error: '회원을 찾을 수 없습니다.' });
    }
    await db.query('UPDATE planner.app_user SET role=$1,status=$2 WHERE id=$3', [
      input.role,
      input.status,
      id,
    ]);
    await db.query('DELETE FROM planner.session WHERE user_id=$1', [id]);
    await db.query(
      'INSERT INTO planner.admin_audit(id,actor_id,target_id,before_state,after_state) VALUES($1,$2,$3,$4,$5)',
      [randomUUID(), res.locals.user.id, id, target.rows[0], input],
    );
    await db.query('COMMIT');
    res.json({ saved: true });
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
});
admin.get('/audit', async (_req, res) => {
  const q = await pool.query(
    'SELECT id,actor_id AS "actorId",target_id AS "targetId",before_state AS before,after_state AS after,created_at AS "createdAt" FROM planner.admin_audit ORDER BY created_at DESC LIMIT 100',
  );
  res.json({ data: q.rows });
});
