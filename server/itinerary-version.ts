import { z } from 'zod';

export const revisionInput = z.number().int().nonnegative();
export function requireRevision(body: any, actual: number, res: any): boolean {
  if (body?.expectedRevision === undefined) {
    res
      .status(428)
      .json({ code: 'REVISION_REQUIRED', error: '일정을 새로 불러온 뒤 다시 저장해주세요.' });
    return false;
  }
  const expected = revisionInput.parse(body.expectedRevision);
  if (expected !== actual) {
    res.status(409).json({
      code: 'STALE_ITINERARY',
      error: '다른 화면에서 일정이 변경됐어요. 최신 일정을 확인한 뒤 다시 시도해주세요.',
      currentRevision: actual,
    });
    return false;
  }
  return true;
}
