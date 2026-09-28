import { rollback, release } from '../transactions.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { pool } from '../db.js';
import { loginInput, registerInput } from '../domain.js';

import { Router } from 'express';
import { hash, passwordHash, verifyPassword } from '../auth/password.js';
import { createSession, requireAuth, setSession, setSessionCookie } from '../auth/session.js';
import { wrap } from '../http/async-handler.js';
import { rateLimits } from '../http/rate-limit.js';
const app = Router();
app.delete(
  '/api/auth/me',
  requireAuth,
  rateLimits.accountDeletion(),
  wrap(async (req, res) => {
    const { password } = z.object({ password: z.string().min(1).max(128) }).parse(req.body);
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query("SELECT pg_advisory_xact_lock(hashtext('bookhaedo-account-deletion'))");
      const user = (
        await db.query('SELECT * FROM planner.app_user WHERE id=$1 FOR UPDATE', [
          res.locals.user.id,
        ])
      ).rows[0];
      if (!user || !(await verifyPassword(password, user.password_hash))) {
        await rollback(db);
        return res.status(403).json({ error: '비밀번호가 일치하지 않아요.' });
      }
      if (user.role === 'ADMIN') {
        await rollback(db);
        return res
          .status(409)
          .json({ error: '관리자는 다른 관리자를 통해 회원 역할로 변경한 후 탈퇴해주세요.' });
      }
      await db.query('DELETE FROM planner.app_user WHERE id=$1', [user.id]);
      await db.query('COMMIT');
      res.clearCookie('kita_session', { path: '/' });
      res.status(204).end();
    } catch (e) {
      await rollback(db);
      throw e;
    } finally {
      release(db);
    }
  }),
);
const authLimit = rateLimits.auth();
app.post(
  '/api/auth/register',
  authLimit,
  wrap(async (req, res) => {
    const input = registerInput.parse(req.body);
    const id = randomUUID();
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query(
        'INSERT INTO planner.app_user(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)',
        [id, input.email, input.name, await passwordHash(input.password)],
      );
      const token = await createSession(db, id);
      await db.query('COMMIT');
      setSessionCookie(res, token);
    } catch (e: any) {
      await rollback(db);
      if (e.code === '23505') return res.status(409).json({ error: '이미 가입된 이메일입니다.' });
      throw e;
    } finally {
      release(db);
    }
    res.status(201).json({
      user: { id, email: input.email, name: input.name, role: 'MEMBER', status: 'ACTIVE' },
    });
  }),
);
app.post(
  '/api/auth/login',
  authLimit,
  wrap(async (req, res) => {
    const input = loginInput.parse(req.body);
    const q = await pool.query('SELECT * FROM planner.app_user WHERE email=$1', [input.email]);
    const user = q.rows[0];
    if (
      !user ||
      user.status !== 'ACTIVE' ||
      !(await verifyPassword(input.password, user.password_hash))
    )
      return res.status(401).json({ error: '이메일 또는 비밀번호를 확인해주세요.' });
    await setSession(res, user.id);
    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.display_name,
        role: user.role,
        status: user.status,
      },
    });
  }),
);
app.get('/api/auth/me', requireAuth, (_req, res) => res.json({ user: res.locals.user }));
app.post(
  '/api/auth/logout',
  wrap(async (req, res) => {
    if (
      typeof req.cookies.kita_session === 'string' &&
      /^[a-f0-9]{64}$/.test(req.cookies.kita_session)
    )
      await pool.query('DELETE FROM planner.session WHERE token_hash=$1', [
        hash(req.cookies.kita_session),
      ]);
    res.clearCookie('kita_session', { path: '/' });
    res.status(204).end();
  }),
);

export { app as authRoutes };
