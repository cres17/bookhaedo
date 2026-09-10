<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, json } from '../api';
import { state, notify, selectTrip, categoryName, regionName, safeUrl } from '../store';
import type { Place, Trip, TripSummary } from '../types';
import TravelMap from '../components/TravelMap.vue';
import Icon from '../components/Icon.vue';
const route = useRoute(),
  router = useRouter(),
  place = ref<Place | null>(null),
  error = ref(''),
  busy = ref(false),
  picker = ref(false),
  added = ref(false),
  addedSegment = ref<any>(null),
  routePending = ref(false),
  trips = ref<TripSummary[]>([]),
  trip = ref<Trip | null>(null),
  tripId = ref(state.activeTrip),
  day = ref(state.activeDate);
const enrichment = ref<any>(null),
  enriching = ref(false),
  photoFailed = ref(false);
const loadingTrip = ref(false);
let tripRequest = 0;
onBeforeUnmount(() => {
  tripRequest++;
});
async function enrich() {
  enriching.value = true;
  try {
    enrichment.value = await api('/places/' + route.params.id + '/enrichment');
  } catch (e: any) {
    enrichment.value = { available: false, notice: e.message };
  } finally {
    enriching.value = false;
  }
}
const displayName = computed(() => place.value?.name);
async function copyOriginal() {
  try {
    await navigator.clipboard.writeText(place.value?.nameJa || '');
    notify('일본어 이름을 복사했어요.');
  } catch {
    notify('복사할 수 없습니다. 아래 일본어 이름을 직접 선택해주세요.');
  }
}
const priceName = (value: string) =>
  ({
    PRICE_LEVEL_FREE: '무료',
    PRICE_LEVEL_INEXPENSIVE: '저렴한 편',
    PRICE_LEVEL_MODERATE: '보통',
    PRICE_LEVEL_EXPENSIVE: '비싼 편',
    PRICE_LEVEL_VERY_EXPENSIVE: '매우 비싼 편',
  })[value] || '가격 정보 미제공';
