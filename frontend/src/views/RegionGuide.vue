<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { state, localToday } from '../store';
import { regionStories } from '../region-stories';
import { regionGuides, seasons, seasonForDate } from '../region-guides';
import type { Season } from '../region-guides';
import { regionCulture, accessNotices, tipSentences, eventSearchUrl } from '../region-culture';
import Crystal from '../components/Crystal.vue';
const route = useRoute(),
  router = useRouter();
const region = computed(() => state.regions.find((r) => r.id === route.params.id));
const guide = computed(() => regionGuides[String(route.params.id)]);
const season = computed(
  () =>
    seasons.find((s) => s.id === route.query.season) ||
    seasons.find((s) => s.id === seasonForDate(String(route.query.date || localToday())))!,
);
const chapter = computed(() => guide.value?.seasons[season.value.id]);
const culture = computed(() => regionCulture[String(route.params.id)]);
const notices = computed(() => accessNotices[String(route.params.id)]?.[season.value.id] || []);
const matchingEvents = computed(
  () => culture.value?.events.filter((event) => event.seasons.includes(season.value.id)) || [],
);
const visibleEvents = computed(() =>
  matchingEvents.value.length ? matchingEvents.value : culture.value?.events || [],
);
const direction = ref('next');
function chooseSeason(id: Season) {
  if (id === season.value.id) return;
  direction.value =
    seasons.findIndex((s) => s.id === id) > seasons.findIndex((s) => s.id === season.value.id)
      ? 'next'
      : 'previous';
  void router.replace({ query: { ...route.query, season: id } });
}
function seasonKey(event: KeyboardEvent) {
  const index = seasons.findIndex((s) => s.id === season.value.id);
  const next =
    event.key === 'ArrowRight'
      ? (index + 1) % 4
      : event.key === 'ArrowLeft'
        ? (index + 3) % 4
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? 3
            : -1;
  if (next < 0) return;
  event.preventDefault();
  const button = (event.currentTarget as HTMLElement).querySelectorAll('button')[next];
  button?.focus({ preventScroll: true });
  chooseSeason(seasons[next]!.id);
}
let touch: { x: number; y: number } | null = null;
function touchStart(event: TouchEvent) {
  if ((event.target as HTMLElement).closest('a,button,select,input')) return;
  const point = event.touches[0];
  touch = point ? { x: point.clientX, y: point.clientY } : null;
}
function touchEnd(event: TouchEvent) {
  const start = touch,
    end = event.changedTouches[0];
  touch = null;
  if (!start || !end) return;
  const dx = end.clientX - start.x,
    dy = end.clientY - start.y;
  if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
  const next = seasons.findIndex((s) => s.id === season.value.id) + (dx < 0 ? 1 : -1);
  if (next >= 0 && next < seasons.length) chooseSeason(seasons[next]!.id);
}
function chooseRegion(event: Event) {
  void router.push({
    path: `/regions/${(event.target as HTMLSelectElement).value}`,
    query: { season: season.value.id },
  });
}
const exploreLink = computed(() => ({
  path: '/explore',
  query: region.value ? { region: region.value.id } : {},
}));
</script>

