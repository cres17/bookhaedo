<script setup lang="ts">
import PanelHeader from './PanelHeader.vue';
import { computed, ref, watch } from 'vue';
import type { Trip, Day, Place } from '../types';
import { arrangeVisits, clockTime, type Visit } from '../schedule';
import Crystal from './Crystal.vue';
import Icon from './Icon.vue';
import { categoryName } from '../store';
const props = defineProps<{ trip: Trip; active: string; busy: boolean }>();
const emit = defineEmits<{
  edit: [day: Day, place: Place, start: number, end: number];
  choose: [date: string];
  shift: [day: Day, place: Place, start: number, end: number];
}>();
const hiddenKey = computed(() => `bookhaedo-calendar-hidden:${props.trip.id}`);
const collapsed = ref(localStorage.getItem(hiddenKey.value) === 'true');
watch(hiddenKey, (key) => {
  collapsed.value = localStorage.getItem(key) === 'true';
});
function toggleCalendar() {
  collapsed.value = !collapsed.value;
  localStorage.setItem(hiddenKey.value, String(collapsed.value));
}
const menu = ref<{ day: Day; visit: Visit } | null>(null);
function shift(delta: number) {
  if (!menu.value) return;
  const { day, visit } = menu.value;
  emit('shift', day, visit.place, visit.start + delta, visit.end + delta);
  menu.value = null;
}
function addToDay(date: string) {
  emit('choose', date);
}
const allDays = ref(window.innerWidth > 760 && props.trip.days.length <= 7);
const days = computed(() =>
  props.trip.days.map((day) => ({ ...day, ...arrangeVisits(day.items) })),
);
const shown = computed(() =>
  allDays.value ? days.value : days.value.filter((d) => d.date === props.active),
);
const firstHour = computed(() =>
  Math.min(8, ...shown.value.flatMap((d) => d.visits.map((v) => Math.floor(v.start / 60)))),
);
const lastHour = computed(() =>
  Math.max(21, ...shown.value.flatMap((d) => d.visits.map((v) => Math.ceil(v.end / 60)))),
);
const hours = computed(() =>
  Array.from({ length: lastHour.value - firstHour.value }, (_, i) => firstHour.value + i),
);
function position(visit: Visit, visits: Visit[]) {
  // Overlapping blocks share equal-width columns, so each remains clickable.
  const cluster = new Set([visit]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const v of visits)
      if (!cluster.has(v) && [...cluster].some((o) => v.start < o.end && o.start < v.end)) {
        cluster.add(v);
        changed = true;
      }
  }
  const group = visits.filter((v) => cluster.has(v));
  return {
    top: `${(visit.start - firstHour.value * 60) * 1.2}px`,
    height: `${(visit.end - visit.start) * 1.2}px`,
    left: `calc(${(group.indexOf(visit) * 100) / group.length}% + 4px)`,
    width: `calc(${100 / group.length}% - 8px)`,
  };
}
const edit = (day: Day, visit: Visit) => emit('edit', day, visit.place, visit.start, visit.end);
function print() {
  window.print();
}
</script>
<template>
  <section class="trip-calendar" aria-label="여행 시간표">
    <div class="calendar-toolbar">
      <div>
        <h2>한눈에 보는 일정</h2>
      </div>
      <div class="calendar-controls">
        <button
          class="calendar-toggle"
          :aria-expanded="!collapsed"
          aria-controls="calendar-content"
          @click="toggleCalendar"
        >
          {{ collapsed ? '일정 펼치기' : '일정 숨기기' }}
          <Icon :name="collapsed ? 'down' : 'up'" :size="16" />
        </button>
        <template v-if="!collapsed">
          <button :aria-pressed="!allDays" @click="allDays = false">선택한 하루</button>
          <button :aria-pressed="allDays" @click="allDays = true">전체 날짜</button>
          <button @click="print">인쇄 / PDF</button>
          <RouterLink to="/explore" class="button dark small">＋ 장소 추가</RouterLink>
        </template>
      </div>
    </div>
    <div v-show="!collapsed" id="calendar-content">
      <div v-if="shown.length && shown.every((d) => !d.items.length)" class="calendar-empty-hero">
        <div class="empty-orbit"><Crystal :size="48" /></div>
        <small>YOUR NEXT CHAPTER</small>
        <h3>아직, 무엇이든 가능한 하루.</h3>
        <p>
          가보고 싶은 곳 하나면 충분해요.
          <br />
          장소를 담으면 이곳에 시간표가 펼쳐져요.
        </p>
        <RouterLink to="/explore" class="button dark" @click="addToDay(active)">
          ＋ 첫 장소 찾아보기
        </RouterLink>
      </div>
      <template v-else>
        <div class="calendar-scroll">
          <div
            class="calendar-grid"
            :style="{ gridTemplateColumns: `54px repeat(${shown.length}, minmax(230px, 1fr))` }"
          >
            <div class="calendar-corner">시간</div>
            <button
              v-for="day in shown"
              :key="day.id"
              class="calendar-date"
              :class="{ selected: day.date === active }"
              @click="emit('choose', day.date)"
            >
              <strong>{{ day.date.slice(5).replace('-', '.') }}</strong>
              <span>{{ day.items.length }}곳</span>
            </button>
            <div class="calendar-hours">
              <div v-for="hour in hours" :key="hour">{{ clockTime(hour * 60) }}</div>
            </div>
            <div
              v-for="day in shown"
              :key="day.id"
              class="calendar-column"
              :style="{ height: hours.length * 72 + 'px' }"
            >
              <article
                v-for="visit in day.visits"
                :key="visit.place.id"
                class="calendar-visit"
                :class="[
                  visit.place.category.toLowerCase(),
                  { conflict: visit.conflict, compact: visit.end - visit.start < 35 },
                ]"
                :style="position(visit, day.visits)"
              >
                <button
                  class="visit-main"
                  :disabled="busy"
                  :aria-label="`${visit.place.name} ${clockTime(visit.start)}–${clockTime(visit.end)} 일정 수정`"
                  @click="edit(day, visit)"
                >
                  <strong>{{ visit.place.name }}</strong>
                  <span>{{ clockTime(visit.start) }}–{{ clockTime(visit.end) }}</span>
                  <small>
                    {{
                      visit.conflict
                        ? '시간 겹침 · 수정 필요'
                        : visit.suggested
                          ? '자동 제안'
                          : '시간 지정'
                    }}
                    · {{ categoryName(visit.place.category) }}
                  </small>
                </button>
                <button
                  class="visit-more"
                  :disabled="busy"
                  :aria-label="visit.place.name + ' 일정 메뉴'"
                  aria-haspopup="dialog"
                  @click="menu = { day, visit }"
                >
                  ⋮
                </button>
              </article>
              <div v-if="!day.items.length" class="calendar-empty">
                <Crystal :size="32" />
                <strong>잠깐 비워 둔 하루</strong>
                <p>어떤 순간으로 채워볼까요?</p>
                <RouterLink to="/explore" @click="addToDay(day.date)">＋ 장소 찾아보기</RouterLink>
              </div>
            </div>
          </div>
        </div>
        <div v-for="day in shown.filter((d) => d.unplaced.length)" :key="day.id" class="unplaced">
          <strong>{{ day.date }} · 시간 미정 {{ day.unplaced.length }}곳</strong>
          <p>하루에 모두 배치할 수 없어요. 시간을 직접 정해주세요.</p>
          <button
            v-for="place in day.unplaced"
            :key="place.id"
            @click="emit('edit', day, place, 540, 600)"
          >
            {{ place.name }} · 시간 정하기
          </button>
        </div>
      </template>
    </div>
    <div v-if="menu" class="modal-backdrop" @click.self="menu = null">
      <section
        class="modal calendar-menu"
        v-dialog
        role="dialog"
        aria-modal="true"
        aria-label="일정 빠른 수정"
      >
        <PanelHeader
          :title="menu.visit.place.name"
          :eyebrow="`${menu.day.date} · ${clockTime(menu.visit.start)}–${clockTime(menu.visit.end)}`"
          close-label="일정 메뉴 닫기"
          @close="menu = null"
        />
        <p>같은 방문 길이를 유지하며 시간을 옮겨요.</p>
        <button :disabled="busy || menu.visit.start < 30" @click="shift(-30)">
          <Icon name="up" />
          30분 앞당기기
          <span>위로</span>
        </button>
        <button :disabled="busy || menu.visit.end > 1410" @click="shift(30)">
          <Icon name="down" />
          30분 늦추기
          <span>아래로</span>
        </button>
        <button
          @click="
            edit(menu.day, menu.visit);
            menu = null;
          "
        >
          <Icon name="calendar" />
          시간 직접 수정 · 삭제
          <Icon name="arrow" />
        </button>
        <small class="menu-footnote">
          이동한 시간은 고정되며, 다른 일정과 겹치면 시간표에 표시해요.
        </small>
      </section>
    </div>
    <div class="calendar-print">
      <section v-for="day in days" :key="day.id" class="print-day">
        <h1>{{ trip.title }}</h1>
        <h2>{{ day.date }} · {{ day.items.length }}곳</h2>
        <table>
          <thead>
            <tr>
              <th>시간</th>
              <th>장소</th>
              <th>분류 · 메모</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="visit in day.visits" :key="visit.place.id">
              <td>
                {{ clockTime(visit.start) }}–{{ clockTime(visit.end) }}
                <small>
                  {{ visit.suggested ? '자동 제안' : '시간 지정'
                  }}{{ visit.conflict ? ' · 시간 겹침' : '' }}
                </small>
              </td>
              <td>{{ visit.place.name }}</td>
              <td>
                {{ categoryName(visit.place.category) }}
                <p>{{ visit.place.note }}</p>
              </td>
            </tr>
            <tr v-for="place in day.unplaced" :key="place.id">
              <td>시간 미정</td>
              <td>{{ place.name }}</td>
              <td>{{ place.note }}</td>
            </tr>
            <tr v-if="!day.items.length"><td colspan="3">등록된 일정이 없습니다.</td></tr>
          </tbody>
        </table>
        <p class="print-notice">
          자동 제안은 이동시간·영업시간을 반영하지 않습니다. 방문 전 확인해주세요.
        </p>
      </section>
    </div>
  </section>
