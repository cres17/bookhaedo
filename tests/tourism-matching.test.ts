import { expect, it, vi } from 'vitest';
import {
  matchTourismFacility,
  normalizedTourismName,
  TOURISM_MATCH_RADIUS_METERS,
} from '../server/tourism-matching';
import { isPublicValhalla } from '../server/valhalla-policy';
const input = {
  kind: 'place' as const,
  regionId: 'furano',
  title: 'ＡＢＣ・施設',
  latitude: 43.34,
  longitude: 142.39,
};
const candidate = (id: string, name: string) => ({
  id,
  name,
  regionId: 'furano',
  distanceMeters: 250,
  category: 'ATTRACTION',
  address: null,
  website: null,
});

it('uses the same normalized unique name and 250m SQL rule for every caller', async () => {
  const query = vi.fn(async () => ({
    rows: [candidate('exact', 'abc 施設'), candidate('other', '別施設')],
  }));
  const match = await matchTourismFacility({ query } as any, input);
  expect(match).toMatchObject({ placeId: 'exact', reason: 'MATCHED' });
  expect(query.mock.calls[0]).toEqual([
    expect.stringContaining('ST_DWithin'),
    ['furano', 142.39, 43.34, TOURISM_MATCH_RADIUS_METERS],
  ]);
  expect(normalizedTourismName(input.title)).toBe(normalizedTourismName('abc 施設'));
});
it.each([
  {
    rows: [candidate('one', 'abc施設'), candidate('two', 'ＡＢＣ施設')],
    reason: 'AMBIGUOUS_MATCH',
  },
  { rows: [candidate('near', '別施設')], reason: 'NAME_MISMATCH' },
  { rows: [], reason: 'NO_CATALOG_PLACE_WITHIN_250M' },
])('does not invent a match for $reason', async ({ rows, reason }) => {
  const match = await matchTourismFacility({ query: vi.fn(async () => ({ rows })) } as any, input);
  expect(match.placeId).toBeNull();
  expect(match.reason).toBe(reason);
});
it('never links events or missing coordinates even if a matching name exists', async () => {
  const query = vi.fn();
  expect((await matchTourismFacility({ query } as any, { ...input, kind: 'event' })).reason).toBe(
    'NOT_FACILITY',
  );
  expect((await matchTourismFacility({ query } as any, { ...input, longitude: null })).reason).toBe(
    'MISSING_COORDINATES',
  );
  expect(query).not.toHaveBeenCalled();
});
it('recognizes explicitly configured public hosts while rejecting lookalike hosts', () => {
  expect(isPublicValhalla('https://VALHALLA1.OPENSTREETMAP.DE./path')).toBe(true);
  expect(isPublicValhalla('https://valhalla1.openstreetmap.de.example.test')).toBe(false);
  expect(isPublicValhalla('http://127.0.0.1:8002')).toBe(false);
});
