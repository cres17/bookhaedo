import { straightDistance } from './domain.js';
type Point = { latitude: number; longitude: number };
// Keep the starting point and existing relative order; minimize added straight-line distance.
export function nearbyPosition(items: Point[], place: Point): number {
  if (!items.length) return 0;
  let best = items.length;
  let cost = straightDistance(items[items.length - 1]!, place);
  for (let i = 1; i < items.length; i++) {
    const delta =
      straightDistance(items[i - 1]!, place) +
      straightDistance(place, items[i]!) -
      straightDistance(items[i - 1]!, items[i]!);
    if (delta < cost) {
      best = i;
      cost = delta;
    }
  }
  return best;
}
