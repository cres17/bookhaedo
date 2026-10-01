import { isPublicValhalla } from './valhalla-policy.js';
export function validateProduction(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV !== 'production') return;
  if (!env.DATABASE_URL) throw Error('DATABASE_URL is required in production');
  if (!env.METRICS_TOKEN || env.METRICS_TOKEN.length < 32)
    throw Error('METRICS_TOKEN must contain at least 32 characters in production');
  if (
    env.TRUST_PROXY_HOPS &&
    (!/^\d+$/.test(env.TRUST_PROXY_HOPS) || Number(env.TRUST_PROXY_HOPS) > 10)
  )
    throw Error('TRUST_PROXY_HOPS must be an integer from 0 to 10');
  if (
    env.HTTP_LOG_SAMPLE_RATE &&
    (!Number.isFinite(Number(env.HTTP_LOG_SAMPLE_RATE)) ||
      Number(env.HTTP_LOG_SAMPLE_RATE) < 0 ||
      Number(env.HTTP_LOG_SAMPLE_RATE) > 1)
  )
    throw Error('HTTP_LOG_SAMPLE_RATE must be between 0 and 1');
  if (env.API_RATE_LIMIT && (!/^\d+$/.test(env.API_RATE_LIMIT) || Number(env.API_RATE_LIMIT) < 1))
    throw Error('API_RATE_LIMIT must be a positive integer');
  const origins = (env.APP_ORIGINS || '').split(',').filter(Boolean);
  if (
    !origins.length ||
    origins.some((o) => {
      try {
        return new URL(o).protocol !== 'https:' || new URL(o).origin !== o;
      } catch {
        return true;
      }
    })
  )
    throw Error('APP_ORIGINS must contain explicit HTTPS origins');
  if (
    env.GOOGLE_MAPS_SERVER_API_KEY &&
    env.GOOGLE_MAPS_SERVER_API_KEY === env.VITE_GOOGLE_MAPS_API_KEY
  )
    throw Error(
      'Production requires a separate server Google key when server enrichment is enabled',
    );
  if (env.VALHALLA_BASE_URL && isPublicValhalla(env.VALHALLA_BASE_URL))
    throw Error('Production requires a self-hosted or licensed Valhalla endpoint');
}
