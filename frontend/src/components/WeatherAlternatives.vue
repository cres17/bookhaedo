<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted, onUnmounted } from 'vue';
import type { Place } from '../types';
import { api, json } from '../api';
import { adverseWeather, isOutdoor, weatherReason } from '../../../shared/weather-policy';
const props = defineProps<{
  tripId: string;
  date: string;
  revision: number;
  items: Place[];
  weather: any;
  disabled: boolean;
}>();
const emit = defineEmits<{ saved: []; preview: [value: any] }>();
const entry = ref<HTMLButtonElement | null>(null),
  panel = ref<HTMLElement | null>(null);
const mobile = ref(false);
const media = window.matchMedia('(max-width:760px)');
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
const outdoor = computed(() => props.items.filter(isOutdoor));
const opened = ref(false),
  targetId = ref(''),
  result = ref<any>(null),
  busy = ref(false),
  saving = ref(false),
  error = ref(''),
  dismissed = ref(false);
let generation = 0;
const signature = computed(
  () => props.tripId + props.date + props.revision + props.items.map((p) => p.id).join(','),
);
watch(signature, () => {
  generation++;
  opened.value = false;
  result.value = null;
  busy.value = false;
  targetId.value = '';
  dismissed.value = false;
  error.value = '';
  emit('preview', null);
});
const endpoint = computed(() => `/trips/${props.tripId}/days/${props.date}/weather-alternatives`);
async function search(previewId?: string) {
  const g = ++generation;
  busy.value = true;
  error.value = '';
  result.value = null;
  emit('preview', null);
  try {
    const data = await api(
      endpoint.value +
        '?' +
        new URLSearchParams({ targetId: targetId.value, ...(previewId ? { previewId } : {}) }),
    );
    if (g === generation) {
      result.value = data;
      emit('preview', data.preview ? { targetId: targetId.value, ...data.preview } : null);
    }
  } catch (e: any) {
    if (g === generation) error.value = e.message;
  } finally {
    if (g === generation) busy.value = false;
  }
}
async function open() {
  targetId.value = outdoor.value[0]?.id || '';
  opened.value = true;
  await nextTick();
  panel.value?.focus();
  if (targetId.value) search();
}
function close() {
  if (saving.value) return;
  generation++;
  opened.value = false;
  busy.value = false;
  result.value = null;
  emit('preview', null);
  entry.value?.focus();
}
async function replace() {
  const candidate = result.value?.preview?.candidate;
  if (!candidate || saving.value || props.disabled) return;
  const url = endpoint.value,
    signatureAtSave = signature.value;
  const payload = {
    targetId: targetId.value,
    replacementId: candidate.id,
    placeIds: result.value.expectedPlaceIds,
    expectedRevision: result.value.expectedRevision,
  };
  saving.value = true;
  error.value = '';
  try {
    await api(url, json('PATCH', payload));
    if (signatureAtSave === signature.value) {
      opened.value = false;
      result.value = null;
    }
    emit('preview', null);
    emit('saved');
  } catch (e: any) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}
