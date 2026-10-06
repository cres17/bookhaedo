import { recommendationRequestBudget } from '../operation-budget.js';
import { pool } from '../db.js';
import { Router } from 'express';
import { z } from 'zod';
import { dateOnly } from '../domain.js';
import { dayContext } from '../day-alternatives.js';
import { wrap } from '../http/async-handler.js';
import { rateLimits } from '../http/rate-limit.js';
import { proposeTourism, formatTourismResult } from '../ai/tourism-graph.js';
export const aiRecommendations = Router();
export const recommendationInput = z
  .object({
    count: z.number().int().min(3).max(6).default(4),
    keepPlaceIds: z.array(z.string().uuid()).max(5).default([]),
    interests: z.string().trim().max(200).default(''),
    strategy: z.enum(['KNOWLEDGE', 'AUTO', 'INDOOR', 'NEARBY']).optional(),
  })
  .strict()
  .refine(
    (i) =>
      new Set(i.keepPlaceIds).size === i.keepPlaceIds.length && i.keepPlaceIds.length <= i.count,
    '유지할 장소는 중복 없이 방문 장소 수 이내로 선택해주세요.',
  );
// createApp applies requireAuth and requireTrip before this router.
aiRecommendations.post(
  '/api/trips/:id/days/:date/ai-recommendations',
  rateLimits.aiRecommendation(),
  wrap(async (req, res) => {
    const budget = recommendationRequestBudget(req, res);
    const date = dateOnly.parse(req.params.date),
      input = recommendationInput.parse(req.body);
    const context = await dayContext(req.params.id as string, date, false, pool, budget.signal);
    if (!context) return res.status(404).json({ error: '여행 날짜를 찾을 수 없어요.' });
    if (input.keepPlaceIds.some((id) => !context.items.some((p: any) => p.id === id)))
      return res.status(400).json({ error: '현재 일정에 있는 장소만 유지할 수 있어요.' });
    const graphInput = {
      requestId: res.locals.requestId,
      userId: res.locals.user.id,
      tripId: req.params.id as string,
      dayId: context.dayId,
      date,
      revision: context.revision,
      items: context.items,
      regionId: context.items[0]?.regionId ?? '',
      transportMode: context.transportMode,
      ...input,
    };
    if (!context.items.length)
      return res.json({
        ...formatTourismResult(graphInput, {
          plans: [],
          preview: null,
          evidence: [],
          snapshotIds: [],
          attempts: 0,
          weather: { available: false },
          warnings: [],
        }),
        status: 'NEEDS_ANCHOR',
        notice: '첫 장소를 담으면 해당 지역의 공개 자료를 함께 확인할 수 있어요.',
      });
    const result = await proposeTourism(graphInput, budget.signal);
    const current = await dayContext(req.params.id as string, date, false, pool, budget.signal);
    if (
      !current ||
      current.revision !== context.revision ||
      current.transportMode !== context.transportMode ||
      JSON.stringify(current.items.map((p: any) => p.id)) !==
        JSON.stringify(context.items.map((p: any) => p.id))
    )
      return res.status(409).json({
        code: 'RECOMMENDATION_CONTEXT_CHANGED',
        error: '일정이나 이동 수단이 변경됐어요. 추천을 다시 확인해주세요.',
      });
    if (input.strategy && !result.preview && result.status !== 'NO_CANDIDATES')
      return res.status(422).json({
        code: 'STRATEGY_UNAVAILABLE',
        error:
          '이 조건에서는 선택한 코스를 만들 수 없어요. 다른 코스를 선택하거나 추천 조건을 바꿔주세요.',
        availableStrategies: result.plans.map((p) => p.id),
      });
    res.set('Cache-Control', 'no-store').json(result);
  }),
);
