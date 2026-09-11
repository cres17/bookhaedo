<script setup lang="ts">
import WeatherAlternatives from '../components/WeatherAlternatives.vue';
import DayAlternatives from '../components/DayAlternatives.vue';
import TripTools from '../components/TripTools.vue';
import TripMenu from '../components/TripMenu.vue';
import RouteOptions from '../components/RouteOptions.vue';
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, json } from '../api';
import { state, selectTrip, notify, categoryName } from '../store';
import type { Trip, Segment } from '../types';
import TravelMap from '../components/TravelMap.vue';
import Icon from '../components/Icon.vue';
import Crystal from '../components/Crystal.vue';
const route = useRoute(),
  router = useRouter(),
  trip = ref<Trip | null>(null),
  active = ref(state.activeDate),
  segments = ref<Segment[]>([]),
  routing = ref(false),
  weather = ref<any>(null),
  error = ref(''),
  saving = ref(false),
  addingDay = ref(false),
  newDate = ref(''),
  editing = ref(false),
  title = ref(''),
  mode = ref('DRIVE');
const costs = ref<Record<string, any>>({});
const recommendationKey = `bookhaedo-recommendations:${route.params.id}`;
const showRecommendations = ref(localStorage.getItem(recommendationKey) !== 'hidden');
function toggleRecommendations() {
  showRecommendations.value = !showRecommendations.value;
  localStorage.setItem(recommendationKey, showRecommendations.value ? 'shown' : 'hidden');
  dayPreview.value = null;
  alternativePreview.value = null;
}
const remoteChanged = ref(false);
let syncTimer: ReturnType<typeof setInterval>,
  checking = false;
const signature = (t: Trip) =>
  JSON.stringify([t.title, t.transportMode, t.days.map((d) => [d.id, d.revision])]);
async function checkChanges() {
  if (checking || saving.value || document.hidden || !trip.value) return;
  checking = true;
  try {
    const r = await api<{ data: Trip }>('/trips/' + route.params.id);
    remoteChanged.value = signature(r.data) !== signature(trip.value);
  } catch (e: any) {
    if (e.status === 404 || e.status === 401) error.value = e.message;
  } finally {
    checking = false;
  }
}
async function saveBudget(p: any) {
  if (saving.value || !current.value) return;
  saving.value = true;
  try {
    const r = await api(
      `/trips/${route.params.id}/days/${active.value}/items/${p.id}/budget`,
      json('PATCH', {
        estimatedCost: p.estimatedCost === '' ? null : (p.estimatedCost ?? null),
        expectedRevision: current.value.revision,
      }),
    );
    current.value.revision = r.revision;
    notify('장소 예상 비용을 저장했어요.');
  } catch (e: any) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}
let generation = 0;
const alternativePreview = ref<any>(null);
const dayPreview = ref<any>(null);
const mapPlaces = computed(
  () =>
    dayPreview.value?.places ||
    current.value?.items.map((p) =>
      p.id === alternativePreview.value?.targetId ? alternativePreview.value.candidate : p,
    ) ||
    [],
);
const mapSegments = computed(
  () =>
    dayPreview.value?.segments ||
    (alternativePreview.value
      ? [
          ...segments.value.filter(
            (s) =>
              s.from !== alternativePreview.value.targetId &&
              s.to !== alternativePreview.value.targetId,
          ),
          ...alternativePreview.value.after.segments,
        ]
      : segments.value),
);
const current = computed(() => trip.value?.days.find((d) => d.date === active.value));
const center = computed(() => current.value?.items[0] || { latitude: 43.4, longitude: 142.6 });
let loadGeneration = 0,
  controller: AbortController | undefined;
