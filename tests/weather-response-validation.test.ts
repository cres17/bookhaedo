import { afterAll, expect, it, vi } from 'vitest';
import { forecast } from '../server/providers';
import { pool } from '../server/db';
afterAll(() => pool.end());
const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const data = (fields = {}) => ({
  daily: {
    time: Array.from({ length: 10 }, (_, i) =>
      new Date(Date.parse(today()) + i * 86400000).toISOString().slice(0, 10),
    ),
    temperature_2m_max: Array(10).fill(20),
    temperature_2m_min: Array(10).fill(10),
    weather_code: Array(10).fill(0),
    ...fields,
  },
});
it.each([
  { temperature_2m_max: Array(10).fill(5), temperature_2m_min: Array(10).fill(30) },
  { temperature_2m_max: Array(10).fill('20') },
  { temperature_2m_min: [10] },
  { precipitation_probability_max: Array(10).fill(999) },
  { precipitation_probability_max: Array(10).fill(-1) },
  { precipitation_sum: Array(10).fill(-1) },
  { snowfall_sum: Array(10).fill('1') },
  { wind_speed_10m_max: Array(10).fill(-10) },
  { wind_speed_10m_max: [10] },
  { weather_code: Array(10).fill(999) },
  { time: Array(10).fill(today()) },
])('rejects invalid weather and does not poison completed cache (%j)', async (fields) => {
  const request = vi.fn(async () => new Response(JSON.stringify(data(fields))));
  expect((await forecast(43.06, 141.35, today(), request)).available).toBe(false);
  request.mockImplementation(async () => new Response(JSON.stringify(data())));
  expect((await forecast(43.06, 141.35, today(), request)).available).toBe(true);
  expect((await forecast(43.06, 141.35, today(), request)).available).toBe(true);
  expect(request).toHaveBeenCalledTimes(2);
});
it('preserves valid zero values, optional nulls, and caches only parsed weather', async () => {
  const request = vi.fn(
    async () =>
      new Response(
        JSON.stringify(
          data({
            precipitation_probability_max: Array(10).fill(0),
            precipitation_sum: Array(10).fill(0),
            snowfall_sum: Array(10).fill(null),
            weather_code: Array(10).fill(null),
            wind_speed_10m_max: Array(10).fill(0),
          }),
        ),
      ),
  );
  const w = await forecast(43.06, 141.35, today(), request);
  expect(w).toMatchObject({
    available: true,
    high: 20,
    low: 10,
    precipitationProbability: 0,
    precipitationMm: 0,
    snowfallCm: null,
    windSpeedKmh: 0,
  });
  await forecast(43.06, 141.35, today(), request);
  expect(request).toHaveBeenCalledOnce();
});
