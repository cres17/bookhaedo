import { reactive } from 'vue';
import { api } from './api';
import type { User, Region } from './types';
export const state = reactive({
  user: null as User | null,
  ready: false,
  regions: [] as Region[],
  cities: [] as { name: string; region: string; latitude: number; longitude: number }[],
  searchRegion: '',
  toast: '',
  activeTrip: localStorage.getItem('kita-trip') || '',
  activeDate: localStorage.getItem('kita-date') || '',
});
let toastTimer: ReturnType<typeof setTimeout>;
export function dismissToast() {
  clearTimeout(toastTimer);
  state.toast = '';
}
export function notify(message: string) {
  if (state.toast === message) return;
  state.toast = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(dismissToast, 5000);
}
export function selectTrip(id: string, date: string) {
  state.activeTrip = id;
  state.activeDate = date;
  localStorage.setItem('kita-trip', id);
  localStorage.setItem('kita-date', date);
}
export async function boot() {
  const session = (async () => {
    try {
      const d = await api('/auth/me');
      state.user = d.user;
    } catch {
      state.user = null;
      selectTrip('', '');
    } finally {
      state.ready = true;
    }
  })();
  const catalog = Promise.allSettled([
    api('/regions').then((d) => {
      state.regions = d.data;
    }),
    fetch('/hokkaido-cities.json')
      .then((r) => {
        if (!r.ok) throw new Error('CITY_DATA_UNAVAILABLE');
        return r.json();
      })
      .then((cities) => {
        state.cities = cities;
      }),
  ]).then((results) => {
    if (results.some((result) => result.status === 'rejected'))
      notify('지역 정보를 불러오지 못했습니다. 연결을 확인해주세요.');
  });
  await Promise.all([session, catalog]);
}
export function regionName(id: string) {
  return state.regions.find((r) => r.id === id)?.name || '홋카이도';
}
export const categoryName = (v: string) =>
  ({ ATTRACTION: '가볼 곳', RESTAURANT: '먹을 곳', LODGING: '머물 곳' })[v] || v;
export function safeUrl(value?: string) {
  try {
    const u = new URL(value || '');
    return ['http:', 'https:'].includes(u.protocol) ? u.href : undefined;
  } catch {
    return undefined;
  }
}
export const localToday = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
