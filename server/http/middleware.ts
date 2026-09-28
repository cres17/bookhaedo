import type { RequestHandler, ErrorRequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { logger } from '../observability/logger.js';
const codes: Record<number, string> = {
  400: 'INVALID_INPUT',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'RATE_LIMITED',
  500: 'INTERNAL_ERROR',
  503: 'SERVICE_UNAVAILABLE',
};
export const requestContext: RequestHandler = (_req, res, next) => {
  res.locals.requestId = randomUUID();
  res.set('X-Request-ID', res.locals.requestId);
  res.set('Cache-Control', 'no-store');
  const json = res.json.bind(res);
  res.json = (body) =>
    json(
      res.statusCode >= 400 && body && typeof body.error === 'string'
        ? {
            ...body,
            code: body.code || codes[res.statusCode] || 'REQUEST_FAILED',
            requestId: res.locals.requestId,
          }
        : body,
    );
  next();
};
export const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof ZodError)
    return res.status(400).json({
      error: '입력 형식을 확인해주세요.',
      details: error.issues.map((x) => ({ path: x.path, message: x.message })),
    });
  if (error.type === 'entity.parse.failed')
    return res.status(400).json({ error: 'JSON 형식을 확인해주세요.' });
  if (error.type === 'entity.too.large')
    return res.status(413).json({ error: '요청 내용이 너무 큽니다.' });
  if (['23505', '23503', '23514', '40001', '40P01'].includes(error.code))
    return res
      .status(409)
      .json({ error: '현재 데이터와 충돌합니다. 새로고침 후 다시 시도해주세요.' });
  const unavailable = ['ECONNREFUSED', 'ETIMEDOUT', '57P01', '57P03', '53300', '08006'].includes(
    error.code,
  );
  logger.error('API_ERROR', {
    requestId: res.locals.requestId,
    code: unavailable ? 'DATABASE_UNAVAILABLE' : 'INTERNAL_ERROR',
  });
  res
    .status(unavailable ? 503 : 500)
    .json({ error: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.' });
};
