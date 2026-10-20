import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { pool } from '../db.js';
import { hash } from './password.js';
import { wrap } from '../http/async-handler.js';
const verifiedSession = Symbol('verifiedSession');
type SessionUser = { id: string; email: string; name: string; role: string; status: string };
type SessionLookup = { token: string; user: SessionUser | null };

/** Share verification only within this response; expiry and revocation are checked on every request. */
export async function sessionUser(req: Request, res: Response, database: Pool | PoolClient = pool) {
  const token: unknown = req.cookies?.kita_session;
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
  const locals = res.locals as typeof res.locals & { [verifiedSession]?: SessionLookup };
  const cached = locals[verifiedSession];
  if (cached?.token === token) return cached.user;
  const result = await database.query<SessionUser>(
    "SELECT u.id,u.email,u.display_name AS name,u.role,u.status FROM planner.session s JOIN planner.app_user u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.status='ACTIVE'",
    [hash(token)],
  );
  const user = result.rows[0] ?? null;
  locals[verifiedSession] = { token, user };
  return user;
}

export const requireAuth = wrap(async (req, res, next) => {
  const token: unknown = req.cookies?.kita_session;
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token))
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  const user = await sessionUser(req, res);
  if (!user) return res.status(401).json({ error: '로그인이 만료됐습니다.' });
  res.locals.user = user;
  next();
});
export async function createSession(database: Pool | PoolClient, userId: string) {
  const token = randomBytes(32).toString('hex');
  await database.query(
    "INSERT INTO planner.session(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')",
    [hash(token), userId],
  );
  return token;
}
export function setSessionCookie(res: Response, token: string) {
  res.cookie('kita_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 86400000,
    path: '/',
  });
}
export async function setSession(res: Response, userId: string) {
  setSessionCookie(res, await createSession(pool, userId));
}
