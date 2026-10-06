<script setup lang="ts">
import PanelHeader from './PanelHeader.vue';
import { computed, ref, onMounted, onUnmounted, watch } from 'vue';
import type { Place } from '../types';
import { api, json, ApiError } from '../api';
import { adverseWeather, weatherReason } from '../../../shared/weather-policy';
const props = defineProps<{
  tripId: string;
  date: string;
  revision: number;
  transportMode: string;
  items: Place[];
  weather: any;
  disabled: boolean;
}>();
const emit = defineEmits<{ saved: []; refresh: []; preview: [value: any]; dismiss: [] }>();
const opened = ref(false),
  result = ref<any>(null),
  busy = ref(false),
  saving = ref(false),
  error = ref(''),
  count = ref(4),
  selected = ref(''),
  useKnowledge = ref(false),
  interests = ref(''),
  keepPlaceIds = ref<string[]>([]),
  conditionsChanged = ref(false),
  outcomeUnknown = ref(false);
const mobile = ref(false),
  media = window.matchMedia('(max-width:760px)');
let generation = 0;
let pending: AbortController | undefined;
const cancelPending = () => {
  pending?.abort();
  pending = undefined;
};
let resultConditions = '';
const resize = () => {
  mobile.value = media.matches;
};
onMounted(() => {
  resize();
  media.addEventListener('change', resize);
});
onUnmounted(() => {
  generation++;
  cancelPending();
  media.removeEventListener('change', resize);
});
const endpoint = computed(() => `/trips/${props.tripId}/days/${props.date}/day-alternatives`);
const signature = computed(
  () => `${props.tripId}|${props.date}|${props.revision}|${props.transportMode}`,
);
const conditions = computed(() =>
  JSON.stringify({
    count: count.value,
    useKnowledge: useKnowledge.value,
    ...(useKnowledge.value
      ? { interests: interests.value.trim(), keepPlaceIds: [...keepPlaceIds.value].sort() }
      : {}),
  }),
);
watch(
  conditions,
  () => {
    if (!opened.value) return;
    generation++;
    cancelPending();
    resultConditions = '';
    result.value = null;
    busy.value = false;
    selected.value = '';
    error.value = '';
    conditionsChanged.value = true;
    emit('preview', null);
  },
  { flush: 'sync' },
);
watch(signature, () => {
  generation++;
  cancelPending();
  opened.value = false;
  result.value = null;
  busy.value = false;
  selected.value = '';
  keepPlaceIds.value = [];
  error.value = '';
  resultConditions = '';
  conditionsChanged.value = false;
  emit('preview', null);
});
const weatherCopy = computed(() =>
  adverseWeather(props.weather)
    ? `${weatherReason(props.weather)} 예보까지 반영해요.`
    : '맑은 날에도 동선을 새로 짤 수 있어요.',
);
async function load(strategy = '') {
  if (outcomeUnknown.value) return;
  cancelPending();
  const controller = new AbortController();
  pending = controller;
  const g = ++generation;
  const requestedConditions = conditions.value;
  busy.value = true;
  conditionsChanged.value = false;
  const previous = resultConditions === requestedConditions ? result.value : null;
  resultConditions = previous ? requestedConditions : '';
  error.value = '';
  selected.value = strategy;
  result.value = previous ? { ...previous, preview: null } : null;
  emit('preview', null);
  try {
    const q = new URLSearchParams({
      count: String(count.value),
      ...(strategy ? { strategy } : {}),
    });
    const data = useKnowledge.value
      ? await api(`/trips/${props.tripId}/days/${props.date}/ai-recommendations`, {
          ...json('POST', {
            count: count.value,
            interests: interests.value,
            keepPlaceIds: keepPlaceIds.value,
            ...(strategy ? { strategy } : {}),
          }),
          signal: controller.signal,
        })
      : await api(endpoint.value + '?' + q, { signal: controller.signal });
    if (g === generation && requestedConditions === conditions.value) {
      resultConditions = requestedConditions;
      result.value = data;
      emit(
        'preview',
        data.preview ? { places: data.preview.plan.places, segments: data.preview.segments } : null,
      );
    }
  } catch (e: any) {
    if (g === generation && !controller.signal.aborted) error.value = e.message;
  } finally {
    if (pending === controller) pending = undefined;
    if (g === generation) busy.value = false;
  }
}
async function open() {
  opened.value = true;
  await load();
}
function close() {
  if (saving.value) return;
  generation++;
  cancelPending();
  opened.value = false;
  result.value = null;
  busy.value = false;
  selected.value = '';
  resultConditions = '';
  conditionsChanged.value = false;
  emit('preview', null);
}
async function replaceDay() {
  const preview = result.value?.preview;
  if (
    !preview ||
    outcomeUnknown.value ||
    busy.value ||
    saving.value ||
    props.disabled ||
    resultConditions !== conditions.value ||
    result.value.tripId !== props.tripId ||
    result.value.date !== props.date
  )
    return;
  saving.value = true;
  error.value = '';
  try {
    await api(endpoint.value, {
      ...json('PATCH', {
        placeIds: preview.plan.places.map((p: any) => p.id),
        expectedPlaceIds: result.value.expectedPlaceIds,
        expectedRevision: result.value.expectedRevision,
        ...(result.value.transportMode
          ? { expectedTransportMode: result.value.transportMode }
          : {}),
      }),
      // Transport wait only: aborting this fetch does not assert that COMMIT was cancelled.
      signal: AbortSignal.timeout(30000),
    });
    saving.value = false;
    close();
    emit('saved');
  } catch (e: any) {
    if (!result.value) return;
    result.value = { ...result.value, preview: null };
    selected.value = '';
    emit('preview', null);
    if (!(e instanceof ApiError) || e.status >= 500) {
      outcomeUnknown.value = true;
      error.value = '저장 응답을 확인하지 못했어요. 다시 저장하기 전에 현재 일정을 확인해주세요.';
    } else
      error.value =
        e.status === 409
          ? '일정이나 이동 수단이 변경됐어요. 최신 일정을 확인하고 코스를 다시 선택해주세요.'
          : e.message;
  } finally {
    saving.value = false;
  }
}
async function checkSavedState() {
  if (saving.value) return;
  saving.value = true;
  try {
    await api('/trips/' + props.tripId, { signal: AbortSignal.timeout(15000) });
    outcomeUnknown.value = false;
    saving.value = false;
    close();
    emit('refresh');
  } catch (e: any) {
    error.value = '현재 일정을 확인하지 못했어요. 잠시 후 다시 확인해주세요.';
  } finally {
    saving.value = false;
  }
}
const km = (m: number | null) => (m === null ? '확인 불가' : `${(m / 1000).toFixed(1)}km`);
const time = (s: number | null) => (s === null ? '확인 불가' : `${Math.round(s / 60)}분`);
</script>
<template>
  <section class="day-plan-entry">
    <div class="day-entry-copy">
      <PanelHeader
        title="하루 코스를 통째로 다시 짜볼까요?"
        compact
        close-label="일정 추천 숨기기"
        @close="emit('dismiss')"
      />
      <p>{{ weatherCopy }} 실내 중심과 가까운 곳 중심 코스를 함께 비교해보세요.</p>
    </div>
    <button class="button dark small" :disabled="disabled || !items.length" @click="open">
      하루 코스 추천
    </button>
  </section>
  <Teleport to="body" :disabled="!mobile">
    <section
      v-if="opened"
      class="day-plan-panel"
      role="region"
      aria-label="하루 코스 추천"
      tabindex="-1"
      @keydown.esc.stop="close"
    >
      <PanelHeader
        title="하루를 새로 구성해요."
        close-label="하루 코스 추천 닫기"
        :disabled="saving"
        @close="close"
      />
      <p>
        현재 일정의 중심과 선택 날짜의 예보를 기준으로 코스를 만듭니다. 확정 전에는 저장되지 않아요.
      </p>
      <label class="stop-count">
        방문 장소 수
        <select
          v-model.number="count"
          :disabled="busy || saving || outcomeUnknown"
          @change="
            keepPlaceIds = keepPlaceIds.slice(0, count);
            load();
          "
        >
          <option :value="3">3곳</option>
          <option :value="4">4곳</option>
          <option :value="5">5곳</option>
          <option :value="6">6곳</option>
        </select>
      </label>
      <fieldset class="knowledge-controls" :disabled="busy || saving || outcomeUnknown">
        <legend>추천에 참고할 정보</legend>
        <label class="knowledge-option">
          <input v-model="useKnowledge" type="checkbox" @change="load()" />
          공개 관광 자료 함께 보기
        </label>
        <template v-if="useKnowledge">
          <label for="tourism-interests">관심 주제</label>
          <input
            id="tourism-interests"
            v-model="interests"
            maxlength="200"
            placeholder="예: 박물관, 자연"
          />
          <p>
            주제는 공개 자료 검색에 참고합니다. 원문에 한국어 설명이 없으면 검색 결과가 제한될 수
            있어요.
          </p>
          <details>
            <summary>현재 일정에서 유지할 장소 선택</summary>
            <label v-for="place in items" :key="place.id" class="knowledge-option">
              <input
                v-model="keepPlaceIds"
                type="checkbox"
                :value="place.id"
                :disabled="
                  !keepPlaceIds.includes(place.id) && keepPlaceIds.length >= Math.min(count, 5)
                "
              />
              {{ place.name }}
            </label>
          </details>
          <button class="button subtle small" @click="load()">조건 적용해 다시 추천</button>
        </template>
      </fieldset>
      <p v-if="conditionsChanged" role="status">
        추천 조건이 바뀌었어요. 조건 적용해 다시 추천한 뒤 코스를 선택해주세요.
      </p>
      <p v-if="busy" role="status">예보와 주변 장소를 확인하고 있어요…</p>
      <p v-if="outcomeUnknown || error" role="alert" class="form-error">
        {{ error || '저장 응답을 확인하지 못했어요. 다시 저장하기 전에 현재 일정을 확인해주세요.' }}
        <button
          v-if="outcomeUnknown"
          class="button subtle small"
          :disabled="saving"
          @click="checkSavedState"
        >
          현재 일정 확인
        </button>
        <button
          v-else
          class="button subtle small"
          :disabled="saving || busy"
          @click="load(selected)"
        >
          다시 조회
        </button>
      </p>
      <template v-if="result && !busy">
        <p v-if="result.weather?.available" class="forecast">
          <strong>{{ result.date || date }} · {{ result.weather.description }}</strong>
          <span>
            {{ result.weather.low }}°–{{ result.weather.high }}° ·
            {{ result.weather.precipitationProbability ?? '—' }}% 강수
          </span>
        </p>
        <p v-else class="forecast unavailable">
          {{ result.weather?.notice || '예보 없이 거리와 장소 특성으로 추천합니다.' }}
        </p>
        <p
          v-if="result.status === 'NEEDS_ANCHOR' || result.status === 'NO_CANDIDATES'"
          role="status"
        >
          {{ result.notice }}
        </p>
        <article
          v-for="plan in result.plans"
          :key="plan.id"
          :class="['day-plan-card', { selected: selected === plan.id }]"
        >
          <div>
            <h3>{{ plan.label }}</h3>
            <p>{{ plan.reason }}</p>
          </div>
          <small>
            추천 직선 동선 {{ km(plan.distanceMeters) }} · 실제 이동시간은 미리보기에서 확인
          </small>
          <ol>
            <li v-for="place in plan.places" :key="place.id">
              <strong>{{ place.name }}</strong>
              <span
                v-if="
                  plan.evidenceIds?.some((id: string) =>
                    result.evidence?.some((e: any) => e.id === id && e.placeId === place.id),
                  )
                "
              >
                공개 자료 연결
              </span>
              <span>{{ place.category === 'RESTAURANT' ? '먹을 곳' : '가볼 곳' }}</span>
            </li>
          </ol>
          <button
            class="button subtle small"
            :disabled="saving || outcomeUnknown"
            @click="load(plan.id)"
          >
            이 코스 동선 미리보기
          </button>
        </article>
        <section v-if="result.preview" class="day-preview" aria-label="하루 코스 변경 미리보기">
          <h3>하루 코스 변경 미리보기</h3>
          <p>
            <strong>{{ result.preview.plan.label }}</strong>
            · {{ result.preview.plan.places.length }}곳
          </p>
          <p v-if="result.preview.departureNotice">{{ result.preview.departureNotice }}</p>
          <ul v-if="result.preview.mode === 'TRANSIT'" aria-label="대중교통 구간별 비교 시간">
            <li
              v-for="(segment, index) in result.preview.segments"
              :key="segment.from + ':' + segment.to"
            >
              {{ Number(index) + 1 }}번째 구간 · {{ time(segment.durationSeconds) }}
            </li>
          </ul>
          <p v-if="result.preview.complete">
            실제 경로 {{ km(result.preview.distanceMeters) }}
            <template v-if="result.preview.durationSeconds !== null">
              · 약 {{ time(result.preview.durationSeconds) }}
            </template>
          </p>
          <p v-else>
            일부 구간의 실제 경로를 확인하지 못했어요. 직선거리로 이동시간을 만들지 않습니다.
          </p>
          <small>
            기존 일정 전체를 새 코스로 바꿉니다. 새 코스에도 남는 장소의 메모·예상 비용은 유지되며,
            제외되는 장소의 메모·예상 비용은 삭제됩니다. 동행자의 일정에도 함께 반영됩니다.
          </small>
          <div class="actions">
            <button class="button dark" :disabled="saving || disabled" @click="replaceDay">
              {{ saving ? '저장 중…' : '이 코스로 하루 교체' }}
            </button>
            <button class="button subtle" :disabled="saving" @click="close">기존 일정 유지</button>
          </div>
        </section>
        <section
          v-if="result.evidence?.length"
          class="tourism-evidence"
          aria-label="공개 관광 자료 출처"
        >
          <h3>함께 확인한 공개 자료</h3>
          <p>
            시설 소개와 여행일에 겹치는 행사 자료입니다. 행사는 장소 연결과 개최 확정 여부를 별도로
            확인해야 해요.
          </p>
          <details v-for="evidence in result.evidence" :key="evidence.id">
            <summary>
              {{ evidence.title }}{{ evidence.kind === 'event' ? ' · 행사 참고' : '' }}
            </summary>
            <p>{{ evidence.excerpt }}</p>
            <p v-if="evidence.startDate">
              자료 대상 기간: {{ evidence.startDate }}–{{ evidence.endDate }}
            </p>
            <p v-if="evidence.kind === 'event' && evidence.dateStatus === 'tentative'">
              개최 미확정 · 변경 가능
            </p>
            <p v-if="evidence.kind === 'event' && evidence.dateStatus === 'confirmed'">
              자료에 시작·종료일 기재 · 개최 확정 여부는 원문 확인
            </p>
            <p v-if="evidence.locationStatus === 'missing'">
              자료에 좌표 없음 · 자동 일정 배치 제외
            </p>
            <p v-if="evidence.hoursStatus === 'historical'">
              과거 영업시간 포함 · 현재 영업시간으로 사용하지 않음
            </p>
            <p>
              최종 수집 확인: {{ evidence.fetchedAt.slice(0, 10) }} · 원문 수정 시점
              {{ evidence.sourceUpdatedAt?.slice(0, 10) || '미제공' }}
            </p>
            <a :href="evidence.resourceUrl" target="_blank" rel="noopener noreferrer">
              {{ evidence.publisher }} 원문 CSV
            </a>
            <span>·</span>
            <a :href="evidence.licenseUrl" target="_blank" rel="noopener noreferrer">
              {{ evidence.licenseId }}
            </a>
            <p>원문을 정제·발췌했습니다. 현재 방문 제한 확인을 보장하지 않습니다.</p>
          </details>
        </section>
        <section
          v-if="result.referenceEvents?.length"
          class="tourism-evidence tourism-reference"
          aria-label="지역 행사 참고 목록"
        >
          <h3>일정 확인이 필요한 행사</h3>
          <p>
            반복 개최 또는 날짜가 기재되지 않은 지역 자료입니다. 여행일에 열리는지 확인한 정보가
            아니며 자동으로 일정에 추가하지 않아요.
          </p>
          <details v-for="event in result.referenceEvents" :key="event.id">
            <summary>
              {{ event.title }} ·
              {{ event.dateStatus === 'recurring' ? '반복 개최 자료' : '날짜 미기재' }}
            </summary>
            <p>{{ event.excerpt }}</p>
            <p v-if="event.scheduleRaw">원문 일정 표현: {{ event.scheduleRaw }}</p>
            <p>
              올해 개최 여부·정확한 날짜·장소는 원문에서 다시 확인해주세요. 과거 소개가 포함될 수
              있어요.
            </p>
            <p>
              최종 수집 확인: {{ event.fetchedAt.slice(0, 10) }} · 원문 수정 시점
              {{ event.sourceUpdatedAt?.slice(0, 10) || '미제공' }}
            </p>
            <a :href="event.resourceUrl" target="_blank" rel="noopener noreferrer">
              {{ event.publisher }} 원문 CSV
            </a>
            <span>·</span>
            <a :href="event.licenseUrl" target="_blank" rel="noopener noreferrer">
              {{ event.licenseId }}
            </a>
            <p>원문을 정제·발췌했습니다. 개최 확정이나 현재 방문 가능 여부를 보장하지 않습니다.</p>
          </details>
        </section>
        <p v-for="warning in result.warnings || []" :key="warning" role="status">{{ warning }}</p>
        <p class="notice">{{ result.notice }}</p>
      </template>
    </section>
  </Teleport>
