import { z } from 'zod';
const finite = z.number().finite();
const optionalMetric = (max?: number) =>
  z
    .array((max === undefined ? finite.nonnegative() : finite.min(0).max(max)).nullable())
    .length(10)
    .optional();
const dailySchema = z.object({
  time: z.array(z.string()).length(10),
  temperature_2m_max: z.array(finite).length(10),
  temperature_2m_min: z.array(finite).length(10),
  weather_code: z
    .array(
      z
        .number()
        .int()
        .refine((code) =>
          [
            0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82,
            85, 86, 95, 96, 99,
          ].includes(code),
        )
        .nullable(),
    )
    .length(10)
    .optional(),
  precipitation_sum: optionalMetric(),
  snowfall_sum: optionalMetric(),
  precipitation_probability_max: optionalMetric(100),
  wind_speed_10m_max: optionalMetric(),
});
export type WeatherResponse = { daily: z.infer<typeof dailySchema> };
export function parseWeatherResponse(raw: unknown, today: string): WeatherResponse {
  const data = z.object({ daily: dailySchema }).parse(raw);
  for (let i = 0; i < 10; i++)
    if (
      data.daily.time[i] !==
        new Date(Date.parse(today) + i * 86400000).toISOString().slice(0, 10) ||
      data.daily.temperature_2m_max[i] < data.daily.temperature_2m_min[i]
    )
      throw Error('INVALID_WEATHER');
  return data;
}