<template>
  <main class="region-guide-page" :data-season="season.id">
    <nav class="guide-breadcrumb" aria-label="지역 안내 탐색">
      <RouterLink :to="exploreLink">← 여행 탐색</RouterLink>
      <RouterLink v-if="region" :to="{ path: '/regions', query: { season: season.id } }">
        12개 지역 모두 보기
      </RouterLink>
    </nav>
    <template v-if="!route.params.id">
      <header class="guide-library-header">
        <span class="guide-eyebrow">HOKKAIDO · 12 REGIONS</span>
        <h1>
          어떤 계절에,
          <br />
          어디로 떠날까요?
        </h1>
        <p>
          도시의 산책부터 섬의 바람까지.
          <br />
          지역마다 다른 사계절을 먼저 만나보세요.
        </p>
      </header>
      <div class="guide-season-picker" role="group" aria-label="여행 계절" @keydown="seasonKey">
        <button
          v-for="s in seasons"
          :key="s.id"
          :aria-pressed="season.id === s.id"
          @click="chooseSeason(s.id)"
        >
          <strong>{{ s.name }}</strong>
          <span>{{ s.months }}</span>
        </button>
      </div>
      <div class="season-deck" @touchstart.passive="touchStart" @touchend.passive="touchEnd">
        <Transition :name="`season-${direction}`">
          <div :key="season.id" class="guide-region-grid season-slide">
            <RouterLink
              v-for="(r, index) in state.regions"
              :key="r.id"
              :to="{ path: `/regions/${r.id}`, query: { season: season.id } }"
              class="guide-region-card"
            >
              <div class="region-card-visual" aria-hidden="true">
                <span class="region-card-index">{{ String(index + 1).padStart(2, '0') }}</span>
                <strong class="region-card-ja">{{ r.ja }}</strong>
                <Crystal :size="172" />
              </div>
              <div class="region-card-copy">
                <h2>
                  {{ r.name }}
                  <span aria-hidden="true">→</span>
                </h2>
                <p>{{ regionGuides[r.id]?.seasons[season.id].title }}</p>
              </div>
            </RouterLink>
          </div>
        </Transition>
      </div>
    </template>
    <template v-else-if="region && guide && chapter">
      <header class="guide-hero">
        <div class="guide-hero-copy">
          <span class="guide-eyebrow">REGION GUIDE · {{ region.ja }}</span>
          <h1>{{ region.name }}</h1>
          <p class="guide-mood">{{ regionStories[region.id]?.mood }}</p>
          <p>{{ regionStories[region.id]?.intro }}</p>
          <div class="guide-tags">
            <span v-for="tag in regionStories[region.id]?.tags" :key="tag">{{ tag }}</span>
          </div>
        </div>
        <div class="guide-hero-aside">
          <span class="guide-season-symbol" aria-hidden="true">
            {{ { spring: '✿', summer: '☀', autumn: '❧', winter: '❄' }[season.id] }}
          </span>
          <span>{{ season.mark }} {{ region.name }}</span>
          <label>
            다른 지역 둘러보기
            <select :value="region.id" @change="chooseRegion">
              <option v-for="r in state.regions" :key="r.id" :value="r.id">{{ r.name }}</option>
            </select>
          </label>
        </div>
      </header>
      <section v-if="culture" class="guide-background" aria-labelledby="region-background-title">
        <span class="guide-eyebrow">이 지역을 이해하는 이야기</span>
        <h2 id="region-background-title">{{ culture.title }}</h2>
        <div class="guide-background-paragraphs">
          <p v-for="paragraph in culture.paragraphs" :key="paragraph">{{ paragraph }}</p>
        </div>
        <a :href="culture.source" target="_blank" rel="noopener noreferrer">
          지역 이야기 출처 ↗
          <span class="sr-only">(새 창)</span>
        </a>
      </section>
      <section class="guide-season-section" aria-labelledby="guide-season-title">
        <div class="guide-section-heading">
          <div>
            <span class="guide-eyebrow">FOUR SEASONS</span>
            <h2 id="guide-season-title">언제 떠나고 싶나요?</h2>
          </div>
          <span>계절을 골라 여행의 분위기를 살펴보세요</span>
        </div>
        <div class="guide-season-picker" role="group" aria-label="여행 계절" @keydown="seasonKey">
          <button
            v-for="s in seasons"
            :key="s.id"
            :aria-pressed="season.id === s.id"
            @click="chooseSeason(s.id)"
          >
            <strong>{{ s.name }}</strong>
            <span>{{ s.months }}</span>
          </button>
        </div>
        <p class="season-gesture-hint">계절을 선택하거나 내용을 좌우로 넘겨보세요.</p>
        <div class="season-deck" @touchstart.passive="touchStart" @touchend.passive="touchEnd">
          <Transition :name="`season-${direction}`">
            <div :key="season.id" class="season-slide" aria-live="polite">
              <div class="guide-season-content">
                <div class="guide-season-intro">
                  <span class="guide-eyebrow">{{ season.name }}의 {{ region.name }}</span>
                  <h3>{{ chapter.title }}</h3>
                  <p>{{ chapter.description }}</p>
                </div>
                <aside class="guide-visit-tip">
                  <strong>이 계절에 알아두면 좋아요</strong>
                  <ul class="guide-tip-lines">
                    <li v-for="line in tipSentences(chapter.tip)" :key="line">{{ line }}</li>
                  </ul>
                  <div class="guide-tip-links">
                    <a
                      v-for="event in matchingEvents"
                      :key="event.name"
                      :href="event.url"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {{ event.name }} 일정 확인 ↗
                      <span class="sr-only">(새 창)</span>
                    </a>
                    <a :href="eventSearchUrl" target="_blank" rel="noopener noreferrer">
                      지역·날짜별 행사 찾기 ↗
                      <span class="sr-only">(새 창)</span>
                    </a>
                  </div>
                </aside>
              </div>
              <div v-if="notices.length" class="guide-access-notices" aria-label="방문 제한 안내">
                <article v-for="notice in notices" :key="notice.label">
                  <strong>{{ notice.label }}</strong>
                  <p v-for="line in tipSentences(notice.text)" :key="line">{{ line }}</p>
                  <a :href="notice.source" target="_blank" rel="noopener noreferrer">
                    공식 운영·통제 안내 ↗
                    <span class="sr-only">(새 창)</span>
                  </a>
                </article>
              </div>
              <div class="guide-section-heading">
                <div>
                  <h2>{{ season.name }}, 먼저 만나볼 장소</h2>
                  <p>공식 관광 자료를 바탕으로 고른 추천이에요.</p>
                </div>
                <span>{{ chapter.spots.length }}곳</span>
              </div>
              <div class="guide-spots">
                <article
                  v-for="(spot, index) in chapter.spots"
                  :key="season.id + spot.name"
                  class="guide-spot"
                >
                  <span class="guide-spot-number">{{ String(index + 1).padStart(2, '0') }}</span>
                  <div class="guide-spot-copy">
                    <h3>{{ spot.name }}</h3>
                    <p>{{ spot.reason }}</p>
                    <div class="guide-spot-actions">
                      <RouterLink
                        :to="{ path: '/explore', query: { region: region.id, q: spot.query } }"
                      >
                        이 장소 검색하기 →
                      </RouterLink>
                      <a :href="spot.source" target="_blank" rel="noopener noreferrer">
                        공식 관광 안내 ↗
                        <span class="sr-only">(새 창)</span>
                      </a>
                    </div>
                  </div>
                </article>
              </div>
              <section v-if="culture" class="guide-events" aria-labelledby="guide-events-title">
                <div class="guide-section-heading">
                  <div>
                    <span class="guide-eyebrow">지역을 기념하는 방법</span>
                    <h2 id="guide-events-title">
                      {{
                        matchingEvents.length
                          ? season.name + '의 축제와 행사'
                          : '다른 계절의 대표 행사도 만나보세요'
                      }}
                    </h2>
                    <p>
                      {{
                        matchingEvents.length
                          ? '왜 시작됐고, 어떻게 함께 즐길까요?'
                          : '아래 행사는 선택한 계절의 개최를 뜻하지 않습니다. 행사별 계절을 확인하세요.'
                      }}
                    </p>
                  </div>
                </div>
                <article v-for="event in visibleEvents" :key="event.name" class="guide-event">
                  <div class="guide-event-heading">
                    <h3>{{ event.name }}</h3>
                    <span>
                      {{
                        event.seasons
                          .map((id) => seasons.find((s) => s.id === id)?.name)
                          .join(' · ')
                      }}
                      행사
                    </span>
                  </div>
                  <div class="guide-event-story">
                    <div>
                      <h4>축제에 담긴 이야기</h4>
                      <p>{{ event.origin }}</p>
                    </div>
                    <div>
                      <h4>이렇게 기념해요</h4>
                      <p>{{ event.experience }}</p>
                    </div>
                  </div>
                  <div class="guide-event-links">
                    <a
                      class="guide-schedule-link"
                      :href="event.url"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {{ event.name }} 공식 일정·행사 안내 ↗
                      <span class="sr-only">(새 창)</span>
                    </a>
                    <a
                      v-if="event.source !== event.url"
                      :href="event.source"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      유래·문화 이야기 출처 ↗
                      <span class="sr-only">(새 창)</span>
                    </a>
                  </div>
                </article>
                <aside class="guide-event-search">
                  <div>
                    <strong>내 여행일에 열리는 행사를 찾고 싶다면</strong>
                    <p>
                      공식 행사 검색에서 지역·날짜·축제·일루미네이션을 골라 확인하세요. 지난 회차
                      안내인 경우 다음 개최 공지를 기다려야 합니다.
                    </p>
                  </div>
                  <a :href="eventSearchUrl" target="_blank" rel="noopener noreferrer">
                    지역·날짜별 행사 검색 ↗
                    <span class="sr-only">(새 창)</span>
                  </a>
                </aside>
              </section>
            </div>
          </Transition>
        </div>
      </section>
      <section class="guide-plan-note">
        <div>
          <h2>이 지역은 이렇게 계획해보세요</h2>
          <p>{{ guide.note }}</p>
        </div>
        <RouterLink class="button dark" :to="exploreLink">
          {{ region.name }} 장소 둘러보기 →
        </RouterLink>
      </section>
      <p class="guide-source-note">
        자료: 지역 관광기관·행사 주최 측 공식 안내 (각 항목에 출처 연결) · 확인일 2026. 9. 14.
        <br />
        계절 구분은 여행 아이디어를 위한 기준이에요. 개화·단풍·축제·시설 운영은 여행일에 맞춰 각
        장소의 공식 안내에서 확인해 주세요.
      </p>
    </template>
    <section v-else class="guide-library-header">
      <h1>지역을 찾지 못했어요</h1>
      <p>12개 지역 안내에서 여행지를 다시 골라보세요.</p>
      <RouterLink class="button dark" to="/regions">지역 안내 보기</RouterLink>
    </section>
  </main>
