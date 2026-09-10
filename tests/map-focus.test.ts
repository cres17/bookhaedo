import { describe, it, expect } from 'vitest';
import { mapFocusForPlaces } from '../frontend/src/map-focus';

describe('지역 검색 결과 지도 중심', () => {
  it('멀리 떨어진 장소보다 가장 많은 장소가 모인 시내 군집을 선택한다', () => {
    const focus = mapFocusForPlaces([
      { latitude: 43.0618, longitude: 141.3545 },
      { latitude: 43.0667, longitude: 141.3508 },
      { latitude: 43.0555, longitude: 141.3407 },
      { latitude: 43.0731, longitude: 141.365 },
      { latitude: 42.9, longitude: 141.2 },
      { latitude: 43.1907, longitude: 141.0027 },
    ]);
    expect(focus?.count).toBe(4);
    expect(focus?.center.latitude).toBeCloseTo(43.0643, 3);
    expect(focus?.center.longitude).toBeCloseTo(141.3528, 3);
    expect(focus?.zoom).toBe(12);
  });

  it('장소가 하나면 해당 좌표를 더 가까이 보여준다', () => {
    const focus = mapFocusForPlaces([{ latitude: 43.197, longitude: 140.9937 }]);
    expect(focus).toEqual({
      center: { latitude: 43.197, longitude: 140.9937 },
      zoom: 14,
      count: 1,
    });
  });

  it('검색 결과가 없으면 기존 지역 중심을 유지할 수 있도록 null을 반환한다', () => {
    expect(mapFocusForPlaces([])).toBeNull();
  });
});
