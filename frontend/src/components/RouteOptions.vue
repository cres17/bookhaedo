<script setup lang="ts">
import { ref, watch } from 'vue';
import { api } from '../api';
const props = defineProps<{ tripId: string; date: string; from: string; to: string }>(),
  open = ref(false),
  busy = ref(false),
  error = ref(''),
  options = ref<any[]>([]),
  departure = ref('09:00'),
  notice = ref('');
const names: Record<string, string> = {
  DRIVE: '🚗 자동차',
  WALK: '🚶 도보',
  BICYCLE: '🚲 자전거',
  TRANSIT: '🚆 대중교통',
  GOOGLE_DRIVE: '🚗 Google 자동차 · 교통비',
};
watch(
  () => [props.date, props.from, props.to],
  () => {
    options.value = [];
    open.value = false;
  },
);
async function load(google = false) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  open.value = true;
  const identity = [props.date, props.from, props.to].join('|');
  try {
    const q = new URLSearchParams({
      from: props.from,
      to: props.to,
      departure: departure.value,
      google: String(google),
    });
    const d = await api('/trips/' + props.tripId + '/days/' + props.date + '/route-options?' + q);
    if (identity !== [props.date, props.from, props.to].join('|')) return;
    options.value = [
      ...options.value.filter((o) =>
        google
          ? ['DRIVE', 'WALK', 'BICYCLE'].includes(o.mode)
          : !['DRIVE', 'WALK', 'BICYCLE'].includes(o.mode),
      ),
      ...d.options,
    ];
    notice.value = d.notice;
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
function money(value: any) {
  if (!value) return '요금 정보 없음';
  if (typeof value === 'string') return value;
  return (
    value.currencyCode +
    ' ' +
    (Number(value.units || 0) + Number(value.nanos || 0) / 1e9).toLocaleString()
  );
}
</script>
<template>
  <div class="route-options">
    <button class="text-button" :disabled="busy" @click="open ? (open = false) : load()">
      {{ busy ? '이동방법 확인 중…' : open ? '이동방법 접기' : '이동방법 비교' }}
    </button>
    <section v-if="open">
      <p>조회일 {{ date }} · 일본 시간</p>
      <label>
        Google 경로 출발 시각
        <input
          type="time"
          :disabled="busy"
          v-model="departure"
          @change="options = options.filter((o) => ['DRIVE', 'WALK', 'BICYCLE'].includes(o.mode))"
        />
      </label>
      <button class="button subtle small" :disabled="busy" @click="load(true)">
        대중교통·통행료 조회 (Google)
      </button>
      <p v-if="error" role="alert">{{ error }}</p>
      <article v-for="o in options" :key="o.mode">
        <strong>{{ names[o.mode] }}</strong>
        <p>
          {{ (o.distanceMeters / 1000).toFixed(1) }}km ·
          {{
            o.durationSeconds === null
              ? '이동시간 확인 불가'
              : '약 ' + Math.ceil(o.durationSeconds / 60) + '분'
          }}
        </p>
        <small>{{ o.notice }}</small>
        <p v-if="o.mode === 'TRANSIT'">{{ money(o.transitFare) }}</p>
        <template v-if="o.mode === 'GOOGLE_DRIVE'">
          <p>
            통행료:
            {{
              o.tolls?.estimatedPrice?.length
                ? o.tolls.estimatedPrice.map(money).join(' / ')
                : '정보 없음 (무료 확정 아님)'
            }}
          </p>
          <p>
            연료비:
            {{
              o.costs?.fuel == null ? '여행 설정에 연비·유가를 입력하세요.' : '약 ¥' + o.costs.fuel
            }}
          </p>
          <p>
            택시 추정:
            {{ o.costs?.taxi == null ? '여행 설정에 요율을 입력하세요.' : '약 ¥' + o.costs.taxi }}
          </p>
          <small v-if="o.costs">
            {{ o.costs.notice }} {{ o.costs.basis.source }} {{ o.costs.basis.asOf }}
          </small>
        </template>
      </article>
      <small>{{ notice }}</small>
    </section>
  </div>
</template>
