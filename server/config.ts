export function validateProduction(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV !== 'production') return;
  if (!env.DATABASE_URL) throw Error('DATABASE_URL is required in production');
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
    !env.GOOGLE_MAPS_SERVER_API_KEY ||
    env.GOOGLE_MAPS_SERVER_API_KEY === env.VITE_GOOGLE_MAPS_API_KEY
  )
    throw Error('Production requires a separate server Google key');
  if (
    !env.VALHALLA_BASE_URL ||
    new URL(env.VALHALLA_BASE_URL).hostname === 'valhalla1.openstreetmap.de'
  )
    throw Error('Production requires a self-hosted or licensed Valhalla endpoint');
}
