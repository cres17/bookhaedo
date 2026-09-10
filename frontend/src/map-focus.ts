type Coordinate = { latitude: number; longitude: number };

function distanceKm(a: Coordinate, b: Coordinate) {
  const rad = Math.PI / 180,
    dLat = (b.latitude - a.latitude) * rad,
    dLng = (b.longitude - a.longitude) * rad;
  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

/** Finds the city-scale cluster containing the most results and centers the map on it. */
export function mapFocusForPlaces<T extends Coordinate>(places: T[], radiusKm = 12) {
  if (!places.length) return null;
  let cluster: T[] = [places[0]!],
    spread = Infinity;
  for (const candidate of places) {
    const nearby = places.filter((place) => distanceKm(candidate, place) <= radiusKm);
    const totalDistance = nearby.reduce((sum, place) => sum + distanceKm(candidate, place), 0);
    if (
      nearby.length > cluster.length ||
      (nearby.length === cluster.length && totalDistance < spread)
    ) {
      cluster = nearby;
      spread = totalDistance;
    }
  }
  const latitude = cluster.reduce((sum, place) => sum + place.latitude, 0) / cluster.length;
  const longitude = cluster.reduce((sum, place) => sum + place.longitude, 0) / cluster.length;
  return {
    center: { latitude, longitude },
    zoom: cluster.length === 1 ? 14 : 12,
    count: cluster.length,
  };
}
