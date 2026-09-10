<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api';
import { state, localToday } from '../store';
import type { Place } from '../types';
import TravelMap from '../components/TravelMap.vue';
import PlaceCard from '../components/PlaceCard.vue';
import Icon from '../components/Icon.vue';
import Snowfall from '../components/Snowfall.vue';
import { regionStories } from '../region-stories';
import { exploreMemory } from '../explore-memory';
import { mapFocusForPlaces } from '../map-focus';
const route = useRoute(),
  router = useRouter(),
  size = 12;
const requested = String(route.query.region ?? state.searchRegion ?? ''),
  saved =
    exploreMemory.value?.region === requested && !route.query.city ? exploreMemory.value : null;
const search = ref(saved?.search || ''),
  region = ref(requested),
  category = ref(saved?.category || ''),
  theme = ref(saved?.theme || ''),
  travelDate = ref(saved?.date || localToday()),
  candidates = ref<Place[]>([]),
  page = ref(saved?.page || 1);
const places = ref<Place[]>([]),
  count = ref(0),
  busy = ref(false),
  error = ref(''),
  discoveryNotice = ref('');
const center = ref(saved?.center || { latitude: 43.4, longitude: 142.6 }),
  zoom = ref(saved?.zoom || 7),
  panel = ref<HTMLElement>(),
  results = ref<HTMLElement>(),
  themed = ref<HTMLElement>();
const selectedRegion = computed(() => state.regions.find((r) => r.id === region.value)),
  story = computed(() => regionStories[region.value] || regionStories['']!),
  regionIndex = computed(() => state.regions.findIndex((r) => r.id === region.value));
const pages = computed(() =>
  Math.max(1, Math.ceil((theme.value ? candidates.value.length : count.value) / size)),
);
const themes = [
  ['', '모든 장소', '취향을 정하지 않고'],
  ['weather', '날씨에 맞게', '여행일 예보를 참고해'],
  ['indoor', '비·눈 피하기', '실내에서 쉬어가기'],
  ['nature', '자연 속으로', '공원과 풍경을 찾아'],
  ['photo', '사진 명소', '기억하고 싶은 장면'],
  ['onsen', '온천', '따뜻하게 쉬는 시간'],
  ['food', '먹방', '한 끼를 여행처럼'],
  ['season', '계절 취향', '계절에 어울리는 후보'],
  ['random', '랜덤 발견', '새로운 장소 만나기'],
  ['nearby', '내 주변', '현재 위치에서 가까이'],
  ['japanese', '일본어 리뷰 단서', '원문 리뷰 표본 확인'],
];
const position = ref<{ latitude: number; longitude: number } | null>(null);
let locationRequest = 0;
async function chooseTheme(value: string) {
  const token = ++locationRequest;
  controller?.abort();
  generation++;
  busy.value = false;
  theme.value = theme.value === value ? '' : value;
  error.value = '';
  if (theme.value === 'nearby') {
    places.value = [];
    count.value = 0;
    try {
      const coords = await new Promise<GeolocationCoordinates>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition((p) => resolve(p.coords), reject, {
          timeout: 10000,
        }),
      );
      if (token !== locationRequest) return;
      position.value = { latitude: coords.latitude, longitude: coords.longitude };
    } catch {
      if (token === locationRequest) error.value = '위치 권한을 확인해주세요.';
      return;
    }
  }
  await load();
  await nextTick();
  scrollTo(results.value);
}
let generation = 0,
  controller: AbortController | undefined;
