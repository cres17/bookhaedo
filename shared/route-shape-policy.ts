export const MAX_ROUTE_POINTS = 20000;
export const MAX_SHAPE_CHARS = 262144;
export function validRouteCoordinates(value: unknown): value is [number, number][] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.length <= MAX_ROUTE_POINTS &&
    value.every(
      (point) =>
        Array.isArray(point) &&
        point.length === 2 &&
        typeof point[0] === 'number' &&
        typeof point[1] === 'number' &&
        Number.isFinite(point[0]) &&
        Number.isFinite(point[1]) &&
        Math.abs(point[0]) <= 180 &&
        Math.abs(point[1]) <= 90,
    )
  );
}
