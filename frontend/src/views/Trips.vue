<script setup lang="ts">
import TripMenu from '../components/TripMenu.vue';
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api, json } from '../api';
import { state, localToday, selectTrip } from '../store';
import type { TripSummary } from '../types';
import Icon from '../components/Icon.vue';
import Crystal from '../components/Crystal.vue';
const router = useRouter(),
  trips = ref<TripSummary[]>([]),
  creating = ref(false),
  busy = ref(false),
  error = ref(''),
  title = ref('나의 홋카이도'),
  startDate = ref(localToday()),
  days = ref(3),
  mode = ref('DRIVE');
async function load() {
  try {
    trips.value = (await api('/trips')).data;
  } catch (e: any) {
    error.value = e.message;
  }
}
onMounted(load);
async function create() {
  busy.value = true;
  error.value = '';
  try {
    const d = await api(
      '/trips',
      json('POST', {
        title: title.value,
        startDate: startDate.value,
        days: days.value,
        transportMode: mode.value,
      }),
    );
    selectTrip(d.data.id, startDate.value);
    await router.push('/trips/' + d.data.id);
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
const dateValue = (value: string) => new Date(value + 'T00:00:00+09:00');
const shortDate = (value: string) =>
  new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric' }).format(dateValue(value));
const startMonth = (value: string) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'Asia/Tokyo' })
    .format(dateValue(value))
    .toUpperCase();
const startDay = (value: string) => String(dateValue(value).getDate()).padStart(2, '0');
const transportName = (value: string) =>
  ({ DRIVE: '렌터카', TAXI: '택시', TRANSIT: '대중교통', WALK: '도보', BICYCLE: '자전거' })[
    value
  ] || value;
function tripStatus(trip: TripSummary) {
  const today = localToday();
  return today < trip.startDate
    ? { label: '떠나기 전', kind: 'upcoming' }
    : today > trip.endDate
      ? { label: '다녀온 여행', kind: 'past' }
      : { label: '여행 중', kind: 'active' };
}
</script>
<template>
  <main class="trips-page">
    <div class="section-heading">
      <div>
        <span class="eyebrow">YOUR LITTLE COLLECTION</span>
        <h1>{{ state.user?.name }} 님의 여행 서랍.</h1>
        <p>계획 중인 여행과 지난 여정을 한곳에서 관리하세요.</p>
      </div>
      <button class="button dark" @click="creating = true">
        <Icon name="plus" />
        새 여행 만들기
      </button>
    </div>
    <p v-if="error" role="alert" class="form-error">{{ error }}</p>
    <div v-if="!trips.length" class="trips-empty">
      <Crystal :size="96" />
      <h2>첫 페이지를 펼쳐보세요.</h2>
      <p>언제 떠날지 정하면, 그다음은 자유롭게.</p>
      <button class="button dark" @click="creating = true">
        첫 여행 만들기
        <Icon name="arrow" />
      </button>
    </div>
    <div v-else class="trip-grid">
      <article
        v-for="(trip, index) in trips"
        :key="trip.id"
        :class="['trip-tile', 'trip-tone-' + (index % 4)]"
      >
        <TripMenu :trip="trip" @changed="load" @deleted="load" />
        <RouterLink :to="'/trips/' + trip.id" class="trip-card">
          <div class="trip-card-art">
            <span class="trip-index">TRIP {{ String(index + 1).padStart(2, '0') }}</span>
            <Crystal :size="180" />
            <div class="trip-date-block">
              <small>{{ startMonth(trip.startDate) }}</small>
              <strong>{{ startDay(trip.startDate) }}</strong>
            </div>
            <span :class="['trip-status', tripStatus(trip).kind]">
              {{ tripStatus(trip).label }}
            </span>
          </div>
          <div class="trip-card-body">
            <span class="trip-period">
              <Icon name="calendar" :size="16" />
              {{ shortDate(trip.startDate) }} — {{ shortDate(trip.endDate) }}
            </span>
            <h2>{{ trip.title }}</h2>
            <div class="trip-facts">
              <span>
                <strong>{{ trip.days }}</strong>
                일
              </span>
              <i />
              <span>
                <Icon name="route" :size="15" />
                {{ transportName(trip.transportMode) }}
              </span>
            </div>
            <footer>
              <span>계획 이어가기</span>
              <span class="trip-arrow"><Icon name="arrow" :size="17" /></span>
            </footer>
          </div>
        </RouterLink>
      </article>
    </div>
    <div v-if="creating" class="modal-backdrop" @click.self="creating = false">
      <section
        v-dialog
        role="dialog"
        aria-modal="true"
        aria-labelledby="newTripTitle"
        class="modal"
      >
        <button class="icon-button modal-close" aria-label="닫기" @click="creating = false">
          <Icon name="close" />
        </button>
        <Crystal :size="44" />
        <h2 id="newTripTitle">이번 여행의 첫 페이지.</h2>
        <p>날짜와 이동 방법부터 가볍게 정해요.</p>
        <form @submit.prevent="create">
          <label>
            여행 이름
            <input v-model="title" required maxlength="100" autofocus />
          </label>
          <div class="form-row">
            <label>
              출발일
              <input type="date" v-model="startDate" required />
            </label>
            <label>
              여행 일수
              <input type="number" min="1" max="30" v-model.number="days" required />
            </label>
          </div>
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
          <p v-if="error" role="alert" class="form-error">{{ error }}</p>
          <button class="button dark wide" :disabled="busy">
            {{ busy ? '여행을 만드는 중…' : '여행 만들기' }}
            <Icon name="arrow" />
          </button>
        </form>
      </section>
    </div>
  </main>
