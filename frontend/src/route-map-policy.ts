import { MAX_SHAPE_CHARS, validRouteCoordinates } from '../../shared/route-shape-policy';
type Point = { latitude: number; longitude: number };
export function routeMapPath(
  segment: { source: string; coordinates?: unknown; polyline?: unknown },
  from: Point,
  to: Point,
  decode: (polyline: string) => unknown,
) {
  let coordinates: unknown = segment.coordinates;
  if (
    !validRouteCoordinates(coordinates) &&
    typeof segment.polyline === 'string' &&
    segment.polyline.length > 0 &&
    segment.polyline.length <= MAX_SHAPE_CHARS
  ) {
    try {
      coordinates = decode(segment.polyline);
    } catch {
      coordinates = undefined;
    }
  }
  if (validRouteCoordinates(coordinates))
    return {
      path: coordinates.map(([lng, lat]) => ({ lat, lng })),
      routed: segment.source === 'google' || segment.source === 'valhalla',
    };
  return {
    path: [
      { lat: from.latitude, lng: from.longitude },
      { lat: to.latitude, lng: to.longitude },
    ],
    routed: false,
  };
}
