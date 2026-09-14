type Point = { latitude: number; longitude: number };
export function transitLink(from: Point, to: Point) {
  return (
    'https://www.google.com/maps/dir/?' +
    new URLSearchParams({
      api: '1',
      origin: `${from.latitude},${from.longitude}`,
      destination: `${to.latitude},${to.longitude}`,
      travelmode: 'transit',
    })
  );
}