</template>
<style scoped>
.trip-calendar {
  margin: 0 0 24px;
  border: 1px solid #dfe3ed;
  border-radius: 20px;
  background: #fff;
  overflow: hidden;
}
.calendar-toolbar {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 22px;
  align-items: center;
}
.calendar-toolbar h2 {
  font-size: 21px;
}
.calendar-toolbar p,
.calendar-hint {
  font-size: 12px;
  color: #697387;
}
.calendar-controls {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.calendar-controls button {
  padding: 10px 13px;
  border-radius: 10px;
  background: #f3f4f8;
  font-size: 12px;
}
.calendar-controls button[aria-pressed='true'] {
  background: #e6e2f4;
  color: #635287;
  font-weight: 700;
}
.calendar-hint {
  padding: 0 22px 18px;
  line-height: 1.7;
}
.calendar-scroll {
  max-height: 680px;
  overflow: auto;
  border-top: 1px solid #e4e5ee;
}
.calendar-grid {
  display: grid;
  min-width: 100%;
}
.calendar-corner,
.calendar-date {
  position: sticky;
  top: 0;
  z-index: 3;
  background: #f2eff8;
  padding: 16px 10px;
  border-bottom: 1px solid #ded9eb;
  min-height: 55px;
}
.calendar-corner {
  font-size: 11px;
  color: #778093;
}
.calendar-date {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: center;
  border-left: 1px solid #e1dfeb;
}
.calendar-date span {
  font-size: 12px;
  color: #7d758e;
}
.calendar-date.selected {
  box-shadow: inset 0 -3px #8773a9;
}
.calendar-hours > div {
  height: 72px;
  font-size: 11px;
  text-align: center;
  color: #7d8192;
  background: #fafafe;
}
.calendar-column {
  position: relative;
  border-left: 1px solid #e2e4ed;
  background: repeating-linear-gradient(
    to bottom,
    transparent 0,
    transparent 35px,
    #f0f0f5 35px,
    #f0f0f5 36px,
    transparent 36px,
    transparent 71px,
    #e2e4ed 71px,
    #e2e4ed 72px
  );
}
.calendar-visit {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  gap: 4px;
  overflow: hidden;
  border-radius: 8px;
  background: #dcebe3;
  border-left: 3px solid #83a693;
  padding: 0;
  color: #2f4942;
  min-height: 2px;
}
.calendar-visit.restaurant {
  background: #f6e2d9;
  border-color: #d4a28d;
  color: #6b4437;
}
.calendar-visit.lodging {
  background: #e6dff3;
  border-color: #ac98cc;
  color: #53426b;
}
.calendar-visit strong {
  font-size: 13px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  flex-shrink: 0;
}
.calendar-visit span {
  font-size: 12px;
}
.calendar-visit small {
  font-size: 10px;
  opacity: 0.8;
}
.calendar-visit.conflict {
  outline: 2px solid #b76050;
  outline-offset: -2px;
}
.calendar-visit.compact {
  padding: 0 6px;
  flex-direction: row;
  gap: 5px;
  align-items: center;
}
.calendar-visit.compact small {
  display: none;
}
.calendar-visit:hover {
  filter: brightness(0.97);
  box-shadow: 0 3px 10px #3d335b20;
}
.calendar-empty {
  padding: 40px 22px;
  font-size: 13px;
  color: #82899a;
}
.unplaced {
  padding: 20px;
  border-top: 1px solid #ddd;
}
.unplaced button {
  display: inline-block;
  padding: 10px;
  background: #f4f2f8;
  margin: 6px;
  border-radius: 8px;
}
.calendar-print {
  display: none;
}
@media (max-width: 760px) {
  .calendar-toolbar {
    align-items: flex-start;
    flex-direction: column;
    padding: 18px;
  }
  .calendar-controls {
    gap: 5px;
  }
  .calendar-controls button {
    padding: 10px;
    font-size: 11px;
  }
  .calendar-hint {
    padding: 0 18px 16px;
  }
  .calendar-scroll {
    max-height: 560px;
  }
}
.calendar-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
}
.visit-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-start;
  text-align: left;
  width: 100%;
  height: 100%;
  padding: 10px 38px 10px 10px;
  overflow: hidden;
  color: inherit;
}
.visit-more {
  position: absolute;
  right: 0;
  top: 0;
  width: 34px;
  min-height: 32px;
  height: min(44px, 100%);
  display: grid;
  place-items: center;
  font-size: 24px;
  border-radius: 6px;
  background: #ffffff45;
  color: inherit;
}
.visit-more:hover {
  background: #ffffffa8;
}
.calendar-visit.compact {
  padding: 0;
}
.compact .visit-main {
  padding: 0 36px 0 6px;
  flex-direction: row;
  align-items: center;
}
.calendar-empty {
  margin: 32px 14px;
  padding: 28px 12px;
  text-align: center;
  border: 1px dashed #d8d1e5;
  background: #faf9fd;
  border-radius: 16px;
  display: grid;
  justify-items: center;
  gap: 14px;
}
.calendar-empty strong {
  font-size: 16px;
  color: #5c5370;
}
.calendar-empty p {
  font-size: 13px;
}
.calendar-empty a {
  font-size: 14px;
  font-weight: 600;
  color: #6e598c;
  min-height: 44px;
  padding: 12px;
}
.calendar-empty-hero {
  text-align: center;
  padding: 40px 20px 46px;
  border-top: 1px solid #eeebf4;
  background: radial-gradient(ellipse at top, #f0ebf9, transparent 70%);
}
.empty-orbit {
  width: 86px;
  height: 86px;
  margin: 0 auto 22px;
  border: 1px solid #dfd7ec;
  background: #ffffffb3;
  border-radius: 28px;
  display: grid;
  place-items: center;
  color: #9784b3;
  transform: rotate(-8deg);
}
.calendar-empty-hero small {
  font-size: 10px;
  letter-spacing: 2px;
  color: #9b8daa;
}
.calendar-empty-hero h3 {
  font-size: 24px;
  margin: 12px 0;
}
.calendar-empty-hero p {
  font-size: 15px;
  color: #7c7489;
  line-height: 1.8;
}
.calendar-empty-hero .button {
  margin-top: 24px;
}
.calendar-menu h2 {
  font-size: 23px;
  margin: 14px 0 10px;
}
.calendar-menu > p {
  font-size: 15px;
  color: #7d768a;
  margin-bottom: 22px;
}
.calendar-menu > small {
  font-size: 13px;
  color: #847992;
}
.calendar-menu > button:not(.modal-close) {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
  width: 100%;
  border-radius: 12px;
  margin-top: 8px;
  background: #f5f3f9;
  text-align: left;
  font-size: 16px;
  min-height: 54px;
}
.calendar-menu > button > span,
.calendar-menu > button > svg:last-child {
  margin-left: auto;
}
.calendar-menu > button > span {
  font-size: 13px;
  color: #8e829b;
}
.menu-footnote {
  display: block;
  line-height: 1.7;
  margin-top: 20px;
}
@media (max-width: 760px) {
  .calendar-toggle {
    margin-bottom: 4px;
  }
  .calendar-controls {
    width: 100%;
  }
  .calendar-empty-hero h3 {
    font-size: 22px;
  }
}
@media print {
  .trip-calendar {
    border: 0;
    margin: 0;
    overflow: visible;
  }
  .trip-calendar > * {
    display: none !important;
  }
  .trip-calendar > .calendar-print {
    display: block !important;
  }
  .print-day {
    break-before: page;
  }
  .print-day:first-child {
    break-before: auto;
  }
  .print-day h1 {
    font-size: 20pt;
    margin-bottom: 10pt;
  }
  .print-day h2 {
    font-size: 14pt;
    margin-bottom: 18pt;
  }
  .print-day table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: 10pt;
  }
  .print-day th,
  .print-day td {
    border: 1px solid #adb3bf;
    padding: 10pt;
    text-align: left;
    overflow-wrap: anywhere;
    vertical-align: top;
  }
  .print-day th {
    background: #eeebf5;
  }
  .print-day th:first-child {
    width: 24%;
  }
  .print-day tr {
    break-inside: avoid;
  }
  .print-day thead {
    display: table-header-group;
  }
  .print-day small {
    display: block;
    font-size: 8pt;
    margin-top: 4pt;
  }
  .print-day p {
    white-space: pre-wrap;
    font-size: 9pt;
  }
  .print-notice {
    margin-top: 15pt;
  }
}

