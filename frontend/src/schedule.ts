import type { Place } from './types';
export type Visit = {
  place: Place;
  start: number;
  end: number;
  suggested: boolean;
  conflict: boolean;
};
export const clockTime = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
export function arrangeVisits(items: Place[]): { visits: Visit[]; unplaced: Place[] } {
  const visits: Visit[] = items
    .filter((p) => p.startMinute != null && p.endMinute != null)
    .map((place) => ({
      place,
      start: place.startMinute!,
      end: place.endMinute!,
      suggested: false,
      conflict: false,
    }));
  const unplaced: Place[] = [];
  for (const place of items.filter((p) => p.startMinute == null || p.endMinute == null)) {
    const length = place.category === 'ATTRACTION' ? 90 : 60;
    let start = 9 * 60;
    for (const visit of [...visits].sort((a, b) => a.start - b.start)) {
      if (start + length <= visit.start) break;
      if (start < visit.end) start = visit.end;
    }
    if (start + length > 1440) {
      unplaced.push(place);
      continue;
    }
    visits.push({ place, start, end: start + length, suggested: true, conflict: false });
  }
  visits.sort((a, b) => a.start - b.start || a.end - b.end);
  for (const visit of visits)
    visit.conflict = visits.some(
      (other) => other !== visit && visit.start < other.end && other.start < visit.end,
    );
  return { visits, unplaced };
}
