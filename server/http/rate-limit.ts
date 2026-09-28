import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit, type Options, type Store } from 'express-rate-limit';
import type { Pool } from 'pg';
import { pool } from '../db.js';

export type RateLimitPolicy = {
  namespace: string;
  windowMs: number;
  limit: number;
  message: string;
  code?: string;
  key?: 'ip' | 'user' | 'session-or-ip';
  skip?: Options['skip'];
};

export class PostgresRateLimitStore implements Store {
  readonly localKeys = false;
  readonly prefix: string;
  private operations = 0;

  constructor(
    private readonly database: Pool,
    private readonly namespace: string,
    private readonly windowMs: number,
  ) {
    this.prefix = `${namespace}:`;
  }

  private protectedKey(key: string) {
    return createHash('sha256').update(`${this.namespace}\0${key}`).digest('hex');
  }

  async increment(key: string) {
    const result = await this.database.query<{ hits: number; reset_at: Date }>(
      `INSERT INTO planner.rate_limit_bucket(namespace,key_hash,hits,reset_at)
       VALUES($1,$2,1,clock_timestamp()+($3::double precision * interval '1 millisecond'))
       ON CONFLICT(namespace,key_hash) DO UPDATE SET
         hits=CASE WHEN planner.rate_limit_bucket.reset_at<=clock_timestamp() THEN 1 ELSE planner.rate_limit_bucket.hits+1 END,
         reset_at=CASE WHEN planner.rate_limit_bucket.reset_at<=clock_timestamp()
           THEN clock_timestamp()+($3::double precision * interval '1 millisecond')
           ELSE planner.rate_limit_bucket.reset_at END
       RETURNING hits,reset_at`,
      [this.namespace, this.protectedKey(key), this.windowMs],
    );
    if (++this.operations % 500 === 0)
      void this.database
        .query("DELETE FROM planner.rate_limit_bucket WHERE reset_at < now()-interval '1 day'")
        .catch(() => undefined);
    return { totalHits: result.rows[0]!.hits, resetTime: result.rows[0]!.reset_at };
  }

  async decrement(key: string) {
    await this.database.query(
      'UPDATE planner.rate_limit_bucket SET hits=GREATEST(hits-1,0) WHERE namespace=$1 AND key_hash=$2',
      [this.namespace, this.protectedKey(key)],
    );
  }

  async resetKey(key: string) {
    await this.database.query(
      'DELETE FROM planner.rate_limit_bucket WHERE namespace=$1 AND key_hash=$2',
      [this.namespace, this.protectedKey(key)],
    );
  }
}

export function createRateLimiter(policy: RateLimitPolicy, database: Pool = pool): RequestHandler {
  const namespace =
    process.env.NODE_ENV === 'test' ? `${policy.namespace}-test-${process.pid}` : policy.namespace;
  return rateLimit({
    windowMs: policy.windowMs,
    limit: policy.limit,
    store: new PostgresRateLimitStore(database, namespace, policy.windowMs),
    keyGenerator: (req, res) => {
      if (policy.key === 'user')
        return String(res.locals.user?.id || ipKeyGenerator(req.ip || 'unknown'));
      const session = req.cookies?.kita_session;
      if (
        policy.key === 'session-or-ip' &&
        typeof session === 'string' &&
        /^[a-f0-9]{64}$/.test(session)
      )
        return `session:${session}`;
      return `ip:${ipKeyGenerator(req.ip || 'unknown')}`;
    },
    skip: policy.skip,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    passOnStoreError: false,
    message: {
      code: policy.code || 'RATE_LIMITED',
      error: policy.message,
    },
  });
}

export const rateLimits = {
  api: () =>
    createRateLimiter({
      namespace: 'api',
      windowMs: 60_000,
      limit: Number(process.env.API_RATE_LIMIT || 300),
      key: 'session-or-ip',
      message: '요청이 많습니다. 잠시 후 다시 시도해주세요.',
    }),
  auth: () =>
    createRateLimiter({
      namespace: 'auth',
      windowMs: 15 * 60_000,
      limit: 50,
      message: '시도 횟수가 많습니다. 잠시 후 다시 시도해주세요.',
    }),
  accountDeletion: () =>
    createRateLimiter({
      namespace: 'account-deletion',
      windowMs: 15 * 60_000,
      limit: 10,
      key: 'user',
      message: '탈퇴 확인 시도가 많습니다. 잠시 후 다시 시도해주세요.',
    }),
  discovery: () =>
    createRateLimiter({
      namespace: 'discovery',
      windowMs: 60_000,
      limit: 20,
      key: 'user',
      message: '추천 조회가 많아요. 잠시 후 다시 확인해주세요.',
    }),
  provider: () =>
    createRateLimiter({
      namespace: 'provider',
      windowMs: 60_000,
      limit: 30,
      key: 'user',
      skip: (req) => req.method !== 'GET',
      code: 'PROVIDER_RATE_LIMITED',
      message: '외부 정보 조회가 많습니다. 잠시 후 다시 조회해주세요.',
    }),
};