</template>

<style scoped>
.trips-page {
  max-width: 1460px;
  padding: 64px clamp(22px, 7vw, 100px) 110px;
}
.trips-page .section-heading {
  margin-bottom: 44px;
}
.trips-page .section-heading h1 {
  font-size: clamp(36px, 4vw, 52px);
  margin-top: 13px;
}
.trips-page .section-heading p {
  font-size: 14px;
  color: #7e8798;
  margin-top: 12px;
}
.trip-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 26px;
}
.trip-tile {
  position: relative;
  min-width: 0;
  isolation: isolate;
}
.trip-card {
  display: block;
  border: 1px solid #e3e7ee;
  border-radius: 23px;
  overflow: hidden;
  background: #fff;
  box-shadow: 0 10px 35px #34405c0a;
  transition:
    transform 0.35s var(--ease),
    box-shadow 0.35s var(--ease),
    border-color 0.35s;
}
.trip-card:hover {
  transform: translateY(-7px);
  border-color: #d4dae5;
  box-shadow: 0 24px 55px #34405c16;
}
.trip-card-art {
  height: 218px;
  position: relative;
  overflow: hidden;
  padding: 25px;
  background: linear-gradient(145deg, #dfe8f2, #cddbea);
}
.trip-card-art:after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 78% 25%, #fff8, transparent 36%);
  pointer-events: none;
}
.trip-card-art .crystal {
  position: absolute;
  right: -30px;
  bottom: -38px;
  color: #536d9630;
  transform: rotate(12deg);
  transition: transform 0.8s var(--ease);
}
.trip-card:hover .trip-card-art .crystal {
  transform: rotate(50deg) scale(1.05);
}
.trip-tone-1 .trip-card-art {
  background: linear-gradient(145deg, #e9e3ef, #d8cee6);
}
.trip-tone-2 .trip-card-art {
  background: linear-gradient(145deg, #dcebe7, #c7ddd6);
}
.trip-tone-3 .trip-card-art {
  background: linear-gradient(145deg, #eee6de, #dfd2c4);
}
.trip-index {
  position: relative;
  z-index: 1;
  font: 600 9px 'DM Sans';
  letter-spacing: 2.2px;
  color: #708098;
}
.trip-date-block {
  position: absolute;
  left: 25px;
  bottom: 24px;
  z-index: 1;
  display: flex;
  flex-direction: column;
}
.trip-date-block small {
  font: 600 10px 'DM Sans';
  letter-spacing: 2px;
  color: #687990;
}
.trip-date-block strong {
  font: 500 54px 'DM Sans';
  line-height: 1;
  color: #41516a;
  margin-top: 5px;
}
.trip-status {
  position: absolute;
  right: 22px;
  bottom: 24px;
  z-index: 1;
  padding: 8px 11px;
  border-radius: 20px;
  background: #ffffffbd;
  color: #66758b;
  font-size: 10px;
  font-weight: 600;
  backdrop-filter: blur(9px);
}
.trip-status.active {
  background: #35415de8;
  color: #fff;
}
.trip-status.past {
  color: #8a8391;
}
.trip-card-body {
  padding: 24px 25px 22px;
}
.trip-period {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #8a94a6;
  font-size: 11px;
}
.trip-card-body h2 {
  font-size: 23px;
  line-height: 1.4;
  margin: 13px 0 18px;
  min-height: 64px;
}
.trip-facts {
  display: flex;
  align-items: center;
  gap: 11px;
  color: #748096;
  font-size: 12px;
}
.trip-facts span {
  display: flex;
  align-items: center;
  gap: 6px;
}
.trip-facts strong {
  font: 600 15px 'DM Sans';
  color: #44516b;
}
.trip-facts > i {
  width: 1px;
  height: 13px;
  background: #dfe3ea;
}
.trip-card-body footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid #edf0f4;
  margin-top: 21px;
  padding-top: 17px;
  color: #57647d;
  font-size: 12px;
  font-weight: 600;
}
.trip-arrow {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: #f0f3f7;
  transition: 0.25s;
}
.trip-card:hover .trip-arrow {
  background: #303752;
  color: #fff;
  transform: translateX(3px);
}
@media (max-width: 1050px) {
  .trip-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 650px) {
  .trips-page {
    padding: 36px 18px 90px;
  }
  .trips-page .section-heading {
    margin-bottom: 30px;
  }
  .trips-page .section-heading h1 {
    font-size: 31px;
  }
  .trip-grid {
    grid-template-columns: 1fr;
    gap: 20px;
  }
  .trip-card-art {
    height: 190px;
  }
  .trip-card-body h2 {
    min-height: 0;
    font-size: 21px;
  }
  .trip-date-block strong {
    font-size: 48px;
  }
}
</style>
