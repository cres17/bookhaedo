import { it, expect, vi, afterEach } from 'vitest';
vi.mock('../server/db', () => ({ pool: { query: vi.fn() } }));
import { pool } from '../server/db';
import { searchAssist } from '../server/search-assist';
import { validateProduction } from '../server/config';
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it('한글 검색을 이름·위치가 일치하는 기존 장소에 연결한다', async () => {
  vi.stubEnv('GOOGLE_MAPS_SERVER_API_KEY', 'test');
  const local = { id: 'catalog', nameJa: '札幌市時計台', latitude: 43.0625, longitude: 141.3536 };
  vi.mocked(pool.query).mockResolvedValue({ rows: [local] } as any);
  const fetcher = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        places: [
          {
            id: 'google',
            displayName: { text: local.nameJa },
            location: { latitude: local.latitude, longitude: local.longitude },
          },
        ],
      }),
    ),
  );
  const result = await searchAssist('삿포로 시계탑', 'sapporo', fetcher);
  expect(result.status).toBe('MATCHED');
  expect(result.data[0].id).toBe('catalog');
  expect(pool.query).toHaveBeenCalledTimes(1);
  expect(String(vi.mocked(pool.query).mock.calls[0][0])).toContain('150');
});
it('외부 검색 오류와 이름 불일치는 가상 장소를 만들지 않는다', async () => {
  vi.stubEnv('GOOGLE_MAPS_SERVER_API_KEY', 'test');
  expect(
    (
      await searchAssist(
        '시계탑',
        undefined,
        vi.fn().mockResolvedValue(new Response('{}', { status: 403 })),
      )
    ).status,
  ).toBe('UNAVAILABLE');
  vi.mocked(pool.query).mockResolvedValue({
    rows: [{ id: 'x', nameJa: '別の場所', latitude: 43, longitude: 141 }],
  } as any);
  const r = await searchAssist(
    '시계탑',
    undefined,
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          places: [{ displayName: { text: '時計台' }, location: { latitude: 43, longitude: 141 } }],
        }),
      ),
    ),
  );
  expect(r.status).toBe('NO_MATCH');
  expect(r.data).toEqual([]);
});
it('production은 개발용 키 공유와 공공 데모 라우터 사용을 거절한다', () => {
  expect(() => validateProduction({ NODE_ENV: 'production' })).toThrow('DATABASE_URL');
  const env = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://db/app',
    APP_ORIGINS: 'https://travel.example',
    GOOGLE_MAPS_SERVER_API_KEY: 'server',
    VITE_GOOGLE_MAPS_API_KEY: 'browser',
    VALHALLA_BASE_URL: 'http://routing.internal',
  };
  expect(() => validateProduction(env)).not.toThrow();
  expect(() => validateProduction({ ...env, GOOGLE_MAPS_SERVER_API_KEY: 'browser' })).toThrow(
    'separate',
  );
  expect(() =>
    validateProduction({ ...env, VALHALLA_BASE_URL: 'https://valhalla1.openstreetmap.de' }),
  ).toThrow('Valhalla');
});