</template>
<style scoped>
.knowledge-controls {
  border: 1px solid #ccd7ce;
  border-radius: 12px;
  padding: 14px;
  display: grid;
  gap: 10px;
  margin: 12px 0;
}
.knowledge-controls legend {
  font-size: 14px;
  padding: 0 6px;
}
.knowledge-controls input[type='text'],
.knowledge-controls input:not([type]) {
  width: 100%;
  box-sizing: border-box;
  min-height: 44px;
  border: 1px solid #ccd7ce;
  padding: 10px;
  border-radius: 8px;
}
.knowledge-option {
  display: flex;
  gap: 10px;
  align-items: center;
  min-height: 44px;
  font-size: 14px;
}
.knowledge-option input {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}
.knowledge-controls summary,
.tourism-evidence summary {
  cursor: pointer;
  min-height: 44px;
  padding: 10px 0;
  box-sizing: border-box;
  line-height: 1.6;
}
.tourism-evidence {
  margin-top: 20px;
}
.tourism-reference summary {
  min-height: 44px;
  padding-block: 12px;
}
.tourism-reference {
  overflow-wrap: anywhere;
}
.tourism-evidence details {
  border-bottom: 1px solid #dbe2dc;
  overflow-wrap: anywhere;
}
.tourism-evidence a {
  color: #295c43;
  display: inline-block;
  padding: 8px 0;
}

