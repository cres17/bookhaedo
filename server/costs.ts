import { z } from 'zod';
const positive = z.number().positive().max(1000000).nullable().optional();
export const costInput = z.object({
  fuelEfficiency: positive,
  fuelPrice: positive,
  taxiBase: positive,
  taxiIncludedKm: z.number().min(0).max(100).nullable().optional(),
  taxiPerKm: positive,
  taxiPerMinute: z.number().min(0).max(1000000).nullable().optional(),
  source: z.string().max(300).optional(),
  asOf: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export function estimateCosts(
  distanceMeters: number | null,
  durationSeconds: number | null,
  settings: any = {},
) {
  const km = distanceMeters === null ? null : distanceMeters / 1000;
  return {
    fuel:
      km !== null && settings.fuelEfficiency > 0 && settings.fuelPrice > 0
        ? Math.ceil((km / settings.fuelEfficiency) * settings.fuelPrice)
        : null,
    taxi:
      km !== null &&
      durationSeconds !== null &&
      settings.taxiBase > 0 &&
      settings.taxiPerKm > 0 &&
      settings.taxiPerMinute >= 0 &&
      settings.taxiPerMinute !== null &&
      settings.taxiIncludedKm >= 0 &&
      settings.taxiIncludedKm !== null
        ? Math.ceil(
            settings.taxiBase +
              Math.max(0, km - settings.taxiIncludedKm) * settings.taxiPerKm +
              (durationSeconds / 60) * settings.taxiPerMinute,
          )
        : null,
    currency: 'JPY',
    basis: settings,
    notice:
      '사용자 입력 기준의 단순 추정 · 실제 운임, 저속 시간 병산, 할증, 대여료와 다를 수 있어요.',
  };
}
