export function tourismRecord(overrides: Record<string, unknown> = {}) {
  return {
    externalId: '0000000001',
    kind: 'place',
    regionId: 'furano',
    titleJa: '施設',
    descriptionJa: '施設の説明',
    resourceUrl: 'https://www.harp.lg.jp/opendata/dataset/2207/resource/8257/sample.csv',
    contentSha256: 'a'.repeat(64),
    sourceUpdatedAt: null,
    evidencePointer: 'csv:sample:ID=0000000001',
    latitude: 43.34,
    longitude: 142.39,
    locationStatus: 'provided',
    startDate: null,
    endDate: null,
    timezone: 'Asia/Tokyo',
    dateStatus: 'unknown',
    scheduleRaw: '2024年度',
    hoursStatus: 'historical',
    validFrom: null,
    validUntil: null,
    ...overrides,
  };
}
export function tourismBatch(
  records: unknown[],
  sourceId = 'furano-places',
  fetchedAt = new Date().toISOString(),
) {
  return { sourceId, parserVersion: 'harp-csv-v1', fetchedAt, records };
}
