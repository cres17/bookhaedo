import type { RequestHandler } from 'express';
import helmet from 'helmet';

export function securityHeaders(env: NodeJS.ProcessEnv = process.env) {
  return helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy:
      env.NODE_ENV === 'production'
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: [
                "'self'",
                'https://maps.googleapis.com',
                'https://maps.gstatic.com',
                'https://unpkg.com',
              ],
              styleSrc: [
                "'self'",
                "'unsafe-inline'",
                'https://fonts.googleapis.com',
                'https://unpkg.com',
              ],
              fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
              imgSrc: [
                "'self'",
                'data:',
                'blob:',
                'https://*.googleapis.com',
                'https://*.gstatic.com',
              ],
              connectSrc: ["'self'", 'https://*.googleapis.com', 'https://maps.googleapis.com'],
              workerSrc: ["'self'", 'blob:'],
              objectSrc: ["'none'"],
              baseUri: ["'self'"],
              frameAncestors: ["'none'"],
            },
          }
        : false,
  });
}

export function allowedOrigin(allowed: string[]): RequestHandler {
  const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
  return (req, res, next) => {
    const origin = req.get('origin');
    if (origin && !safeMethods.has(req.method) && !allowed.includes(origin))
      return res.status(403).json({ error: '허용되지 않은 요청 출처입니다.' });
    next();
  };
}