.day-plan-entry {
  padding: 18px 20px;
  border-bottom: 1px solid #dbe2dc;
  background: linear-gradient(120deg, #f7f4e9, #eef3ef);
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
}
.day-plan-entry strong {
  font-size: 14px;
}
.day-plan-entry p {
  margin: 5px 0 0;
  color: #657367;
  font-size: 12px;
  line-height: 1.5;
}
.day-plan-panel {
  position: absolute;
  z-index: 16;
  right: 0;
  top: 0;
  bottom: 0;
  width: min(470px, 100%);
  padding: 24px;
  background: #fff;
  box-shadow: -15px 0 50px #24312d20;
  overflow: auto;
  border-radius: 22px;
  overscroll-behavior: contain;
}
.day-plan-panel header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.day-plan-panel h2 {
  font-size: 24px;
  margin: 8px 0;
}
.day-plan-panel h3 {
  font-size: 17px;
  margin: 0 0 6px;
}
.day-plan-panel p {
  font-size: 13px;
  line-height: 1.6;
}
.day-plan-panel small {
  font-size: 12px;
  line-height: 1.5;
  color: #627067;
}
.stop-count {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 18px 0;
  font-size: 13px;
}
.stop-count select {
  padding: 9px 30px 9px 12px;
  border: 1px solid #ccd7ce;
  border-radius: 10px;
  background: #fff;
}
.forecast {
  padding: 14px;
  background: #eef4f0;
  border-radius: 14px;
  display: grid;
  gap: 4px;
}
.forecast.unavailable {
  background: #f3f1ec;
}
.day-plan-card {
  padding: 18px 0;
  border-bottom: 1px solid #e4e9e5;
}
.day-plan-card.selected {
  background: #f8faf8;
  margin: 0 -12px;
  padding: 18px 12px;
  border-radius: 14px;
}
.day-plan-card ol {
  list-style: none;
  padding: 0;
  margin: 12px 0;
  display: grid;
  gap: 7px;
}
.day-plan-card li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
}
.day-plan-card li span {
  color: #778178;
  font-size: 11px;
}
.day-preview {
  margin: 22px 0 0;
  padding: 18px;
  background: #edf2ee;
  border-radius: 16px;
}
.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 16px;
}
.notice {
  font-size: 11px !important;
  color: #6e776f;
}
.button.small {
  white-space: nowrap;
}