const minutes = (s: number) => Math.round(s / 60) + '분';
</script>
<template>
  <section v-if="outdoor.length" class="weather-alternative-entry">
    <template v-if="!dismissed && adverseWeather(weather)">
      <strong>{{ weatherReason(weather) }} 예보가 있어요. 실내 코스도 살펴볼까요?</strong>
      <p>이 날짜 첫 장소의 예보입니다. 추천은 선택한 장소의 예보를 다시 확인해요.</p>
    </template>
    <button ref="entry" class="button subtle small" :disabled="disabled" @click="open">
      {{ adverseWeather(weather) ? '대안 장소 보기' : '날씨와 실내 대안 확인' }}
    </button>
    <button
      v-if="!dismissed && adverseWeather(weather)"
      class="text-button"
      @click="dismissed = true"
    >
      안내 접기
    </button>
  </section>
  <Teleport to="body" :disabled="!mobile">
    <section
      v-if="opened"
      ref="panel"
      tabindex="-1"
      class="weather-alternative-panel"
      aria-label="날씨 기반 대안 추천"
      :aria-busy="busy || saving"
      @keydown.esc.stop="close"
    >
      <header>
        <div>
          <small>WEATHER ALTERNATIVES</small>
          <h2>날씨가 달라도, 나의 여행.</h2>
        </div>
        <button class="icon-button" aria-label="대안 추천 닫기" :disabled="saving" @click="close">
          ×
        </button>
      </header>
      <p>일정을 바꾸기 전에 가까운 실내 장소를 비교해 보세요.</p>
      <label>
        대체할 야외 장소
        <select v-model="targetId" :disabled="saving || busy" @change="search()">
          <option v-for="p in outdoor" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </label>
      <p v-if="busy" role="status">{{ '예보와 주변 장소·이동 구간을 확인하고 있어요…' }}</p>
      <p v-if="error" role="alert" class="form-error">
        {{ error }}
        <button :disabled="saving" @click="search()">다시 조회</button>
      </p>
      <template v-if="result && !busy">
        <p v-if="result.weather?.available" class="alternative-forecast">
          {{ date }} · {{ result.weather.description }} ·
          <a :href="result.weather.sourceUrl" target="_blank" rel="noopener noreferrer">
            {{ result.weather.source }}
          </a>
        </p>
        <p v-if="result.status !== 'READY'" role="status">
          {{
            result.status === 'NO_CANDIDATES'
              ? '가까운 실내 대안을 찾지 못했어요. 다른 장소를 선택하거나 기존 일정을 유지해주세요.'
              : result.notice
          }}
        </p>
        <template v-else>
          <article v-for="p in result.data" :key="p.id" class="alternative-card">
            <h3>{{ p.name }}</h3>
            <p v-if="p.name !== p.nameJa" lang="ja">{{ p.nameJa }}</p>
            <p>
              {{ p.indoorEvidence }} · 기존 장소에서 직선
              {{ (p.distanceMeters / 1000).toFixed(1) }}km
            </p>
            <small>{{ p.operationNotice }}</small>
            <button class="button subtle small" :disabled="saving" @click="search(p.id)">
              이 장소로 미리보기
            </button>
          </article>
          <section
            v-if="result.preview"
            class="replacement-preview"
            aria-label="장소 교체 미리보기"
          >
            <h3>변경 미리보기</h3>
            <p>
              {{ result.target.name }} →
              <strong>{{ result.preview.candidate.name }}</strong>
            </p>
            <p
              v-if="!result.preview.before.segments.length && !result.preview.after.segments.length"
            >
              하루에 한 장소만 있어 비교할 이동 구간이 없어요.
            </p>
            <template v-else>
              <p
                v-for="(value, key) in { 기존: result.preview.before, 변경: result.preview.after }"
                :key="key"
              >
                {{ key }} 인접 구간:
                <template v-if="value.complete">
                  {{ (value.distanceMeters / 1000).toFixed(1) }}km ·
                  {{ minutes(value.durationSeconds) }}
                </template>
                <template v-else>
                  실제 경로·시간 확인 불가 (직선거리는 이동시간 비교에 사용하지 않아요)
                </template>
              </p>
              <p v-if="result.preview.durationDeltaSeconds !== null">
                이동시간
                {{
                  result.preview.durationDeltaSeconds > 0
                    ? '약 ' + minutes(result.preview.durationDeltaSeconds) + ' 증가'
                    : result.preview.durationDeltaSeconds < 0
                      ? '약 ' + minutes(-result.preview.durationDeltaSeconds) + ' 감소'
                      : '차이 없음'
                }}
              </p>
            </template>
            <small>
              여행일 오전 9시 출발을 가정한 인접 구간 비교입니다. 기상·휴업·교통 상황을 보장하지
              않아요. 기존 장소의 메모는 교체 시 삭제되며, 다른 장소의 메모와 방문 순서는
              유지됩니다.
            </small>
            <div class="replacement-actions">
              <button class="button dark" :disabled="saving || disabled" @click="replace">
                {{ saving ? '저장 중…' : '이 장소로 교체 확정' }}
              </button>
              <button class="button subtle" :disabled="saving" @click="close">
                기존 일정 유지
              </button>
            </div>
          </section>
          <p class="alternative-notice">{{ result.notice }}</p>
        </template>
      </template>
    </section>
  </Teleport>
</template>
<style scoped>
.weather-alternative-entry {
  padding: 16px 20px;
  background: #f0f4f0;
  border-bottom: 1px solid #dbe2dc;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  flex-wrap: wrap;
}
.weather-alternative-entry strong {
  font-size: 14px;
  width: 100%;
}
.weather-alternative-entry p {
  font-size: 12px;
  margin: 0;
  color: #657367;
  width: 100%;
}
.weather-alternative-panel {
  position: absolute;
  z-index: 15;
  right: 0;
  top: 0;
  bottom: 0;
  width: min(440px, 100%);
  background: #fff;
  box-shadow: -15px 0 50px #24312d20;
  padding: 24px;
  overflow-y: auto;
  border-radius: 22px;
  overscroll-behavior: contain;
}
.weather-alternative-panel header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}
.weather-alternative-panel h2 {
  font-size: 22px;
  margin: 8px 0;
}
.weather-alternative-panel h3 {
  font-size: 17px;
  margin: 6px 0;
}
.weather-alternative-panel p {
  font-size: 14px;
  line-height: 1.65;
}
.weather-alternative-panel small {
  display: block;
  color: #637368;
  font-size: 12px;
  line-height: 1.7;
}
.weather-alternative-panel label {
  display: grid;
  gap: 8px;
  font-size: 14px;
  margin: 20px 0;
}
.weather-alternative-panel select {
  width: 100%;
  padding: 12px;
  border: 1px solid #ccd7ce;
  border-radius: 12px;
  background: #fff;
  color: #24312d;
}
.alternative-card {
  padding: 16px 0;
  border-bottom: 1px solid #e2e7e2;
}
.alternative-card button {
  margin-top: 10px;
}
.replacement-preview {
  margin-top: 22px;
  padding: 18px;
  background: #f0f4f0;
  border-radius: 16px;
}
.replacement-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 16px;
}
.alternative-notice {
  color: #637368;
  font-size: 12px !important;
}
@media (max-width: 760px) {
  .weather-alternative-panel {
    position: fixed;
    top: 80px;
    bottom: 12px;
    right: 8px;
    left: 8px;
    width: auto;
    border: 1px solid #dbe2dc;
  }
}
@media (max-width: 760px) {
  .weather-alternative-panel {
    top: 20dvh;
    bottom: 80px;
    z-index: 80;
  }
}
</style>