</template>

<style scoped>
.guide-tip-links {
  display: grid;
  gap: 4px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid #c9bfcf;
}
.guide-tip-links a {
  display: flex;
  align-items: center;
  min-height: 44px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--season-color);
  text-decoration: underline;
  text-underline-offset: 4px;
}
.guide-background {
  margin: 32px 0 40px;
  padding: 8px 0 28px;
  border-bottom: 1px solid #e4dfe9;
}
.guide-background h2 {
  font-size: 25px;
  margin: 12px 0 20px;
}
.guide-background-paragraphs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 32px;
}
.guide-background p {
  font-size: 16px;
  line-height: 1.95;
  color: #625d70;
}
.guide-background > a {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  margin-top: 12px;
  font-size: 14px;
  color: var(--season-color);
}
.season-deck {
  position: relative;
  isolation: isolate;
  overflow: clip;
}
:deep(.season-scene) {
  margin: 20px 0 26px;
}
.season-slide {
  width: 100%;
  min-width: 0;
}
.season-next-enter-active,
.season-previous-enter-active {
  transition:
    transform 0.24s ease,
    opacity 0.24s ease;
}
.season-next-leave-active,
.season-previous-leave-active {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  pointer-events: none;
  transition:
    transform 0.18s ease,
    opacity 0.18s ease;
}
.season-next-enter-from {
  transform: translateX(36px);
  opacity: 0;
}
.season-next-leave-to {
  transform: translateX(-36px);
  opacity: 0;
}
.season-previous-enter-from {
  transform: translateX(-36px);
  opacity: 0;
}
.season-previous-leave-to {
  transform: translateX(36px);
  opacity: 0;
}
.season-gesture-hint {
  font-size: 13px;
  color: #7c7588;
  margin: 12px 0 0;
}
.guide-tip-lines {
  padding-left: 18px;
  margin: 12px 0 0;
  display: grid;
  gap: 12px;
  font-size: 15px;
  line-height: 1.8;
  color: #625d70;
}
.guide-tip-lines li::marker {
  color: var(--season-color);
}
.guide-access-notices {
  display: grid;
  gap: 12px;
  margin-bottom: 28px;
}
.guide-access-notices article {
  padding: 20px 24px;
  border-left: 4px solid #ab6742;
  background: #fff3e9;
  border-radius: 0 12px 12px 0;
}
.guide-access-notices strong {
  display: block;
  font-size: 16px;
  color: #88441f;
  margin-bottom: 12px;
}
.guide-access-notices p {
  font-size: 15px;
  line-height: 1.8;
  color: #714d3b;
  margin: 8px 0;
}
.guide-access-notices a {
  font-size: 14px;
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  color: #844621;
  text-decoration: underline;
  text-underline-offset: 4px;
}
.guide-events {
  margin-top: 40px;
}
.guide-event {
  margin: 16px 0;
  border: 1px solid #e2dce7;
  border-radius: 18px;
  background: white;
  padding: 26px;
}
.guide-event-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.guide-event h3 {
  font-size: 22px;
  margin: 0;
  line-height: 1.5;
}
.guide-event-heading > span {
  font-size: 13px;
  border-radius: 20px;
  padding: 6px 12px;
  color: var(--season-color);
  background: var(--season-tint);
}
.guide-event-story {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 28px;
  margin: 22px 0;
}
.guide-event h4 {
  font-size: 14px;
  color: var(--season-color);
  margin: 0 0 8px;
}
.guide-event p,
.guide-event-search p {
  font-size: 16px;
  color: #625d70;
  line-height: 1.9;
}
.guide-event-links {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px 20px;
  border-top: 1px solid #ede8f0;
  padding-top: 16px;
}
.guide-event-links a,
.guide-event-search a {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  font-size: 14px;
  line-height: 1.7;
  color: var(--season-color);
  text-decoration: underline;
  text-underline-offset: 4px;
}
.guide-event-links .guide-schedule-link {
  background: var(--season-tint);
  border-radius: 10px;
  padding: 10px 14px;
  text-decoration: none;
  font-weight: 600;
}
.guide-event-search {
  padding: 24px;
  background: var(--season-tint);
  border-radius: 16px;
  display: flex;
  gap: 24px;
  align-items: center;
}
.guide-event-search > div {
  flex: 1;
}
.guide-event-search strong {
  font-size: 17px;
}
.guide-event-search p {
  font-size: 14px;
  margin-top: 8px;
}
.guide-event-search > a {
  flex-shrink: 0;
  font-weight: 600;
}
@media (max-width: 700px) {
  .guide-background-paragraphs,
  .guide-event-story {
    grid-template-columns: 1fr;
    gap: 20px;
  }
  .guide-background h2 {
    font-size: 22px;
  }
  .guide-event {
    padding: 22px 20px;
  }
  .guide-event h3 {
    font-size: 21px;
  }
  .guide-event-search {
    display: block;
  }
  .guide-event-search > a {
    margin-top: 12px;
  }
  .guide-background {
    margin-top: 28px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .season-next-enter-active,
  .season-next-leave-active,
  .season-previous-enter-active,
  .season-previous-leave-active {
    transition: none !important;
    transform: none !important;
  }
}

.region-guide-page {
  --season-color: #726281;
  --season-tint: #f1eaf6;
  max-width: 1160px;
  margin: auto;
  padding: 32px 40px 80px;
  color: #303149;
  word-break: keep-all;
  overflow-wrap: anywhere;
}
.region-guide-page[data-season='spring'] {
  --season-color: #916079;
  --season-tint: #f9edf2;
}
.region-guide-page[data-season='summer'] {
  --season-color: #426c5b;
  --season-tint: #eaf3eb;
}
.region-guide-page[data-season='autumn'] {
  --season-color: #8e603e;
  --season-tint: #f6eee3;
}
.region-guide-page[data-season='winter'] {
  --season-color: #526b88;
  --season-tint: #eaf0f7;
}
.guide-breadcrumb {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 28px;
}
.guide-breadcrumb a {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  color: #55546b;
  font-size: 15px;
  text-decoration: none;
}
.guide-eyebrow {
  font-size: 12px;
  letter-spacing: 0.1em;
  color: var(--season-color);
  font-weight: 700;
}
.guide-hero {
  display: grid;
  grid-template-columns: 1fr 260px;
  gap: 40px;
  padding: 40px;
  background: var(--season-tint);
  border-radius: 24px;
}
.guide-hero h1,
.guide-library-header h1 {
  font-size: clamp(30px, 4vw, 46px);
  letter-spacing: -0.045em;
  line-height: 1.3;
  margin: 14px 0 16px;
}
.guide-hero-copy > p {
  font-size: 16px;
  line-height: 1.85;
  margin: 12px 0;
  max-width: 660px;
}
.guide-hero-copy .guide-mood {
  font-size: 20px;
  font-weight: 600;
}
.guide-tags {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 24px;
}
.guide-tags span {
  background: #ffffffa8;
  padding: 6px 12px;
  border-radius: 30px;
  font-size: 13px;
}
.guide-hero-aside {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  text-align: center;
  color: var(--season-color);
  font-size: 14px;
}
.guide-season-symbol {
  font-size: 78px;
  line-height: 1.2;
}
.guide-hero-aside label {
  width: 100%;
  margin-top: 12px;
  font-size: 13px;
  text-align: left;
}
.guide-hero-aside select {
  display: block;
  margin-top: 8px;
  width: 100%;
  min-height: 46px;
  padding: 10px;
  border: 1px solid #d5d1d9;
  border-radius: 10px;
  background: #fff;
  color: #303149;
  font-size: 15px;
}
.guide-season-section {
  margin-top: 44px;
}
.guide-section-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  margin: 24px 0 18px;
}
.guide-section-heading h2,
.guide-plan-note h2 {
  font-size: 23px;
  letter-spacing: -0.025em;
  margin: 6px 0;
}
.guide-section-heading > span,
.guide-section-heading p {
  font-size: 14px;
  color: #757181;
  margin: 8px 0;
}
.guide-season-picker {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  background: #f0eef3;
  padding: 6px;
  border-radius: 16px;
}
.guide-season-picker button {
  min-height: 66px;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 10px;
  border: 1px solid transparent;
  background: transparent;
  color: #6b6777;
  border-radius: 11px;
  cursor: pointer;
}
.guide-season-picker strong {
  font-size: 18px;
}
.guide-season-picker span {
  font-size: 13px;
}
.guide-season-picker button[aria-pressed='true'] {
  background: white;
  border-color: var(--season-color);
  color: var(--season-color);
  box-shadow: 0 2px 5px #30253b0b;
}
.guide-season-content {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 32px;
  margin: 28px 0 40px;
  align-items: start;
}
.guide-season-intro h3 {
  font-size: 27px;
  letter-spacing: -0.035em;
  margin: 10px 0 12px;
}
.guide-season-intro p,
.guide-visit-tip p,
.guide-spot p,
.guide-plan-note p {
  font-size: 16px;
  line-height: 1.85;
  margin: 8px 0 0;
  color: #646171;
}
.guide-visit-tip {
  background: var(--season-tint);
  padding: 22px 24px;
  border-radius: 16px;
}
.guide-visit-tip strong {
  font-size: 15px;
  color: var(--season-color);
}
.guide-visit-tip p {
  font-size: 15px;
}
.guide-spots {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.guide-spot {
  border: 1px solid #e4dfe9;
  border-radius: 18px;
  padding: 24px;
  display: flex;
  gap: 16px;
  background: #fff;
}
.guide-spot-number {
  color: var(--season-color);
  font-size: 14px;
  padding-top: 5px;
  font-weight: 700;
}
.guide-spot-copy {
  min-width: 0;
  flex: 1;
}
.guide-spot h3 {
  font-size: 20px;
  line-height: 1.5;
  margin: 0;
}
.guide-spot-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
  margin-top: 20px;
}
.guide-spot-actions a {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  color: var(--season-color);
}
.guide-spot-actions a:first-child {
  border-radius: 9px;
  background: var(--season-tint);
  padding: 0 12px;
}
.guide-plan-note {
  margin: 36px 0 24px;
  padding: 28px 0;
  border-top: 1px solid #e4dfe9;
  border-bottom: 1px solid #e4dfe9;
  display: flex;
  gap: 32px;
  align-items: center;
}
.guide-plan-note > div {
  flex: 1;
}
.guide-plan-note .button {
  flex-shrink: 0;
  white-space: normal;
  text-align: center;
  min-height: 48px;
  max-width: 280px;
}
.guide-source-note {
  font-size: 13px;
  line-height: 1.9;
  color: #797484;
}
.guide-library-header {
  padding: 24px 0 32px;
}
.guide-library-header p {
  font-size: 18px;
  line-height: 1.8;
  color: #6b6678;
}
.guide-region-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
  margin-top: 28px;
}
.guide-region-card {
  overflow: hidden;
  padding: 0;
  background: #fff;
  border: 1px solid #e4dfe9;
  border-radius: 22px;
  text-decoration: none;
  color: inherit;
  display: flex;
  flex-direction: column;
  transition:
    transform 0.35s var(--ease),
    box-shadow 0.35s var(--ease),
    border-color 0.35s ease;
}
.guide-region-card:hover,
.guide-region-card:focus-visible {
  transform: translateY(-5px);
  border-color: #d4dae5;
  box-shadow: 0 20px 42px #34405c14;
}
.guide-region-card h2 {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 24px;
  margin: 0 0 9px;
  letter-spacing: -0.04em;
}
.guide-region-card p {
  min-height: 2.9em;
  margin: 0;
  color: #858ca0;
  font-size: 16px;
  line-height: 1.55;
}
.region-card-visual {
  position: relative;
  height: 202px;
  overflow: hidden;
  padding: 24px;
  background: linear-gradient(
    145deg,
    color-mix(in srgb, var(--season-tint) 55%, #eef3f8),
    var(--season-tint)
  );
}
.region-card-ja {
  position: absolute;
  z-index: 1;
  left: 24px;
  bottom: 28px;
  color: color-mix(in srgb, var(--season-color) 72%, #34405c);
  font-size: clamp(36px, 3.4vw, 50px);
  font-weight: 500;
  line-height: 1;
  letter-spacing: 0.03em;
}
.region-card-index {
  position: relative;
  z-index: 3;
  color: #7a8ca5;
  font-size: 18px;
  font-weight: 650;
}
.region-card-visual .crystal {
  position: absolute;
  right: -23px;
  bottom: -34px;
  color: color-mix(in srgb, var(--season-color) 21%, white);
  transform: rotate(12deg);
  transition: transform 0.8s var(--ease);
}
.guide-region-card:hover .region-card-visual .crystal,
.guide-region-card:focus-visible .region-card-visual .crystal {
  transform: rotate(36deg) scale(1.03);
}
.region-card-copy {
  padding: 22px 24px 25px;
}
.guide-region-card h2 span {
  color: #607294;
}
.region-guide-page a:focus-visible,
.region-guide-page button:focus-visible,
.region-guide-page select:focus-visible {
  outline: 3px solid var(--season-color);
  outline-offset: 4px;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
@media (prefers-reduced-motion: reduce) {
  .guide-region-card,
  .region-card-visual .crystal {
    transition: none !important;
  }
}
@media (max-width: 800px) {
  .region-guide-page {
    padding: 20px 24px 60px;
  }
  .guide-hero {
    grid-template-columns: 1fr;
    gap: 20px;
    padding: 28px;
  }
  .guide-hero-aside {
    align-items: flex-start;
    text-align: left;
  }
  .guide-season-symbol,
  .guide-hero-aside > span:not(.guide-season-symbol) {
    display: none;
  }
  .guide-hero-aside label {
    margin: 0;
  }
  .guide-season-content {
    grid-template-columns: 1fr;
    gap: 20px;
  }
  .guide-section-heading > span {
    display: none;
  }
  .guide-region-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .guide-plan-note {
    flex-direction: column;
    align-items: stretch;
  }
  .guide-plan-note .button {
    max-width: none;
  }
}
@media (max-width: 520px) {
  .region-guide-page {
    padding: 12px 16px 48px;
  }
  .guide-breadcrumb {
    margin-bottom: 12px;
    gap: 8px;
  }
  .guide-breadcrumb a {
    font-size: 13px;
  }
  .guide-hero {
    padding: 24px 20px;
    border-radius: 18px;
  }
  .guide-hero-copy .guide-mood {
    font-size: 18px;
  }
  .guide-section-heading h2,
  .guide-plan-note h2 {
    font-size: 21px;
  }
  .guide-season-picker {
    gap: 4px;
  }
  .guide-season-picker button {
    flex-direction: column;
    gap: 4px;
    min-height: 66px;
  }
  .guide-season-picker strong {
    font-size: 17px;
  }
  .guide-season-picker span {
    font-size: 12px;
  }
  .guide-season-intro h3 {
    font-size: 24px;
  }
  .guide-spots,
  .guide-region-grid {
    grid-template-columns: 1fr;
  }
  .guide-spot {
    padding: 20px;
    gap: 12px;
  }
  .guide-season-section {
    margin-top: 30px;
  }
}
</style>
