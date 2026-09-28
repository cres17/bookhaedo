import { expect, it } from 'vitest';
import { arrangeVisits } from '../frontend/src/schedule';
import { nearbyPosition } from '../server/placement';
import type { Place } from '../frontend/src/types';
const place = (id: string, startMinute: number | null = null, endMinute: number | null = null) =>
  ({ id, category: 'ATTRACTION', startMinute, endMinute }) as Place;
it('자동 제안은 고정 예약 사이의 빈 시간에 배치하고 고정 시간을 유지한다', () => {
  const { visits } = arrangeVisits([place('fixed', 600, 660), place('new')]);
  expect(visits.find((v) => v.place.id === 'fixed')).toMatchObject({
    start: 600,
    end: 660,
    suggested: false,
  });
  expect(visits.find((v) => v.place.id === 'new')).toMatchObject({
    start: 660,
    end: 750,
    suggested: true,
  });
});
it('겹친 시간은 표시하고 자정을 넘는 제안은 시간 미정으로 남긴다', () => {
  const result = arrangeVisits([place('a', 0, 1440), place('b', 600, 700), place('c')]);
  expect(result.visits.every((v) => v.conflict)).toBe(true);
  expect(result.unplaced.map((p) => p.id)).toEqual(['c']);
});
it('새 장소를 첫 장소 이후 직선거리 증가가 적은 곳에 끼워 넣는다', () => {
  const p = (longitude: number) => ({ latitude: 43, longitude });
  expect(nearbyPosition([p(141), p(143)], p(142))).toBe(1);
  expect(nearbyPosition([], p(142))).toBe(0);
  expect(nearbyPosition([p(141)], p(142))).toBe(1);
});
