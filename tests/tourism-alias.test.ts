import { expect, it, vi } from 'vitest';
import {
  approvedTourismAliases,
  matchTourismFacility,
  parseTourismAliases,
} from '../server/tourism-matching';
const alias = (await approvedTourismAliases())[0];
const input = {
  kind: 'place' as const,
  sourceId: alias.sourceId,
  externalId: alias.externalId,
  contentSha256: alias.contentSha256,
  title: alias.title,
  regionId: alias.regionId,
  latitude: 43.35,
  longitude: 142.38,
};
const row = {
  id: alias.placeId,
  name: alias.catalogName,
  website: alias.catalogWebsite,
  regionId: alias.regionId,
  distanceMeters: 16,
  category: 'ATTRACTION',
  address: '北海道富良野市清水山',
};
const db = (rows = [row]) => ({ query: vi.fn(async () => ({ rows })) }) as any;
it('applies only the reviewed source row and catalog fingerprint', async () => {
  expect(await matchTourismFacility(db(), input, [alias])).toMatchObject({
    placeId: alias.placeId,
    reason: 'MATCHED_ALIAS',
  });
});
it.each([
  { sourceId: 'other-source' },
  { externalId: 'other-id' },
  { title: 'changed title' },
  { contentSha256: 'a'.repeat(64) },
  { regionId: 'other-region' },
])('fails closed after source identity/content changes: %j', async (change) => {
  expect((await matchTourismFacility(db(), { ...input, ...change }, [alias])).placeId).toBeNull();
});
it.each([
  { name: 'different catalog' },
  { website: 'https://example.test' },
  { distanceMeters: 251 },
  { regionId: 'other' },
])('fails closed after catalog changes: %j', async (change) => {
  expect(
    (await matchTourismFacility(db([{ ...row, ...change }]), input, [alias])).placeId,
  ).toBeNull();
});
it('never overrides exact-name ambiguity or applies an unapproved mapping', async () => {
  const exact = { ...row, name: input.title };
  expect(
    (await matchTourismFacility(db([exact, { ...exact, id: 'second' }]), input, [alias])).reason,
  ).toBe('AMBIGUOUS_MATCH');
  expect((await matchTourismFacility(db(), input, [])).placeId).toBeNull();
});
it('rejects duplicate mappings and unknown approval fields', () => {
  expect(() => parseTourismAliases([alias, alias])).toThrow('Duplicate approved alias');
  expect(() => parseTourismAliases([{ ...alias, decision: 'PENDING' }])).toThrow();
});