const googleUrl = computed(() =>
  place.value
    ? 'https://www.google.com/maps/search/?' +
      new URLSearchParams({
        api: '1',
        query: [place.value.nameJa, place.value.municipality || '', '北海道']
          .filter(Boolean)
          .join(' '),
      })
    : '',
);
onMounted(async () => {
  try {
    place.value = (await api('/places/' + route.params.id)).data;
    void enrich();
  } catch (e: any) {
    error.value = e.message;
  }
});
async function loadTrip() {
  const token = ++tripRequest,
    id = tripId.value;
  trip.value = null;
  loadingTrip.value = true;
  error.value = '';
  try {
    const data = await api<{ data: Trip }>('/trips/' + id);
    if (token !== tripRequest || id !== tripId.value) return;
    trip.value = data.data;
    if (!trip.value.days.some((d) => d.date === day.value))
      day.value = trip.value.days[0]?.date || '';
  } catch (e: any) {
    if (token === tripRequest) error.value = e.message;
  } finally {
    if (token === tripRequest) loadingTrip.value = false;
  }
}
async function openPicker() {
  error.value = '';
  try {
    trips.value = (await api('/trips')).data;
    if (!trips.value.length) {
      notify('장소를 담을 여행을 먼저 만들어주세요.');
      router.push('/trips');
      return;
    }
    if (!trips.value.some((t) => t.id === tripId.value)) tripId.value = trips.value[0]!.id;
    await loadTrip();
    picker.value = true;
  } catch (e: any) {
    error.value = e.message;
  }
}
async function add() {
  if (
    busy.value ||
    loadingTrip.value ||
    !place.value ||
    !trip.value ||
    trip.value.id !== tripId.value
  )
    return;
  const id = tripId.value,
    date = day.value;
  if (!trip.value.days.some((d) => d.date === date)) return;
  busy.value = true;
  error.value = '';
  try {
    await api(`/trips/${id}/days/${date}/items`, json('POST', { placeId: place.value.id }));
    selectTrip(id, date);
    picker.value = false;
    added.value = true;
    addedSegment.value = null;
    routePending.value = true;
    void api(`/trips/${id}/days/${date}/routes`)
      .then((result) => {
        addedSegment.value = result.segments.at(-1) || null;
      })
      .catch(() => notify('장소는 저장됐지만 경로는 다시 확인해야 해요.'))
      .finally(() => (routePending.value = false));
  } catch (e: any) {
    if (e.code === 'DUPLICATE_PLACE') notify(e.message);
    else error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <main class="detail-page">
    <RouterLink
      :to="{ path: '/explore', query: { region: route.query.region || place?.regionId } }"
      class="back-link"
    >
      <Icon name="back" />
      탐색으로 돌아가기
    </RouterLink>
    <p v-if="error && !picker" class="form-error" role="alert">
      {{ error }}
      <button type="button" class="icon-button" aria-label="오류 닫기" @click="error = ''">
        ×
      </button>
    </p>
    <div v-if="!place && !error" class="empty-state">
      <span class="spinner" />
      장소를 불러오고 있어요
    </div>
    <template v-if="place">
      <div class="detail-heading">
        <div>
          <span class="eyebrow">
            {{ regionName(place.regionId) }} · {{ categoryName(place.category) }}
          </span>
          <h1>{{ displayName }}</h1>
          <p lang="ja">{{ place.nameJa }}</p>
          <button class="text-button" @click="copyOriginal">장소명 복사</button>
        </div>
        <button class="button dark" @click="openPicker">
          <Icon name="plus" />
          여행에 담기
        </button>
      </div>
      <div class="detail-grid">
        <div class="detail-map">
          <TravelMap
            :places="[place]"
            :center="{ latitude: place.latitude, longitude: place.longitude }"
            :zoom="14"
          />
        </div>
        <section class="detail-info">
          <h2>방문을 위한 작은 메모</h2>
          <dl>
            <div>
              <dt>
                <Icon name="pin" />
                위치
              </dt>
              <dd>
                {{
                  enrichment?.address ||
                  place.address ||
                  '상세 주소 미등록 · 지도에서 위치를 확인하세요.'
                }}
              </dd>
            </div>
            <div>
              <dt>
                <Icon name="clock" />
                운영시간
              </dt>
              <dd>
                {{
                  enrichment?.openingHours?.join(' · ') ||
                  place.openingHours ||
                  '운영시간 정보가 아직 없어요.'
                }}
              </dd>
            </div>
            <div>
              <dt>
                <Icon name="calendar" />
                계절 · 운영기간
              </dt>
              <dd>{{ place.seasonNotice }}</dd>
            </div>
          </dl>
          <a :href="googleUrl" target="_blank" rel="noreferrer" class="button subtle wide">
            Google Maps에서 보기
            <Icon name="external" />
          </a>
          <a
            v-if="safeUrl(place.website)"
            :href="safeUrl(place.website)"
            target="_blank"
            rel="noreferrer"
            class="text-button official-link"
          >
            등록된 웹사이트 · 수집 자료
            <Icon name="external" :size="16" />
          </a>
          <div class="source-note">
            장소 정보는 등록 이후 바뀔 수 있어요. 출발 전 운영 여부를 확인해주세요.
            <br />
            <a
              v-for="s in place.sources"
              :key="s.url"
              :href="safeUrl(s.url)"
              target="_blank"
              rel="noreferrer"
            >
              {{ s.source }} · {{ s.license }} ↗
            </a>
          </div>
        </section>
      </div>
      <section class="enrichment">
        <h2>장소 상세정보</h2>
        <p v-if="enriching">한국어 상세정보를 확인하고 있어요…</p>
        <template v-else-if="enrichment?.available">
          <p>
            <a :href="safeUrl(enrichment.url)" target="_blank" rel="noreferrer">
              Google Maps에서 제공한 정보 ↗
            </a>
          </p>
          <figure v-if="enrichment.photo && !photoFailed">
            <img
              class="detail-photo"
              :src="enrichment.photo.url"
              :alt="displayName + ' 사진'"
              @error="photoFailed = true"
            />
            <figcaption class="photo-attribution">
              <a :href="safeUrl(enrichment.photo.sourceUrl)" target="_blank" rel="noreferrer">
                사진 원본
              </a>
              ·
              <a
                v-for="author in enrichment.photo.authors"
                :key="author.displayName"
                :href="safeUrl(author.uri)"
                target="_blank"
                rel="noreferrer"
              >
                {{ author.displayName }}
              </a>
            </figcaption>
          </figure>
          <p v-else>등록된 사진이 없거나 불러올 수 없어요.</p>
          <dl class="detail-metadata">
            <div>
              <dt>카테고리</dt>
              <dd>{{ enrichment.category || categoryName(place.category) }}</dd>
            </div>
            <div>
              <dt>평점</dt>
              <dd>
                {{ enrichment.rating ?? '미제공' }} · 리뷰
                {{ enrichment.reviewCount ?? '미제공' }}개
              </dd>
            </div>
            <div>
              <dt>전화번호</dt>
              <dd>{{ enrichment.phone || place.phone || '미제공' }}</dd>
            </div>
            <div>
              <dt>가격대</dt>
              <dd>{{ priceName(enrichment.priceLevel) }}</dd>
            </div>
            <div>
              <dt>영업 상태 / 휴무</dt>
              <dd>
                {{
                  enrichment.businessStatus === 'CLOSED_PERMANENTLY'
                    ? '폐업'
                    : enrichment.businessStatus === 'CLOSED_TEMPORARILY'
                      ? '임시 휴업'
                      : '정기 운영시간을 확인하세요.'
                }}
                <br />
                {{ enrichment.openingHours?.join(' · ') || '정기 휴무일 미제공' }}
              </dd>
            </div>
            <div>
              <dt>장소 설명</dt>
              <dd>
                {{
                  enrichment.description || place.tags?.['description:ko'] || '한국어 설명 미제공'
                }}
              </dd>
            </div>
          </dl>
          <a
            v-if="safeUrl(enrichment.website)"
            :href="safeUrl(enrichment.website)"
            target="_blank"
            rel="noreferrer"
            class="button subtle"
          >
            등록된 웹사이트 · Google 제공
          </a>
          <p class="discovery-notice">
            일본어 리뷰 {{ enrichment.reviewEvidence.japaneseCount }} / 제공 표본
            {{ enrichment.reviewEvidence.sampleCount }}개. {{ enrichment.reviewEvidence.notice }}
          </p>
          <div class="review-list">
            <h2>방문자 리뷰</h2>
            <p v-if="!enrichment.reviews.length">제공된 리뷰가 없어요.</p>
            <article v-for="(review, i) in enrichment.reviews" :key="i">
              <a :href="safeUrl(review.authorUri)" target="_blank" rel="noreferrer">
                {{ review.author }}
              </a>
              · {{ review.rating }} / 5
              <p class="review-language">
                {{ review.publishedAt?.slice(0, 10) }} · 원문 언어 {{ review.language || '미확인' }}
                {{ review.translated ? '· 번역된 리뷰' : '' }}
              </p>
              <p>{{ review.text }}</p>
              <details v-if="review.translated">
                <summary>원문 보기</summary>
                <p>{{ review.originalText }}</p>
              </details>
              <a :href="safeUrl(review.url || enrichment.url)" target="_blank" rel="noreferrer">
                Google Maps에서 리뷰 보기 ↗
              </a>
            </article>
          </div>
          <p v-for="(a, i) in enrichment.attributions" :key="i">
            <a :href="safeUrl(a.providerUri)" target="_blank" rel="noreferrer">{{ a.provider }}</a>
          </p>
        </template>
        <template v-else>
          <p>{{ enrichment?.notice || '추가 정보 미제공' }}</p>
          <p>사진·평점·리뷰·가격대는 기본 OSM 데이터에 없을 수 있어요.</p>
          <button class="button subtle" @click="enrich">추가 정보 다시 확인</button>
        </template>
      </section>
    </template>
    <div v-if="picker" class="modal-backdrop" @click.self="picker = false">
      <section class="modal" v-dialog role="dialog" aria-modal="true" aria-labelledby="addTitle">
        <button class="icon-button modal-close" aria-label="닫기" @click="picker = false">
          <Icon name="close" />
        </button>
        <h2 id="addTitle">어느 하루에 담을까요?</h2>
        <p>{{ place?.name }}</p>
        <form @submit.prevent="add">
          <label>
            여행
            <select v-model="tripId" :disabled="busy" @change="loadTrip">
              <option v-for="t in trips" :key="t.id" :value="t.id">{{ t.title }}</option>
            </select>
          </label>
          <label>
            날짜
            <select v-model="day" :disabled="busy || loadingTrip">
              <option v-for="(d, i) in trip?.days" :key="d.id" :value="d.date">
                DAY {{ i + 1 }} · {{ d.date }}
              </option>
            </select>
          </label>
          <p v-if="error" role="alert" class="form-error">{{ error }}</p>
          <button class="button dark wide" :disabled="busy || loadingTrip || !trip">
            {{ loadingTrip ? '여행을 불러오는 중…' : busy ? '저장하는 중…' : '이 날짜에 담기' }}
            <Icon name="plus" />
          </button>
        </form>
      </section>
    </div>
    <div v-if="added" class="modal-backdrop">
      <section
        class="modal success-modal"
        v-dialog
        role="dialog"
        aria-modal="true"
        aria-label="장소 추가 완료"
      >
        <button class="icon-button modal-close" aria-label="닫기" @click="added = false">
          <Icon name="close" />
        </button>
        <Icon name="check" :size="36" />
        <h2>여행에 담았어요.</h2>
        <p>{{ place?.name }} · {{ day }}</p>
        <p v-if="routePending">이전 장소에서 오는 길을 계산하고 있어요…</p>
        <p v-else-if="addedSegment">
          이전 장소 → {{ (addedSegment.distanceMeters / 1000).toFixed(1) }}km
          <span v-if="addedSegment.durationSeconds !== null">
            · 약 {{ Math.ceil(addedSegment.durationSeconds / 60) }}분
          </span>
          <span v-else>· 직선거리, 이동시간 미확인</span>
        </p>
        <RouterLink
          class="button dark wide"
          :to="{ path: '/explore', query: { region: route.query.region || place?.regionId } }"
        >
          계속 탐색하기
        </RouterLink>
        <RouterLink class="button subtle wide" :to="'/trips/' + tripId">
          여행 일정으로 이동하기
        </RouterLink>
      </section>
    </div>
  </main>
</template>