/* Calendar stays in the primary navy family instead of purple. */
.trip-calendar {
  border-color: #d9e0ea;
}
.calendar-controls button {
  background: #f0f3f8;
  color: #3f4b62;
}
.calendar-controls button[aria-pressed='true'] {
  background: #e2e8f1;
  color: #2e314e;
}
.calendar-scroll {
  border-top-color: #e0e6ef;
}
.calendar-corner,
.calendar-date {
  background: #eef2f7;
  border-bottom-color: #dbe3ed;
}
.calendar-date {
  border-left-color: #dfe5ed;
}
.calendar-date span,
.calendar-corner {
  color: #637189;
}
.calendar-date.selected {
  box-shadow: inset 0 -3px #526887;
}
.calendar-visit.lodging {
  background: #e2e9f3;
  border-color: #7187a8;
  color: #344967;
}
.calendar-visit:hover {
  box-shadow: 0 3px 10px #30375120;
}
.unplaced button,
.calendar-menu > button:not(.modal-close) {
  background: #eef2f7;
}
.calendar-empty {
  border-color: #d4deea;
  background: #f8fafe;
}
.calendar-empty strong,
.calendar-empty a {
  color: #405675;
}
.calendar-empty-hero {
  border-top-color: #e0e6ef;
  background: radial-gradient(ellipse at top, #e8eef6, transparent 70%);
}
.empty-orbit {
  border-color: #d2dce9;
  color: #607294;
}
.calendar-empty-hero small,
.calendar-menu > small,
.calendar-menu > button > span {
  color: #718099;
}
</style>