/* This lives in a narrow sidebar even on a wide screen. */
.day-plan-entry {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 14px;
  padding: 18px 20px 20px;
  align-items: start;
}
.day-plan-entry > div {
  min-width: 0;
}
.day-plan-entry strong {
  font-size: 16px;
  line-height: 1.5;
  display: block;
  overflow-wrap: anywhere;
}
.day-plan-entry p {
  font-size: 14px;
  line-height: 1.7;
  margin-top: 8px;
}
.day-plan-entry > .button {
  justify-self: start;
  max-width: 100%;
  font-size: 14px;
  min-height: 44px;
  padding: 12px 18px;
  white-space: normal;
  line-height: 1.4;
}
.day-plan-panel {
  max-width: 100%;
  box-sizing: border-box;
}
.day-plan-card li {
  align-items: flex-start;
}
.day-plan-card li strong {
  min-width: 0;
  overflow-wrap: anywhere;
}
.day-plan-card li span {
  flex-shrink: 0;
}
@media (max-width: 760px) {
  .day-plan-entry {
    align-items: flex-start;
    flex-direction: column;
  }
  .day-plan-panel {
    position: fixed;
    left: 8px;
    right: 8px;
    top: 14dvh;
    bottom: 76px;
    width: auto;
    z-index: 82;
    border: 1px solid #dbe2dc;
  }
}
</style>
