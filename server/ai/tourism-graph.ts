import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { z } from 'zod';
import { buildDayPlans, center, nearestOrder } from '../day-alternatives.js';
import { straightDistance } from '../domain.js';
import {
  searchTourism,
  type SearchResult,
  type TourismSearchInput,
  type Evidence,
} from '../tourism-search.js';
import { forecast } from '../providers.js';
import { routeSegment } from '../routing.js';
import { adverseWeather, indoorEvidence } from '../../shared/weather-policy.js';
import { mapConcurrent } from '../provider-cache.js';

export type GraphInput = {
  requestId: string;
  userId: string;
  tripId: string;
  dayId: string;
  date: string;
  revision: number;
  items: any[];
  regionId: string;
  transportMode: string;
  count: number;
  keepPlaceIds: string[];
  interests: string;
  strategy?: string;
};
export type Plan = {
  id: string;
  label: string;
  reason: string;
  places: any[];
  distanceMeters: number;
  evidenceIds: string[];
};
const draftSchema = z
  .object({
    placeIds: z.array(z.string()).min(2).max(6),
    evidenceIds: z.array(z.string()).max(24),
  })
  .strict();
// A model adapter may return ONLY retrieved IDs. No SQL, URLs, writes, or identity fields.
export type DraftGenerator = (
  context: {
    candidates: { id: string; name: string }[];
    evidence: Evidence[];
    keepPlaceIds: string[];
    count: number;
    interests: string;
  },
  signal: AbortSignal,
) => Promise<unknown>;
export type GraphDependencies = {
  search: (input: TourismSearchInput) => Promise<SearchResult>;
  weather: typeof forecast;
  route: typeof routeSegment;
  generate?: DraftGenerator;
  timeoutMs?: number;
};
const State = Annotation.Root({
  input: Annotation<GraphInput>(),
  candidates: Annotation<any[]>(),
  evidence: Annotation<Evidence[]>(),
  referenceEvents: Annotation<Evidence[]>(),
  snapshotIds: Annotation<string[]>(),
  weather: Annotation<any>(),
  plans: Annotation<Plan[]>(),
  preview: Annotation<any>(),
  attempts: Annotation<number>(),
  valid: Annotation<boolean>(),
  warnings: Annotation<string[]>(),
});
type GraphState = typeof State.State;
async function bounded<T>(
  work: (signal: AbortSignal) => Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(controller.signal).catch(() => fallback),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve(fallback);
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
const isUsable = (p: any) =>
  p.category !== 'LODGING' &&
  !['private', 'no'].includes(p.tags?.access) &&
  p.tags?.disused !== 'yes' &&
  p.tags?.abandoned !== 'yes' &&
  p.openingHours !== 'closed' &&
  p.tags?.opening_hours !== 'closed';
function evidenceFor(places: any[], evidence: Evidence[]) {
  const ids = new Set(places.map((p) => p.id));
  return evidence
    .filter((e) => e.kind === 'place' && e.placeId && ids.has(e.placeId))
    .map((e) => e.id);
}
function attachKept(plan: any, s: GraphState): Plan {
  const kept = s.input.items.filter((p) => s.input.keepPlaceIds.includes(p.id));
  const additions = nearestOrder(
    plan.places.filter((p: any) => !kept.some((k) => k.id === p.id)),
    kept.at(-1) ?? center(s.input.items),
  ).slice(0, s.input.count - kept.length);
  const places = [...kept, ...additions];
  return {
    ...plan,
    places,
    evidenceIds: evidenceFor(places, s.evidence),
    distanceMeters: places.reduce(
      (sum, p, i) => sum + straightDistance(i ? places[i - 1] : center(s.input.items), p),
      0,
    ),
  };
}
function rules(s: GraphState): Plan[] {
  const standard = buildDayPlans(s.candidates, s.input.items, s.weather, s.input.count).map(
    (p: any) => attachKept(p, s),
  );
  const current = new Set(s.input.items.map((p) => p.id));
  const linked = new Set(
    s.evidence.filter((e) => e.kind === 'place' && e.placeId).map((e) => e.placeId),
  );
  const kept = s.input.items.filter((p) => s.input.keepPlaceIds.includes(p.id));
  const anchor = center(s.input.items);
  const ranked = s.candidates
    .filter((p) => !current.has(p.id) && (!adverseWeather(s.weather) || indoorEvidence(p)))
    .sort(
      (a, b) =>
        Number(linked.has(b.id)) - Number(linked.has(a.id)) ||
        straightDistance(anchor, a) - straightDistance(anchor, b),
    );
  if ((ranked.length || kept.length >= 2) && [...ranked, ...kept].some((p) => linked.has(p.id))) {
    // Select by evidence rank before attachKept orders the remaining stops by distance.
    const places = ranked.slice(0, s.input.count - kept.length);
    standard.unshift(
      attachKept(
        {
          id: 'KNOWLEDGE',
          label: '공개 자료를 참고한 코스',
          reason: '연결이 확인된 지자체 시설 자료를 우선하고 거리와 예보를 함께 확인했어요.',
          places,
        },
        s,
      ),
    );
  }
  return standard.filter((p) => p.places.length >= 2);
}
export function validateTourismPlans(
  s: Pick<GraphState, 'input' | 'plans' | 'candidates' | 'evidence' | 'weather'>,
) {
  const pool = new Map([...s.candidates, ...s.input.items].map((p) => [p.id, p]));
  const evidence = new Map(s.evidence.map((e) => [e.id, e]));
  const kept = s.input.items.filter((p) => s.input.keepPlaceIds.includes(p.id)).map((p) => p.id);
  return (
    s.plans.length > 0 &&
    s.plans.every((plan) => {
      const ids = plan.places.map((p) => p.id);
      return (
        ids.length >= 2 &&
        ids.length <= s.input.count &&
        new Set(ids).size === ids.length &&
        (plan.id !== 'KNOWLEDGE' || plan.evidenceIds.length > 0) &&
        JSON.stringify(ids.filter((id) => kept.includes(id))) === JSON.stringify(kept) &&
        plan.places.every(
          (p) =>
            pool.has(p.id) &&
            isUsable(pool.get(p.id)) &&
            straightDistance(center(s.input.items), pool.get(p.id)) <= 20000 &&
            (kept.includes(p.id) ||
              !adverseWeather(s.weather) ||
              plan.id === 'NEARBY' ||
              indoorEvidence(pool.get(p.id))),
        ) &&
        plan.evidenceIds.every((id) => {
          const e = evidence.get(id);
          return e?.kind === 'place' && !!e.placeId && ids.includes(e.placeId);
        })
      );
    })
  );
}
export function createTourismGraph(deps: GraphDependencies) {
  const timeout = deps.timeoutMs ?? 10000;
  return new StateGraph(State)
    .addNode('interpret', (s) => ({
      attempts: 0,
      candidates: [],
      evidence: [],
      referenceEvents: [],
      snapshotIds: [],
      plans: [],
      preview: null,
      valid: false,
      warnings:
        s.input.keepPlaceIds.length === s.input.count
          ? [
              '유지할 장소로 방문 수가 채워져 새 장소를 추가하지 않습니다. 기존 장소의 경로와 출처를 확인해주세요.',
            ]
          : [],
      input: { ...s.input, interests: s.input.interests.trim().slice(0, 200) },
    }))
    .addNode('retrieve', async (s) => {
      const result = await deps.search({
        anchor: center(s.input.items),
        regionId: s.input.regionId,
        date: s.input.date,
        radius: Math.min(20000, 10000 + s.attempts * 5000),
        interests: s.input.interests,
        ...(s.attempts ? { snapshotIds: s.snapshotIds } : {}),
      });
      return {
        ...result,
        referenceEvents: result.referenceEvents ?? [],
        candidates: result.candidates.filter(isUsable),
        attempts: s.attempts + 1,
      };
    })
    .addNode('weather_lookup', async (s) => ({
      weather: await bounded(
        (signal) =>
          deps.weather(
            center(s.input.items).latitude,
            center(s.input.items).longitude,
            s.input.date,
            fetch,
            signal,
          ),
        timeout,
        { available: false, notice: '예보를 확인하지 못해 거리와 장소 자료를 참고합니다.' } as any,
      ),
    }))
    .addNode('generate', async (s) => {
      const plans = rules(s);
      if (!deps.generate) return { plans };
      const unknownDraft = await bounded(
        (signal) =>
          deps.generate!(
            {
              candidates: s.candidates.map((p) => ({ id: p.id, name: p.name })),
              evidence: s.evidence.slice(0, 24),
              keepPlaceIds: s.input.keepPlaceIds,
              count: s.input.count,
              interests: s.input.interests,
            },
            signal,
          ),
        timeout,
        null,
      );
      const draft = draftSchema.safeParse(unknownDraft);
      if (!draft.success)
        return { plans, warnings: ['생성 결과를 검증하지 못해 기본 추천을 사용했어요.'] };
      const allowed = new Map([...s.candidates, ...s.input.items].map((p) => [p.id, p]));
      const generated: Plan = {
        id: 'KNOWLEDGE',
        label: '공개 자료를 참고한 코스',
        reason: '조회한 장소와 출처를 바탕으로 만든 제안입니다. 출처에서 운영 정보를 확인해주세요.',
        places: draft.data.placeIds.map((id) => allowed.get(id) ?? { id }),
        distanceMeters: 0,
        evidenceIds: draft.data.evidenceIds,
      };
      if (!validateTourismPlans({ ...s, plans: [generated] }))
        return { plans, warnings: ['조회 범위 밖의 생성 결과를 제외하고 기본 추천을 사용했어요.'] };
      generated.distanceMeters = generated.places.reduce(
        (n, p, i) => n + straightDistance(i ? generated.places[i - 1] : center(s.input.items), p),
        0,
      );
      return { plans: [generated, ...plans.filter((p) => p.id !== 'KNOWLEDGE')] };
    })
    .addNode('validate', (s) => {
      const plans = s.plans.filter((p) => validateTourismPlans({ ...s, plans: [p] }));
      return {
        plans,
        valid: s.input.strategy ? plans.some((p) => p.id === s.input.strategy) : plans.length > 0,
      };
    })
    .addNode('route_preview', async (s) => {
      if (!s.input.strategy) return { preview: null };
      const plan = s.plans.find((p) => p.id === s.input.strategy);
      if (!plan) return { preview: null };
      const segments = await mapConcurrent(plan.places.slice(1), 5, async (p, i) =>
        bounded(
          (signal) =>
            deps.route(
              plan.places[i],
              p,
              s.input.transportMode,
              fetch,
              new Date(s.input.date + 'T09:00:00+09:00').toISOString(),
              signal,
            ),
          timeout,
          {
            from: plan.places[i].id,
            to: p.id,
            source: 'unavailable',
            distanceMeters: null,
            durationSeconds: null,
          } as any,
        ),
      );
      const complete =
        segments.length === plan.places.length - 1 &&
        segments.every(
          (r) =>
            ['valhalla', 'google'].includes(r.source) &&
            Number.isFinite(r.distanceMeters) &&
            Number.isFinite(r.durationSeconds) &&
            r.distanceMeters >= 0 &&
            r.durationSeconds! >= 0,
        );
      return {
        preview: {
          plan,
          segments,
          complete,
          distanceMeters: complete ? segments.reduce((n, r) => n + r.distanceMeters, 0) : null,
          durationSeconds: complete ? segments.reduce((n, r) => n + r.durationSeconds!, 0) : null,
        },
      };
    })
    .addEdge(START, 'interpret')
    .addEdge('interpret', 'retrieve')
    .addConditionalEdges('retrieve', (s) => (s.attempts === 1 ? 'weather_lookup' : 'generate'), [
      'weather_lookup',
      'generate',
    ])
    .addEdge('weather_lookup', 'generate')
    .addEdge('generate', 'validate')
    .addConditionalEdges(
      'validate',
      (s) => (!s.valid && s.attempts < 3 ? 'retrieve' : 'route_preview'),
      ['retrieve', 'route_preview'],
    )
    .addEdge('route_preview', END)
    .compile();
}
const graph = createTourismGraph({ search: searchTourism, weather: forecast, route: routeSegment });
export function formatTourismResult(
  input: GraphInput,
  s: Pick<
    GraphState,
    'plans' | 'evidence' | 'snapshotIds' | 'weather' | 'attempts' | 'preview' | 'warnings'
  > & { referenceEvents?: Evidence[] },
) {
  const cited = new Set(s.plans.flatMap((p) => p.evidenceIds));
  const evidence = s.evidence.filter((e) => e.kind === 'event' || cited.has(e.id));
  const hasPlaceEvidence = evidence.some((e) => e.kind === 'place' && cited.has(e.id));
  return {
    requestId: input.requestId,
    tripId: input.tripId,
    date: input.date,
    expectedRevision: input.revision,
    expectedPlaceIds: input.items.map((p) => p.id),
    snapshotIds: s.snapshotIds,
    status: !s.plans.length ? 'NO_CANDIDATES' : hasPlaceEvidence ? 'READY' : 'CATALOG_FALLBACK',
    engine: 'langgraph',
    generationMode: 'rules',
    searchAttempts: s.attempts,
    weather: s.weather,
    weatherMode: adverseWeather(s.weather) ? 'ADVERSE' : s.weather?.available ? 'FAIR' : 'UNKNOWN',
    plans: s.plans,
    preview: s.preview,
    evidence,
    referenceEvents: s.referenceEvents ?? [],
    warnings: s.warnings,
    notice: !s.plans.length
      ? '조건에 맞는 코스를 만들지 못했어요. 유지할 장소나 방문 수를 바꿔 다시 확인해주세요.'
      : hasPlaceEvidence
        ? '수집 시점과 자료 적용 기간은 다릅니다. 미확정 행사는 참고 정보이며 현재 운영 여부는 원문에서 확인해주세요. 확정 전에는 일정이 바뀌지 않아요.'
        : evidence.some((e) => e.kind === 'event')
          ? '행사 자료는 참고 정보이며 코스는 기존 장소와 예보로 구성했습니다. 개최 여부는 원문에서 확인해주세요. 확정 전에는 일정이 바뀌지 않아요.'
          : '코스에 연결할 유효한 공개 자료가 없어 기존 장소와 예보를 바탕으로 추천합니다. 확정 전에는 일정이 바뀌지 않아요.',
  };
}
export async function proposeTourism(input: GraphInput) {
  const s = await graph.invoke({ input }, { recursionLimit: 20 });
  return formatTourismResult(input, s);
}
