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
  category: alias.catalogCategory,
  address: alias.catalogAddress,
  latitude: alias.catalogLatitude,
  longitude: alias.catalogLongitude,
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

it('allows explicit null websites only with a complete reviewed catalog fingerprint', () => {
  const nullable = {
    ...alias,
    catalogWebsite: null,
    catalogCategory: 'ATTRACTION',
    catalogAddress: null,
    catalogLatitude: 41.9442139,
    catalogLongitude: 140.6157716,
  };
  expect(parseTourismAliases([nullable])[0].catalogWebsite).toBeNull();
  for (const field of [
    'catalogWebsite',
    'catalogCategory',
    'catalogAddress',
    'catalogLatitude',
    'catalogLongitude',
  ]) {
    const missing: any = { ...nullable };
    delete missing[field];
    expect(() => parseTourismAliases([missing])).toThrow();
  }
  for (const invalid of [
    { catalogWebsite: '' },
    { catalogLatitude: NaN },
    { catalogLongitude: 180 },
    { catalogCategory: '' },
  ]) {
    expect(() => parseTourismAliases([{ ...nullable, ...invalid }])).toThrow();
  }
});
it.each([
  { category: 'OTHER' },
  { address: 'changed' },
  { latitude: 41.944214 },
  { longitude: 140.615772 },
  { website: 'https://example.test' },
  { website: undefined },
])('rejects catalog fingerprint drift for a null-website alias: %j', async (change) => {
  const nullable: any = {
    ...alias,
    catalogWebsite: null,
    catalogCategory: 'ATTRACTION',
    catalogAddress: null,
    catalogLatitude: 41.9442139,
    catalogLongitude: 140.6157716,
  };
  const candidate: any = {
    ...row,
    website: null,
    category: nullable.catalogCategory,
    address: null,
    latitude: nullable.catalogLatitude,
    longitude: nullable.catalogLongitude,
    ...change,
  };
  expect((await matchTourismFacility(db([candidate]), input, [nullable])).placeId).toBeNull();
});
it('applies both approved Hokuto spelling aliases, but never conflates the viewpoint and campsite', async () => {
  const hokuto = (await approvedTourismAliases()).filter((a) => a.sourceId === 'hokuto-places');
  expect(hokuto).toHaveLength(2);
  for (const a of hokuto) {
    const request = {
      ...input,
      sourceId: a.sourceId,
      externalId: a.externalId,
      contentSha256: a.contentSha256,
      title: a.title,
      regionId: a.regionId,
      latitude: a.catalogLatitude,
      longitude: a.catalogLongitude,
    };
    const candidate = {
      id: a.placeId,
      name: a.catalogName,
      regionId: a.regionId,
      distanceMeters: 104,
      category: a.catalogCategory,
      address: a.catalogAddress,
      website: a.catalogWebsite,
      latitude: a.catalogLatitude,
      longitude: a.catalogLongitude,
    };
    expect((await matchTourismFacility(db([candidate]), request, hokuto)).placeId).toBe(a.placeId);
    const other = hokuto.find((b) => b.placeId !== a.placeId)!;
    expect(
      (await matchTourismFacility(db([{ ...candidate, id: other.placeId }]), request, hokuto))
        .placeId,
    ).toBeNull();
  }
});
