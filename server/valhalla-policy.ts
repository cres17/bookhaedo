export const PUBLIC_VALHALLA_BASE_URL = 'https://valhalla1.openstreetmap.de';

export function isPublicValhalla(baseUrl: string) {
  // Explicitly setting the demo URL must not bypass its shared usage policy.
  return (
    new URL(baseUrl).hostname.toLowerCase().replace(/\.$/, '') === 'valhalla1.openstreetmap.de'
  );
}