onBeforeUnmount(() => {
  loadGeneration++;
  generation++;
  controller?.abort();
  clearInterval(syncTimer);
});
async function load() {
  const token = ++loadGeneration;
  try {
    const data = await api<{ data: Trip }>('/trips/' + route.params.id);
    if (token !== loadGeneration) return;
    trip.value = data.data;
    const slug =
      trip.value.title
        .normalize('NFKC')
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80) || 'travel';
    if (route.params.slug !== slug)
      await router.replace({
        name: 'trip',
        params: { id: route.params.id, slug },
        query: route.query,
        hash: route.hash,
      });
    remoteChanged.value = false;
    if (!trip.value.days.some((d) => d.date === active.value))
      active.value = trip.value.days[0]?.date || '';
    selectTrip(String(route.params.id), active.value);
    costs.value = { ...(trip.value.costSettings || {}) };
    title.value = trip.value.title;
    mode.value = trip.value.transportMode;
    void loadRoutes();
  } catch (e: any) {
    if (token === loadGeneration) error.value = e.message;
  }
}
async function loadRoutes() {
  if (!current.value) return;
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal,
    g = ++generation,
    date = active.value,
    p = current.value.items[0];
  segments.value = [];
  weather.value = null;
  routing.value = true;
  const paths = api(`/trips/${route.params.id}/days/${date}/routes`, { signal })
    .then((d) => {
      if (g === generation) segments.value = d.segments;
    })
    .catch((e) => {
      if (g === generation && e.name !== 'AbortError') error.value = e.message;
    })
    .finally(() => {
      if (g === generation) routing.value = false;
    });
  const forecast = p
    ? api(`/weather?latitude=${p.latitude}&longitude=${p.longitude}&date=${date}`, { signal })
        .then((w) => {
          if (g === generation) weather.value = w;
        })
        .catch((e) => {
          if (g === generation && e.name !== 'AbortError')
            weather.value = { available: false, notice: '날씨를 불러오지 못했어요.' };
        })
    : Promise.resolve();
  await Promise.all([paths, forecast]);
}
onMounted(() => {
  void load();
  syncTimer = setInterval(checkChanges, 15000);
});
watch(active, async () => {
  await nextTick();
  document
    .querySelector('.day-tabs .active')
    ?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
});
async function chooseDay(date: string) {
  active.value = date;
  if (trip.value) {
    selectTrip(trip.value.id, date);
    await loadRoutes();
  }
}
async function saveOrder(ids: string[]) {
  if (saving.value || !current.value) return;
  const date = active.value,
    expectedRevision = current.value.revision;
  saving.value = true;
  error.value = '';
  try {
    await api(
      `/trips/${route.params.id}/days/${date}/items`,
      json('PUT', { placeIds: ids, expectedRevision }),
    );
    await load();
    notify('변경한 일정을 저장했어요.');
  } catch (e: any) {
    error.value = e.message;
    if (e.status === 409) await load();
  } finally {
    saving.value = false;
  }
}
function move(index: number, delta: number) {
  const ids = current.value!.items.map((p) => p.id);
  [ids[index], ids[index + delta]] = [ids[index + delta]!, ids[index]!];
  saveOrder(ids);
}
function remove(id: string) {
  saveOrder(current.value!.items.filter((p) => p.id !== id).map((p) => p.id));
}
async function addDay() {
  if (saving.value) return;
  saving.value = true;
  error.value = '';
  try {
    const result = await api(`/trips/${route.params.id}/days`, json('POST', {}));
    active.value = result.date;
    await load();
    notify('다음 날짜를 추가했어요.');
  } catch (e: any) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}
async function update() {
  if (saving.value) return;
  saving.value = true;
  try {
    await api(
      '/trips/' + route.params.id,
      json('PATCH', {
        title: title.value,
        transportMode: mode.value,
        costSettings: Object.fromEntries(Object.entries(costs.value).filter(([, v]) => v !== '')),
      }),
    );
    editing.value = false;
    await load();
  } catch (e: any) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}
async function saveNote(p: any) {
  if (saving.value || !current.value) return;
  const day = current.value;
  saving.value = true;
  try {
    const result = await api(
      '/trips/' + route.params.id + '/days/' + day.date + '/items/' + p.id + '/note',
      json('PATCH', { note: p.note || '', expectedRevision: day.revision }),
    );
    day.revision = result.revision;
    notify('메모를 저장했어요.');
  } catch (e: any) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}
const transportName = (value: string) =>
  ({ DRIVE: '렌터카', TAXI: '택시', WALK: '도보', BICYCLE: '자전거', TRANSIT: '대중교통' })[
    value
  ] || value;