function remember() {
  exploreMemory.value = {
    region: region.value,
    search: search.value,
    category: category.value,
    theme: theme.value,
    date: travelDate.value,
    page: page.value,
    scroll: panel.value?.scrollTop || 0,
    center: { ...center.value },
    zoom: zoom.value,
  };
}
function focusRegion(point?: { latitude: number; longitude: number }) {
  const r = point || selectedRegion.value;
  center.value = r
    ? { latitude: r.latitude, longitude: r.longitude }
    : { latitude: 43.4, longitude: 142.6 };
  zoom.value = r ? 11 : 7;
}
async function load(reset = true) {
  controller?.abort();
  controller = new AbortController();
  const current = ++generation;
  if (reset) page.value = 1;
  busy.value = true;
  error.value = '';
  discoveryNotice.value = '';
  places.value = [];
  try {
    const params = new URLSearchParams({ limit: theme.value ? '40' : String(size) });
    if (!theme.value) params.set('offset', String((page.value - 1) * size));
    if (region.value) params.set('regionId', region.value);
    if (category.value) params.set('category', category.value);
    if (search.value.trim()) params.set('q', search.value.trim());
    if (theme.value) {
      params.set('theme', theme.value);
      params.set('date', travelDate.value);
      if (state.activeTrip) params.set('tripId', state.activeTrip);
      if (theme.value === 'nearby' && position.value) {
        params.set('latitude', String(position.value.latitude));
        params.set('longitude', String(position.value.longitude));
      }
    }
    let d = await api((theme.value ? '/discover?' : '/places?') + params, {
      signal: controller.signal,
    });
    if (current !== generation) return;
    if (!theme.value && !category.value && search.value.trim().length >= 2 && d.count === 0) {
      const assistParams = new URLSearchParams({ q: search.value.trim() });
      if (region.value) assistParams.set('regionId', region.value);
      const assisted = await api('/places/search-assist?' + assistParams, {
        signal: controller.signal,
      });
      if (current !== generation) return;
      d = { ...d, data: assisted.data, count: assisted.data.length, notice: assisted.notice };
    }
    if (theme.value === 'japanese' && d.status === 'PROVIDER_UNAVAILABLE')
      d.notice = '리뷰 제공 서비스에 연결하지 못했어요. 잠시 후 다시 확인해주세요. ' + d.notice;
    else if (theme.value === 'japanese' && d.status === 'INSUFFICIENT_EVIDENCE')
      d.notice = '검사한 표본에서 추천 기준을 충족한 장소가 없어요. ' + d.notice;
    discoveryNotice.value = d.notice || '';
    if (d.filters?.regions?.length === 1) {
      region.value = d.filters.regions[0];
      state.searchRegion = region.value;
      if (reset) focusRegion();
    }
    count.value = d.count || 0;
    if (theme.value) {
      candidates.value = d.data;
      places.value = d.data.slice((page.value - 1) * size, page.value * size);
    } else places.value = d.data;
    if (page.value > pages.value) {
      page.value = pages.value;
      await load(false);
      return;
    }
    if (reset && places.value.length) {
      const focus = mapFocusForPlaces(theme.value ? d.data : places.value);
      if (focus) {
        center.value = focus.center;
        zoom.value = focus.zoom;
      }
    }
    remember();
  } catch (e: any) {
    if (current === generation && e.name !== 'AbortError') {
      error.value = e.message;
      count.value = 0;
    }
  } finally {
    if (current === generation) busy.value = false;
  }
}
function chooseRegion(id: string, point?: { latitude: number; longitude: number }) {
  locationRequest++;
  if (theme.value === 'nearby') theme.value = '';
  region.value = id;
  state.searchRegion = id;
  search.value = '';
  focusRegion(point);
  void load();
}
function stepRegion(delta: number) {
  const i =
    regionIndex.value < 0
      ? delta > 0
        ? 0
        : state.regions.length - 1
      : (regionIndex.value + delta + state.regions.length) % state.regions.length;
  const r = state.regions[i];
  if (r) chooseRegion(r.id);
}
let touchX = 0,
  touchY = 0;
