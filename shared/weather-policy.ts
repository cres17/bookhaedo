// Product discovery thresholds, not official weather warnings or safety advice.
export function adverseWeather(w: any): boolean {
  return (
    w?.available === true &&
    (['비', '눈', '이슬비', '뇌우'].includes(w.description) ||
      w.precipitationMm >= 5 ||
      w.snowfallCm >= 1 ||
      w.precipitationProbability >= 70 ||
      w.windSpeedKmh >= 40)
  );
}
export function weatherReason(w: any): string {
  if (w?.windSpeedKmh >= 40) return '강한 바람';
  if (['비', '눈', '이슬비', '뇌우'].includes(w?.description)) return w.description;
  return '비·눈 가능성';
}
export function indoorEvidence(p: any): string | null {
  const t = p.tags || {};
  if (
    t.indoor === 'no' ||
    t.outdoor === 'yes' ||
    t.access === 'private' ||
    t.access === 'no' ||
    t.disused === 'yes' ||
    t.abandoned === 'yes' ||
    t.opening_hours === 'closed' ||
    p.openingHours === 'closed'
  )
    return null;
  if (t.indoor === 'yes') return 'OSM indoor=yes';
  return (
    (
      { museum: '박물관 분류', gallery: '미술관 분류', aquarium: '수족관 분류' } as Record<
        string,
        string
      >
    )[t.tourism] || null
  );
}
export function isOutdoor(p: any): boolean {
  const t = p.tags || {};
  if (indoorEvidence(p)) return false;
  return (
    t.indoor === 'no' ||
    t.outdoor === 'yes' ||
    !!t.natural ||
    ['park', 'garden', 'nature_reserve'].includes(t.leisure) ||
    ['viewpoint', 'zoo', 'camp_site'].includes(t.tourism) ||
    !!t['piste:type']
  );
}