const duration = (seconds: number) => {
  const min = Math.ceil(seconds / 60);
  return min >= 60 ? `${Math.floor(min / 60)}시간 ${min % 60}분` : `${min}분`;
};
</script>
<template>
  <main class="planner-page">
    <div class="planner-heading">
      <div>
        <RouterLink to="/trips" class="back-link">
          <Icon name="back" :size="17" />
          나의 여행
        </RouterLink>
        <h1>{{ trip?.title || '여행을 불러오는 중…' }}</h1>
      </div>
      <div class="planner-actions">
        <TripMenu v-if="trip" :trip="trip" @changed="load" @deleted="router.push('/trips')" />
        <span class="saved-note">
          <Icon name="check" :size="16" />
          {{ saving ? '저장 중' : '일정 변경 자동 저장 · 메모는 저장 버튼' }}
        </span>
        <button class="button subtle small" @click="editing = true">여행 설정</button>
        <button
          class="button subtle small"
          :aria-pressed="showRecommendations"
          @click="toggleRecommendations"
        >
          {{ showRecommendations ? '추천 숨기기' : '하루 코스 추천 켜기' }}
        </button>
      </div>
    </div>
    <p v-if="remoteChanged" class="collaboration-notice" role="status">
      동행자가 일정을 수정했어요. 작성 중인 메모·비용은 저장한 후 최신 내용을 불러오세요.
      <button class="text-button" :disabled="saving" @click="load">최신 일정 불러오기</button>
    </p>
    <p v-if="error && !editing && !addingDay" role="alert" class="form-error">
      {{ error }}
      <button type="button" class="icon-button" aria-label="오류 닫기" @click="error = ''">
        ×
      </button>
      <button
        @click="
          error = '';
          load();
        "
      >
        다시 시도
      </button>
    </p>
    <div class="day-tabs" v-if="trip">
      <button
        v-for="(d, i) in trip.days"
        :key="d.id"
        :class="{ active: active === d.date }"
        @click="chooseDay(d.date)"
      >
        <strong>DAY {{ String(i + 1).padStart(2, '0') }}</strong>
        <span>{{ d.date.slice(5).replace('-', '.') }} · {{ d.items.length }}곳</span>
      </button>
      <button class="add-day" :disabled="saving" @click="addDay">
        <Icon name="plus" />
        날짜 추가
      </button>
    </div>
    <div v-if="trip && current" class="planner-workspace" style="position: relative">
      <div class="planner-map">
        <TravelMap
          :places="mapPlaces"
          :center="center"
          :zoom="current.items.length ? 11 : 7"
          numbered
          :segments="mapSegments"
          @select="(p) => router.push('/places/' + p.id)"
        />
        <div v-if="weather" class="weather-chip">
          <Icon name="sun" />
          <span v-if="weather.available">
            <strong>{{ weather.description }}</strong>
            <small>
              {{ weather.low }}° — {{ weather.high }}° ·
              <a :href="weather.sourceUrl" target="_blank" rel="noopener noreferrer">
                {{ weather.source }}
              </a>
            </small>
          </span>
          <span v-else class="weather-unavailable">{{ weather.notice }}</span>
        </div>
        <RouterLink to="/explore" class="button dark map-explore">
          <Icon name="plus" />
          지도에서 장소 찾기
        </RouterLink>
      </div>
      <aside class="itinerary">
        <div class="itinerary-heading">
          <div>
            <h2>{{ active.slice(5).replace('-', '월 ') }}일의 여정</h2>
          </div>
          <span class="count-badge">{{ current.items.length }}곳</span>
        </div>
        <div v-if="showRecommendations" class="recommendation-close-row">
          <button class="icon-button" aria-label="일정 추천 숨기기" @click="toggleRecommendations">
            ×
          </button>
        </div>
        <DayAlternatives
          v-if="showRecommendations"
          :key="trip.id + trip.transportMode"
          :trip-id="trip.id"
          :date="active"
          :revision="current.revision"
          :items="current.items"
          :weather="weather"
          :disabled="saving"
          @preview="
            dayPreview = $event;
            alternativePreview = null;
          "
          @saved="
            load();
            notify('새로운 하루 코스를 저장했어요.');
          "
        />
        <WeatherAlternatives
          v-if="showRecommendations"
          :key="trip.id + trip.transportMode"
          :trip-id="trip.id"
          :date="active"
          :revision="current.revision"
          :items="current.items"
          :weather="weather"
          :disabled="saving"
          @preview="
            alternativePreview = $event;
            dayPreview = null;
          "
          @saved="
            load();
            notify('실내 장소로 교체했어요.');
          "
        />
        <div class="itinerary-scroll">
          <div v-if="!current.items.length" class="empty-state itinerary-empty">
            <Crystal :size="66" />
            <h3>아직, 무엇이든 가능한 하루.</h3>
            <p>
              마음에 드는 장소를 하나 담아보세요.
              <br />
              장소 사이의 길은 함께 찾아드릴게요.
            </p>
            <RouterLink to="/explore" class="button subtle">
              첫 장소 찾기
              <Icon name="arrow" />
            </RouterLink>
          </div>
          <template v-for="(p, i) in current.items" :key="p.id">
            <RouteOptions
              v-if="i > 0"
              :key="active + p.id + trip.transportMode"
              :trip-id="trip.id"
              :date="active"
              :from="current.items[i - 1]!.id"
              :to="p.id"
            >
              <template #summary>
                <span class="route-default-mode">{{ transportName(trip.transportMode) }}</span>
                <span v-if="routing">계산 중…</span>
                <template v-else-if="segments[i - 1]">
                  <span>
                    {{ segments[i - 1]!.source === 'straight-line' ? '직선 ' : ''
                    }}{{ (segments[i - 1]!.distanceMeters / 1000).toFixed(1) }} km ·
                    {{
                      segments[i - 1]!.durationSeconds !== null
                        ? duration(segments[i - 1]!.durationSeconds!)
                        : '시간 정보 없음'
                    }}
                  </span>
                </template>
                <span v-else>경로 정보 없음</span>
              </template>
            </RouteOptions>
            <article :class="['itinerary-stop', p.category.toLowerCase()]">
              <span class="stop-number">{{ i + 1 }}</span>
              <div class="stop-content">
                <small>{{ categoryName(p.category) }}</small>
                <button class="stop-name" @click="router.push('/places/' + p.id)">
                  {{ p.name }}
                </button>
                <p v-if="p.name !== p.nameJa" lang="ja">{{ p.nameJa }}</p>
                <p>{{ p.openingHours || '운영시간 확인 필요' }}</p>
                <details class="stop-budget">
                  <summary>
                    얼마나 들까요? ·
                    {{
                      p.estimatedCost == null
                        ? '예상 비용 미입력'
                        : Number(p.estimatedCost).toLocaleString() + '엔'
                    }}
                  </summary>
                  <label>
                    이 장소에서 쓸 예상 총액 (JPY · 엔)
                    <input
                      type="number"
                      min="0"
                      max="100000000"
                      step="1"
                      v-model.number="p.estimatedCost"
                      :disabled="saving"
                      :aria-label="p.name + ' 예상 비용'"
                      placeholder="금액 미정이면 비워두세요"
                    />
                  </label>
                  <button class="text-button" :disabled="saving" @click="saveBudget(p)">
                    예상 비용 저장
                  </button>
                </details>
                <details class="stop-note">
                  <summary>메모 {{ p.note ? '· 작성됨' : '추가' }}</summary>
                  <textarea
                    :disabled="saving"
                    v-model="p.note"
                    maxlength="2000"
                    :aria-label="p.name + ' 메모'"
                    placeholder="예약 시간, 꼭 보고 싶은 것…"
                  />
                  <button class="text-button" :disabled="saving" @click="saveNote(p)">
                    메모 저장
                  </button>
                </details>
                <div class="stop-actions">
                  <button
                    class="icon-button"
                    :aria-label="p.name + ' 위로 이동'"
                    :disabled="i === 0 || saving"
                    @click="move(i, -1)"
                  >
                    <Icon name="up" :size="16" />
                  </button>
                  <button
                    class="icon-button"
                    :aria-label="p.name + ' 아래로 이동'"
                    :disabled="i === current.items.length - 1 || saving"
                    @click="move(i, 1)"
                  >
                    <Icon name="down" :size="16" />
                  </button>
                  <button class="text-button remove-stop" :disabled="saving" @click="remove(p.id)">
                    삭제
                  </button>
                </div>
              </div>
            </article>
          </template>
        </div>
        <div class="itinerary-footer">
          <RouterLink to="/explore" class="button subtle wide">
            <Icon name="plus" />
            장소 추가
          </RouterLink>
          <small>운영시간과 계절별 개방 여부를 출발 전에 확인하세요.</small>
          <small>
            오늘 입력한 예상 비용 합계:
            {{
              current.items
                .reduce((sum, p) => sum + Number(p.estimatedCost || 0), 0)
                .toLocaleString()
            }}엔 · 실제 지출은 아래 정산 계산기에 기록
          </small>
        </div>
      </aside>
    </div>
    <TripTools v-if="trip" :key="trip.id" :trip-id="trip.id" :is-owner="trip.isOwner === true" />
    <div
      v-if="addingDay || editing"
      class="modal-backdrop"
      @click.self="
        addingDay = false;
        editing = false;
      "
    >
      <section
        class="modal"
        v-dialog
        role="dialog"
        aria-modal="true"
        :aria-label="addingDay ? '날짜 추가' : '여행 설정'"
      >
        <button
          class="icon-button modal-close"
          aria-label="닫기"
          @click="
            addingDay = false;
            editing = false;
          "
        >
          <Icon name="close" />
        </button>
        <h2>{{ addingDay ? '새로운 하루를 더해요.' : '나의 여행 설정' }}</h2>
        <form @submit.prevent="addingDay ? addDay() : update()">
          <label v-if="addingDay">
            여행 날짜
            <input type="date" v-model="newDate" required />
          </label>
          <template v-else>
            <label>
              여행 이름
              <input v-model="title" required maxlength="100" />
            </label>
            <label>
              이동 방법
              <select v-model="mode">
                <option value="DRIVE">렌터카</option>
                <option value="TAXI">택시</option>
                <option value="WALK">도보</option>
                <option value="BICYCLE">자전거</option>
                <option value="TRANSIT">대중교통</option>
              </select>
            </label>
            <details class="cost-settings">
              <summary>연료비·택시 추정 기준 (선택)</summary>
              <p>현재 공식 유가·요율 자동 연동은 아닙니다. 확인한 값을 직접 입력하세요.</p>
              <label
                v-for="[key, label] in [
                  ['fuelEfficiency', '평균 연비 (km/L)'],
                  ['fuelPrice', '유가 (엔/L)'],
                  ['taxiBase', '택시 기본요금 (엔)'],
                  ['taxiIncludedKm', '기본 포함 거리 (km)'],
                  ['taxiPerKm', '추가 km당 요금 (엔)'],
                  ['taxiPerMinute', '시간당이 아닌 분당 추가 요금 (엔)'],
                ]"
                :key="key"
              >
                {{ label }}
                <input
                  type="number"
                  min="0"
                  step="any"
                  :value="costs[key!]"
                  @input="
                    costs[key!] =
                      ($event.target as HTMLInputElement).value === ''
                        ? null
                        : Number(($event.target as HTMLInputElement).value)
                  "
                />
              </label>
              <label>
                요율 출처
                <input
                  v-model="costs.source"
                  maxlength="300"
                  placeholder="확인한 운수회사·가격 출처"
                />
              </label>
              <label>
                확인일
                <input type="date" v-model="costs.asOf" />
              </label>
            </details>
          </template>
          <p v-if="error" class="form-error" role="alert">{{ error }}</p>
          <button class="button dark wide" :disabled="saving">
            {{ saving ? '저장 중…' : '저장하기' }}
          </button>
        </form>
      </section>
    </div>
  </main>
</template>
<style scoped>
.recommendation-close-row {
  display: flex;
  justify-content: flex-end;
  background: #f4f5ed;
  padding: 0 10px;
}
.recommendation-close-row button {
  height: 26px;
}
.collaboration-notice {
  padding: 14px 18px;
  border-radius: 14px;
  background: #eaf2ec;
  font-size: 13px;
  line-height: 1.7;
}
.stop-budget {
  margin: 12px 0;
  color: #51586d;
  font-size: 13px;
}
.stop-budget summary {
  cursor: pointer;
}
.stop-budget input[type='number'] {
  width: 100%;
  padding: 10px;
  margin: 8px 0;
  border: 1px solid #d5dfd7;
  border-radius: 10px;
}
.stop-budget label {
  font-size: 12px;
  line-height: 1.6;
}
</style>
