import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../frontend/src/api', () => ({ api: vi.fn() }));
import { api } from '../frontend/src/api';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.clearAllMocks();
  vi.useRealTimers();
});

it('starts session and both catalog requests together and keeps successful data on partial failure', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  let finishSession!: (value: any) => void;
  const regions = [{ id: 'sapporo', name: '삿포로' }];
  vi.mocked(api).mockImplementation((path) =>
    path === '/auth/me'
      ? new Promise((resolve) => {
          finishSession = resolve;
        })
      : Promise.resolve({ data: regions }),
  );
  const fetcher = vi.fn(async () => new Response('{}', { status: 503 }));
  vi.stubGlobal('fetch', fetcher);
  const { boot, state, dismissToast } = await import('../frontend/src/store');
  const ready = boot();
  expect(api).toHaveBeenCalledWith('/auth/me');
  expect(api).toHaveBeenCalledWith('/regions');
  expect(fetcher).toHaveBeenCalledWith('/hokkaido-cities.json');
  expect(state.ready).toBe(false);
  finishSession({ user: { id: 'user', name: 'test' } });
  await ready;
  expect(state.regions).toEqual(regions);
  expect(state.ready).toBe(true);
  expect(state.toast).toContain('지역 정보를 불러오지 못했습니다');
  dismissToast();
});
