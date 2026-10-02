import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
it('retries a failed alias file read and shares the next successful load', async () => {
  const raw = readFileSync(
    new URL('../ops/tourism/approved-aliases.json', import.meta.url),
    'utf8',
  );
  const readFile = vi
    .fn()
    .mockRejectedValueOnce(new Error('temporary read failure'))
    .mockResolvedValue(raw);
  vi.resetModules();
  vi.doMock('node:fs/promises', () => ({ readFile }));
  try {
    const { approvedTourismAliases } = await import('../server/tourism-matching');
    await expect(approvedTourismAliases()).rejects.toThrow('temporary read failure');
    const first = approvedTourismAliases();
    const second = approvedTourismAliases();
    expect(second).toBe(first);
    await expect(first).resolves.toHaveLength(3);
    expect(readFile).toHaveBeenCalledTimes(2);
  } finally {
    vi.doUnmock('node:fs/promises');
    vi.resetModules();
  }
});

it('does not require the alias file for a valid exact-name facility match', async () => {
  const readFile = vi.fn().mockRejectedValue(new Error('alias file unavailable'));
  vi.resetModules();
  vi.doMock('node:fs/promises', () => ({ readFile }));
  try {
    const { matchTourismFacility } = await import('../server/tourism-matching');
    const match = await matchTourismFacility(
      { query: vi.fn(async () => ({ rows: [{ id: 'exact', name: '施設' }] })) } as any,
      {
        sourceId: 'furano-places',
        externalId: 'test',
        contentSha256: 'e'.repeat(64),
        kind: 'place',
        title: '施設',
        regionId: 'furano',
        latitude: 43.34,
        longitude: 142.39,
      },
    );
    expect(match).toMatchObject({ placeId: 'exact', reason: 'MATCHED' });
    expect(readFile).not.toHaveBeenCalled();
  } finally {
    vi.doUnmock('node:fs/promises');
    vi.resetModules();
  }
});
