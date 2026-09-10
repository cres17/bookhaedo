import { Router, type RequestHandler } from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { pool } from './db.js';
import { splitYen, settle } from './settlement.js';
import { dateOnly } from './domain.js';
import { requireRevision } from './itinerary-version.js';

const wrap =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const owner: RequestHandler = (_req, res, next) =>
  res.locals.trip.isOwner
    ? next()
    : res.status(403).json({ error: '여행 소유자만 관리할 수 있어요.' });
const label = z.string().trim().min(1).max(200);
export const collaboration = Router({ mergeParams: true });
export const invitations = Router();
async function people(tripId: string) {
  return (
    await pool.query(
      `SELECT u.id,u.display_name AS name,(t.user_id=u.id) AS "isOwner" FROM planner.app_user u JOIN planner.trip t ON t.id=$1 WHERE u.id=t.user_id OR EXISTS(SELECT 1 FROM planner.trip_member m WHERE m.trip_id=t.id AND m.user_id=u.id) ORDER BY u.id`,
      [tripId],
    )
  ).rows;
}
invitations.get(
  '/notifications',
  wrap(async (_req, res) => {
    const user = res.locals.user;
    const pending = await pool.query(
      `SELECT i.id,t.title,i.trip_id AS "tripId",i.expires_at AS "expiresAt",u.display_name AS "senderName" FROM planner.trip_invitation i JOIN planner.trip t ON t.id=i.trip_id LEFT JOIN planner.app_user u ON u.id=i.sender_id WHERE i.email=$1 AND i.status='PENDING' AND i.expires_at>now() ORDER BY i.created_at DESC LIMIT 50`,
      [user.email],
    );
    const messages = await pool.query(
      'SELECT id,message,trip_id AS "tripId",read_at AS "readAt" FROM planner.notification WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50',
      [user.id],
    );
    res.json({ invitations: pending.rows, notifications: messages.rows });
  }),
);
invitations.patch(
  '/notifications/read',
  wrap(async (_req, res) => {
    await pool.query(
      'UPDATE planner.notification SET read_at=now() WHERE user_id=$1 AND read_at IS NULL',
      [res.locals.user.id],
    );
    res.json({ saved: true });
  }),
);
invitations.get(
  '/invitations/link/:token',
  wrap(async (req, res) => {
    const token = z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(req.params.token);
    const q = await pool.query(
      `SELECT i.id,t.title,i.email FROM planner.trip_invitation i JOIN planner.trip t ON t.id=i.trip_id WHERE i.token_hash=$1 AND i.status='PENDING' AND i.expires_at>now() AND (i.email IS NULL OR i.email=$2)`,
      [hash(token), res.locals.user.email],
    );
    if (!q.rowCount)
      return res.status(404).json({ error: '초대가 만료되었거나 사용할 수 없어요.' });
    res.json(q.rows[0]);
  }),
);
invitations.post(
  '/invitations/respond',
  wrap(async (req, res) => {
    const input = z
      .object({
        id: z.uuid().optional(),
        token: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        accept: z.boolean(),
      })
      .refine((v) => !!v.id !== !!v.token)
      .parse(req.body);
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const q = await db.query(
        `SELECT * FROM planner.trip_invitation WHERE ${input.token ? 'token_hash' : 'id'}=$1 FOR UPDATE`,
        [input.token ? hash(input.token) : input.id],
      );
      const i = q.rows[0],
        user = res.locals.user;
      if (
        !i ||
        i.status !== 'PENDING' ||
        new Date(i.expires_at).getTime() <= Date.now() ||
        (i.email ? i.email !== user.email : !input.token)
      ) {
        await db.query('ROLLBACK');
        return res.status(404).json({ error: '초대가 만료되었거나 대상 계정이 아니에요.' });
      }
      if (i.sender_id === user.id) {
        await db.query('ROLLBACK');
        return res.status(400).json({ error: '본인의 초대는 수락할 수 없어요.' });
      }
      if (input.accept)
        await db.query(
          'INSERT INTO planner.trip_member(trip_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
          [i.trip_id, user.id],
        );
      await db.query('UPDATE planner.trip_invitation SET status=$1,accepted_by=$2 WHERE id=$3', [
        input.accept ? 'ACCEPTED' : 'DECLINED',
        user.id,
        i.id,
      ]);
      if (input.accept && i.sender_id)
        await db.query(
          'INSERT INTO planner.notification(id,user_id,trip_id,message) VALUES($1,$2,$3,$4)',
          [randomUUID(), i.sender_id, i.trip_id, `${user.name} 님이 여행 초대를 수락했어요.`],
        );
      await db.query('COMMIT');
      res.json({ accepted: input.accept, tripId: i.trip_id });
    } catch (e) {
      await db.query('ROLLBACK');
      throw e;
    } finally {
      db.release();
    }
  }),
);
collaboration.get(
  '/members',
  wrap(async (req, res) =>
    res.json({ data: await people(String(req.params.id)), isOwner: res.locals.trip.isOwner }),
  ),
);
collaboration.get(
  '/invitations',
  owner,
  wrap(async (req, res) => {
    const q = await pool.query(
      'SELECT id,email,status,expires_at AS "expiresAt" FROM planner.trip_invitation WHERE trip_id=$1 ORDER BY created_at DESC LIMIT 50',
      [req.params.id],
    );
    res.json({ data: q.rows });
  }),
);
collaboration.post(
  '/invitations',
  owner,
  wrap(async (req, res) => {
    const { email } = z
      .object({
        email: z
          .email()
          .transform((v) => v.toLowerCase())
          .optional(),
      })
      .parse(req.body);
    if (email === res.locals.user.email)
      return res.status(400).json({ error: '본인은 이미 여행 소유자예요.' });
    const token = randomBytes(32).toString('hex');
    try {
      await pool.query(
        `INSERT INTO planner.trip_invitation(id,trip_id,sender_id,email,token_hash) VALUES($1,$2,$3,$4,$5)`,
        [randomUUID(), req.params.id, res.locals.user.id, email || null, hash(token)],
      );
    } catch (e: any) {
      if (e.code === '23505')
        return res
          .status(409)
          .json({ error: '이미 초대했어요. 기존 초대를 취소한 뒤 다시 보내주세요.' });
      throw e;
    }
    res.status(201).json({ path: '/invite/' + token, expiresInDays: 7 });
  }),
);
collaboration.delete(
  '/invitations/:invitationId',
  owner,
  wrap(async (req, res) => {
    await pool.query(
      "UPDATE planner.trip_invitation SET status='REVOKED' WHERE id=$1 AND trip_id=$2 AND status='PENDING'",
      [z.uuid().parse(req.params.invitationId), req.params.id],
    );
    res.status(204).end();
  }),
);
collaboration.get(
  '/checklist',
  wrap(async (req, res) =>
    res.json({
      data: (
        await pool.query(
          'SELECT id,label,done FROM planner.checklist_item WHERE trip_id=$1 ORDER BY created_at,id',
          [req.params.id],
        )
      ).rows,
    }),
  ),
);
collaboration.post(
  '/checklist',
  wrap(async (req, res) => {
    const input = z.object({ label }).parse(req.body);
    await pool.query('INSERT INTO planner.checklist_item(id,trip_id,label) VALUES($1,$2,$3)', [
      randomUUID(),
      req.params.id,
      input.label,
    ]);
    res.status(201).json({ saved: true });
  }),
);
collaboration.patch(
  '/checklist/:itemId',
  wrap(async (req, res) => {
    const { done } = z.object({ done: z.boolean() }).parse(req.body);
    const q = await pool.query(
      'UPDATE planner.checklist_item SET done=$1 WHERE id=$2 AND trip_id=$3',
      [done, z.uuid().parse(req.params.itemId), req.params.id],
    );
    if (!q.rowCount) return res.status(404).json({ error: '항목이 없어요.' });
    res.json({ saved: true });
  }),
);
collaboration.delete(
  '/checklist/:itemId',
  wrap(async (req, res) => {
    await pool.query('DELETE FROM planner.checklist_item WHERE id=$1 AND trip_id=$2', [
      z.uuid().parse(req.params.itemId),
      req.params.id,
    ]);
    res.status(204).end();
  }),
);
collaboration.get(
  '/messages',
  wrap(async (req, res) => {
    const before = z.uuid().optional().parse(req.query.before);
    const q = await pool.query(
      `SELECT m.id,m.body,m.user_id AS "userId",COALESCE(u.display_name,'탈퇴한 동행자') AS name,m.created_at AS "createdAt" FROM planner.trip_message m LEFT JOIN planner.app_user u ON u.id=m.user_id WHERE m.trip_id=$1 AND ($2::uuid IS NULL OR (m.created_at,m.id)<(SELECT created_at,id FROM planner.trip_message WHERE id=$2 AND trip_id=$1)) ORDER BY m.created_at DESC,m.id DESC LIMIT 100`,
      [req.params.id, before || null],
    );
    res.json({ data: q.rows.reverse(), hasMore: q.rowCount === 100 });
  }),
);
collaboration.post(
  '/messages',
  wrap(async (req, res) => {
    const { body } = z.object({ body: z.string().trim().min(1).max(2000) }).parse(req.body);
    await pool.query(
      'INSERT INTO planner.trip_message(id,trip_id,user_id,body) VALUES($1,$2,$3,$4)',
      [randomUUID(), req.params.id, res.locals.user.id, body],
    );
    res.status(201).json({ saved: true });
  }),
);
collaboration.get(
  '/expenses',
  wrap(async (req, res) => {
    const expenses = (
      await pool.query(
        'SELECT id,label,amount,payer_id AS "payerId" FROM planner.expense WHERE trip_id=$1 ORDER BY created_at DESC',
        [req.params.id],
      )
    ).rows;
    const shares = (
      await pool.query(
        'SELECT s.expense_id AS "expenseId",s.participant_id AS id,s.amount FROM planner.expense_share s JOIN planner.expense e ON e.id=s.expense_id WHERE e.trip_id=$1',
        [req.params.id],
      )
    ).rows;
    const balances = new Map<string, number>();
    for (const e of expenses)
      balances.set(
        e.payerId || 'withdrawn',
        (balances.get(e.payerId || 'withdrawn') || 0) + e.amount,
      );
    for (const s of shares) balances.set(s.id, (balances.get(s.id) || 0) - s.amount);
    res.json({
      data: expenses.map((e) => ({ ...e, shares: shares.filter((s) => s.expenseId === e.id) })),
      total: expenses.reduce((n, e) => n + e.amount, 0),
      transfers: settle([...balances].map(([id, balance]) => ({ id, balance }))),
    });
  }),
);
collaboration.post(
  '/expenses',
  wrap(async (req, res) => {
    const input = z
      .object({
        label,
        amount: z.number().int().min(1).max(100000000),
        payerId: z.uuid(),
        participantIds: z.array(z.uuid()).min(1).max(100),
      })
      .parse(req.body);
    const members = await people(String(req.params.id));
    if (![input.payerId, ...input.participantIds].every((id) => members.some((m) => m.id === id)))
      return res.status(400).json({ error: '현재 여행 동행자만 정산할 수 있어요.' });
    const db = await pool.connect(),
      id = randomUUID();
    try {
      await db.query('BEGIN');
      await db.query(
        'INSERT INTO planner.expense(id,trip_id,label,amount,payer_id) VALUES($1,$2,$3,$4,$5)',
        [id, req.params.id, input.label, input.amount, input.payerId],
      );
      for (const s of splitYen(input.amount, input.participantIds))
        await db.query(
          'INSERT INTO planner.expense_share(expense_id,participant_id,amount) VALUES($1,$2,$3)',
          [id, s.id, s.amount],
        );
      await db.query('COMMIT');
      res.status(201).json({ saved: true });
    } catch (e) {
      await db.query('ROLLBACK');
      throw e;
    } finally {
      db.release();
    }
  }),
);
collaboration.delete(
  '/expenses/:expenseId',
  wrap(async (req, res) => {
    await pool.query('DELETE FROM planner.expense WHERE id=$1 AND trip_id=$2', [
      z.uuid().parse(req.params.expenseId),
      req.params.id,
    ]);
    res.status(204).end();
  }),
);
collaboration.patch(
  '/days/:date/items/:placeId/budget',
  wrap(async (req, res) => {
    const { estimatedCost } = z
      .object({ estimatedCost: z.number().int().min(0).max(100000000).nullable() })
      .parse(req.body);
    const date = dateOnly.parse(req.params.date),
      place = z.string().min(1).max(200).parse(req.params.placeId),
      db = await pool.connect();
    try {
      await db.query('BEGIN');
      const q = await db.query(
        'SELECT id,revision FROM planner.trip_day WHERE trip_id=$1 AND visit_date=$2 FOR UPDATE',
        [req.params.id, date],
      );
      if (!q.rowCount) {
        await db.query('ROLLBACK');
        return res.status(404).json({ error: '날짜가 없어요.' });
      }
      const day = q.rows[0];
      if (!requireRevision(req.body, day.revision, res)) {
        await db.query('ROLLBACK');
        return;
      }
      const item = await db.query(
        'UPDATE planner.itinerary_item SET estimated_cost=$1 WHERE day_id=$2 AND place_id=$3',
        [estimatedCost, day.id, place],
      );
      if (!item.rowCount) {
        await db.query('ROLLBACK');
        return res.status(404).json({ error: '장소가 없어요.' });
      }
      await db.query('UPDATE planner.trip_day SET revision=revision+1 WHERE id=$1', [day.id]);
      await db.query('COMMIT');
      res.json({ revision: day.revision + 1 });
    } catch (e) {
      await db.query('ROLLBACK');
      throw e;
    } finally {
      db.release();
    }
  }),
);
