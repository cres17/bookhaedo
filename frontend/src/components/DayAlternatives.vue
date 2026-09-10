<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch } from 'vue';
import type { Place } from '../types';
import { api, json } from '../api';
import { adverseWeather, weatherReason } from '../../../shared/weather-policy';
const props = defineProps<{
  tripId: string;
  date: string;
  revision: number;
  items: Place[];
  weather: any;
  disabled: boolean;
}>();
const emit = defineEmits<{ saved: []; preview: [value: any] }>();
const opened = ref(false),
  result = ref<any>(null),
  busy = ref(false),
  saving = ref(false),
  error = ref(''),
  count = ref(4),
  selected = ref('');
const mobile = ref(false),
  media = window.matchMedia('(max-width:760px)');
let generation = 0;
const resize = () => {
  mobile.value = media.matches;
};
onMounted(() => {
  resize();
  media.addEventListener('change', resize);
});
onUnmounted(() => {
  generation++;
  media.removeEventListener('change', resize);
});
const endpoint = computed(() => `/trips/${props.tripId}/days/${props.date}/day-alternatives`);
const signature = computed(() => `${props.tripId}|${props.date}|${props.revision}`);
watch(signature, () => {
  generation++;
  opened.value = false;
  result.value = null;
  busy.value = false;
  selected.value = '';
  error.value = '';
  emit('preview', null);
});
const weatherCopy = computed(() =>
  adverseWeather(props.weather)
    ? `${weatherReason(props.weather)} 예보까지 반영해요.`
    : '맑은 날에도 동선을 새로 짤 수 있어요.',
);
async function load(strategy = '') {
  const g = ++generation;
  busy.value = true;
  error.value = '';
  selected.value = strategy;
  if (!strategy) emit('preview', null);
  try {
    const q = new URLSearchParams({
      count: String(count.value),
      ...(strategy ? { strategy } : {}),
    });
    const data = await api(endpoint.value + '?' + q);
    if (g === generation) {
      result.value = data;
      emit(
        'preview',
        data.preview ? { places: data.preview.plan.places, segments: data.preview.segments } : null,
      );
    }
  } catch (e: any) {
    if (g === generation) error.value = e.message;
  } finally {
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
  opened.value = false;
  result.value = null;
  selected.value = '';
  emit('preview', null);
}
async function replaceDay() {
  const preview = result.value?.preview;
  if (
    !preview ||
    saving.value ||
    props.disabled ||
    result.value.tripId !== props.tripId ||
    result.value.date !== props.date
  )
    return;
  saving.value = true;
  error.value = '';
  try {
    await api(
      endpoint.value,
      json('PATCH', {
        placeIds: preview.plan.places.map((p: any) => p.id),
        expectedPlaceIds: result.value.expectedPlaceIds,
        expectedRevision: result.value.expectedRevision,
      }),
    );
    saving.value = false;
    close();
    emit('saved');
  } catch (e: any) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}
const km = (m: number | null) => (m === null ? '확인 불가' : `${(m / 1000).toFixed(1)}km`);
const time = (s: number | null) => (s === null ? '확인 불가' : `${Math.round(s / 60)}분`);
</script>
<template>
  <section class="day-plan-entry">
    <div>
      <strong>하루 코스를 통째로 다시 짜볼까요?</strong>
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
      <header>
        <div>
          <small>FULL DAY REPLAN</small>
          <h2>하루를 새로 구성해요.</h2>
        </div>
        <button
          class="icon-button"
          aria-label="하루 코스 추천 닫기"
          :disabled="saving"
          @click="close"
        >
          ×
        </button>
      </header>
      <p>
        현재 일정의 중심과 선택 날짜의 예보를 기준으로 코스를 만듭니다. 확정 전에는 저장되지 않아요.
      </p>
      <label class="stop-count">
        방문 장소 수
        <select v-model.number="count" :disabled="busy || saving" @change="load()">
          <option :value="3">3곳</option>
          <option :value="4">4곳</option>
          <option :value="5">5곳</option>
          <option :value="6">6곳</option>
        </select>
      </label>
      <p v-if="busy" role="status">예보와 주변 장소를 확인하고 있어요…</p>
      <p v-if="error" role="alert" class="form-error">
        {{ error }}
        <button @click="load(selected)">다시 조회</button>
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
              <span>{{ place.category === 'RESTAURANT' ? '먹을 곳' : '가볼 곳' }}</span>
            </li>
          </ol>
          <button class="button subtle small" :disabled="saving" @click="load(plan.id)">
            이 코스 동선 미리보기
          </button>
        </article>
        <section v-if="result.preview" class="day-preview" aria-label="하루 코스 변경 미리보기">
          <h3>하루 코스 변경 미리보기</h3>
          <p>
            <strong>{{ result.preview.plan.label }}</strong>
            · {{ result.preview.plan.places.length }}곳
          </p>
          <p v-if="result.preview.complete">
            실제 경로 {{ km(result.preview.distanceMeters) }} · 약
            {{ time(result.preview.durationSeconds) }}
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
        <p class="notice">{{ result.notice }}</p>
      </template>
    </section>
  </Teleport>
</template>
<style scoped>
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
