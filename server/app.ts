import cookieParser from 'cookie-parser';
import express from 'express';
import { admin } from './admin.js';
import { requireTrip } from './auth/trip-access.js';
import { requireAuth } from './auth/session.js';
import { invitations } from './collaboration.js';
import { errorHandler, requestContext } from './http/middleware.js';
import { rateLimits } from './http/rate-limit.js';
import { allowedOrigin, securityHeaders } from './http/security.js';
import { metricsEndpoint, observeRequests } from './observability/metrics.js';
import { authRoutes } from './routes/auth.js';
import { catalogRoutes } from './routes/catalog.js';
import { healthRoutes, probeRoutes } from './routes/health.js';
import { providerRoutes } from './routes/providers.js';
import { aiRecommendations } from './routes/ai-recommendations.js';
import { tripRoutes } from './routes/trips.js';

export function createApp() {
  const app = express();
  const origins = (
    process.env.APP_ORIGINS ||
    'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000'
  ).split(',');

  app.disable('x-powered-by');
  app.set(
    'trust proxy',
    process.env.TRUST_PROXY_HOPS ? Number(process.env.TRUST_PROXY_HOPS) : false,
  );
  app.use(securityHeaders());
  app.use('/api', requestContext, observeRequests);
  app.get('/internal/metrics', metricsEndpoint);

  // Probes remain available when the shared limiter or its database is unhealthy.
  app.use(probeRoutes);
  app.use(cookieParser());
  app.use('/api', rateLimits.api(), allowedOrigin(origins));
  app.use(express.json({ limit: '24kb' }));
  app.use(healthRoutes);
  app.use('/api/admin', requireAuth, admin);
  app.use(
    '/api',
    (req, res, next) =>
      /^\/(notifications|invitations)(\/|$)/.test(req.path) ? requireAuth(req, res, next) : next(),
    invitations,
  );
  app.use(authRoutes, catalogRoutes);
  app.use('/api/trips', requireAuth);
  app.use('/api/trips/:id', requireTrip);
  app.use(tripRoutes, providerRoutes, aiRecommendations);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API 경로를 찾을 수 없습니다.' }));
  app.use(errorHandler);
  return app;
}

export const app = createApp();