function touchStart(e: TouchEvent) {
  touchX = e.changedTouches[0]?.clientX || 0;
  touchY = e.changedTouches[0]?.clientY || 0;
}
function touchEnd(e: TouchEvent) {
  const t = e.changedTouches[0];
  if (t && Math.abs(t.clientX - touchX) > 65 && Math.abs(t.clientY - touchY) < 45)
    stepRegion(t.clientX < touchX ? 1 : -1);
}
function submit() {
  locationRequest++;
  theme.value = '';
  category.value = '';
  void load();
}
function detail(p: Place) {
  if (busy.value) return;
  remember();
  router.push({ path: '/places/' + p.id, query: { from: 'explore', region: region.value } });
}
function scrollTo(el?: HTMLElement) {
  if (!el || !panel.value) return;
  panel.value.scrollTo({
    top: el.offsetTop - panel.value.offsetTop - 14,
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  });
}
async function changePage(next: number) {
  if (busy.value || next < 1 || next > pages.value) return;
  page.value = next;
  if (theme.value) {
    places.value = candidates.value.slice((next - 1) * size, next * size);
    remember();
  } else await load(false);
  await nextTick();
  scrollTo(results.value);
}
function changeCategory(value: string) {
  locationRequest++;
  if (value === 'RECOMMENDED') {
    category.value = '';
    theme.value = theme.value || 'nature';
  } else {
    category.value = value;
    theme.value = '';
  }
  void load();
}
function clearAll() {
  theme.value = '';
  category.value = '';
  chooseRegion('');
}
onMounted(async () => {
  if (theme.value === 'nearby') theme.value = '';
  if (!saved) focusRegion(state.cities.find((c) => c.name === route.query.city));
  await load(!saved);
  await nextTick();
  if (saved && panel.value) panel.value.scrollTop = saved.scroll;
});
onBeforeUnmount(() => {
  remember();
  controller?.abort();
  generation++;
  locationRequest++;
});
</script>
<template>
  <main class="explore-page explore-journey">
    <div class="explore-top">
      <div>
        <span class="eyebrow">FIND YOUR HOKKAIDO</span>
        <h1>오늘, 마음이 향하는 곳.</h1>
        <p>지역과 가고 싶은 곳을 함께 검색해보세요.</p>
      </div>
    </div>
    <div class="journey-workspace">
      <aside ref="panel" class="journey-panel" aria-label="지역과 장소 탐색">
        <form class="search-bar" @submit.prevent="submit">
          <Icon name="search" :size="20" />
          <input
            aria-label="지역 또는 장소 검색"
            v-model="search"
            placeholder="지역 이름 또는 가고 싶은 장소"
          />
          <button
            v-if="search"
            type="button"
            class="icon-button"
            aria-label="검색어 지우기"
            @click="
              search = '';
              load();
            "
          >
            <Icon name="close" />
          </button>
          <button class="button dark small">검색</button>
        </form>
        <section class="region-chapter" aria-label="지역 소개">
          <div class="chapter-label">
            <span>01 / 지역을 펼쳐보세요</span>
            <span>
              {{ regionIndex < 0 ? 'ALL' : String(regionIndex + 1).padStart(2, '0') }} · 12 REGIONS
            </span>
          </div>
          <label class="region-select">
            여행 지역
            <select
              aria-label="여행 지역"
              :value="region"
              @change="chooseRegion(($event.target as HTMLSelectElement).value)"
            >
              <option value="">홋카이도 전체</option>
              <option v-for="r in state.regions" :key="r.id" :value="r.id">{{ r.name }}</option>
            </select>
          </label>
          <div
            class="region-story"
            :class="'region-tone-' + (regionIndex % 4)"
            @touchstart.passive="touchStart"
            @touchend.passive="touchEnd"
          >
            <Snowfall />
            <div class="story-landscape" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <Transition name="chapter" mode="out-in">
              <div :key="region" class="story-content">
                <span class="story-ja">{{ selectedRegion?.ja || '北海道' }}</span>
                <h2>{{ selectedRegion?.name || '홋카이도' }}</h2>
                <p class="story-mood">{{ story.mood }}</p>
                <p>{{ story.intro }}</p>
                <div class="story-tags">
                  <span v-for="tag in story.tags" :key="tag">{{ tag }}</span>
                </div>
              </div>
            </Transition>
            <div class="story-controls">
              <button class="icon-button" aria-label="이전 지역" @click="stepRegion(-1)">←</button>
              <span>다음 여행 장면을 넘겨보세요</span>
              <button class="icon-button" aria-label="다음 지역" @click="stepRegion(1)">→</button>
            </div>
          </div>
          <button class="chapter-next" @click="scrollTo(themed)">
            {{ selectedRegion?.name || '홋카이도' }}에서 취향 고르기
            <span>↓</span>
          </button>
        </section>
        <section ref="themed" class="theme-chapter" aria-label="상황별 탐색">
          <div class="chapter-label"><span>02 / 오늘의 여행은 어떤가요?</span></div>
          <h2>마음이 가는 장면을 골라요.</h2>
          <div class="theme-grid">
            <button
              v-for="[id, label, caption] in themes"
              :key="id"
              :aria-label="label"
              :class="{ active: theme === id }"
              :aria-pressed="theme === id"
              @click="chooseTheme(id!)"
            >
              <strong>{{ label }}</strong>
              <small>{{ caption }}</small>
              <span aria-hidden="true">{{ theme === id ? '✓' : '↗' }}</span>
            </button>
          </div>
          <div v-if="theme" class="discovery-context">
            <label>
              여행 날짜
              <input type="date" v-model="travelDate" @change="load()" />
            </label>
          </div>
          <button class="chapter-next" @click="scrollTo(results)">발견한 장소 보기 ↓</button>
        </section>
        <section ref="results" class="places-chapter" aria-label="장소 목록">
          <div class="chapter-label"><span>03 / 검색 결과</span></div>
          <div class="results-heading">
            <span>
              {{ selectedRegion?.name || '홋카이도' }}의 발견
              <small>{{ count.toLocaleString() }}곳</small>
            </span>
          </div>

          <div class="category-tabs">
            <button
              v-for="[id, label] in [
                ['', '전체'],
                ['RECOMMENDED', '추천'],
                ['ATTRACTION', '가볼 곳'],
                ['RESTAURANT', '먹을 곳'],
                ['LODGING', '머물 곳'],
              ]"
              :key="id"
              :class="{ active: id === 'RECOMMENDED' ? !!theme : !theme && category === id }"
              :aria-pressed="id === 'RECOMMENDED' ? !!theme : !theme && category === id"
              @click="changeCategory(id!)"
            >
              {{ label }}
            </button>
          </div>
          <p v-if="theme" class="candidate-note">
            조건에 맞는 {{ count }}곳 중 {{ candidates.length }}곳을 불러왔어요. 추천은 선택한 테마
            기준입니다.
          </p>
          <p v-if="discoveryNotice" class="discovery-notice">{{ discoveryNotice }}</p>
          <div class="result-scroll" :aria-busy="busy">
            <p v-if="error" role="alert" class="form-error">
              {{ error }}
              <button type="button" @click="load()">다시 시도</button>
            </p>
            <div v-else-if="busy" class="empty-state">
              <span class="spinner" />
              다음 장면을 찾고 있어요…
            </div>
            <div v-else-if="!places.length" class="empty-state">
              <Icon name="search" :size="32" />
              <h3>아직 찾지 못했어요</h3>
              <p>분류 정보가 부족할 수 있어요. 지역이나 키워드를 바꿔보세요.</p>
              <button class="button subtle small" @click="clearAll">전체 장소 보기</button>
            </div>
            <Transition name="place-page" mode="out-in">
              <div
                v-if="!busy && !error"
                :key="region + theme + category + page + search"
                class="place-page"
              >
                <PlaceCard v-for="p in places" :key="p.id" :place="p" @select="detail(p)" />
              </div>
            </Transition>
          </div>
          <nav
            v-if="!error && (count || places.length)"
            class="place-pagination"
            aria-label="장소 페이지"
          >
            <button :disabled="busy || page === 1" @click="changePage(page - 1)">← 이전</button>
            <span aria-live="polite">{{ page }} / {{ pages }}</span>
            <button :disabled="busy || page >= pages" @click="changePage(page + 1)">
              다음 장소 →
            </button>
          </nav>
          <p class="results-foot">
            지도에는 현재 페이지의 장소가 표시돼요.
            <br />
            지역 구분은 관광권 기준의 근사 범위입니다.
          </p>
        </section>
      </aside>
      <div class="explore-map journey-map">
        <TravelMap
          :places="places"
          :center="center"
          :zoom="zoom"
          @select="detail"
          @region="chooseRegion"
          @viewport="
            (v) => {
              center = v.center;
              zoom = v.zoom;
            }
          "
        />
        <div class="journey-map-caption">
          <span class="red-dot" />
          <strong>{{ selectedRegion?.name || 'HOKKAIDO' }}</strong>
          <span>{{ busy ? '장소를 찾는 중' : places.length + '개의 여행 장면' }} · 검색</span>
        </div>
      </div>
    </div>
  </main>
</template>
