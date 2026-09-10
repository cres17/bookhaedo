<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import type { Place, Segment } from '../types';
import Island from './Island.vue';
const props = withDefaults(
  defineProps<{
    places?: Place[];
    center?: { latitude: number; longitude: number };
    zoom?: number;
    numbered?: boolean;
    segments?: Segment[];
  }>(),
  { places: () => [], zoom: 7, numbered: false, segments: () => [] },
);
const emit = defineEmits<{
  select: [place: Place];
  region: [id: string];
  viewport: [value: { center: { latitude: number; longitude: number }; zoom: number }];
}>();
const container = ref<HTMLElement>(),
  status = ref<'loading' | 'ready' | 'unavailable'>('loading');
let map: any,
  markers: any[] = [],
  lines: any[] = [],
  google: any,
  alive = true,
  timer: ReturnType<typeof setTimeout>;
function fallback() {
  const s = document.querySelector<HTMLScriptElement>('script[data-kita-map]');
  if (s) s.dataset.failed = 'true';
  if (alive) status.value = 'unavailable';
}
function draw() {
  if (!map || status.value !== 'ready') return;
  markers.forEach((m) => m.setMap(null));
  lines.forEach((l) => l.setMap(null));
  markers = [];
  lines = [];
  props.places.forEach((p, i) => {
    const marker = new google.maps.Marker({
      map,
      position: { lat: p.latitude, lng: p.longitude },
      title: p.name,
      label: {
        text: props.numbered ? String(i + 1) : '•',
        color: '#fff',
        fontSize: '12px',
        fontWeight: '700',
      },
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: props.numbered ? 15 : 10,
        fillColor:
          !props.numbered && p.recommended
            ? '#b48224'
            : { ATTRACTION: '#5266a6', RESTAURANT: '#bd5867', LODGING: '#33847b' }[
                p.category as 'ATTRACTION'
              ] || '#5266a6',
        fillOpacity: 1,
        strokeColor: '#fff',
        strokeWeight: 3,
      },
    });
    marker.addListener('click', () => emit('select', p));
    markers.push(marker);
  });
  for (const s of props.segments) {
    const a = props.places.find((p) => p.id === s.from),
      b = props.places.find((p) => p.id === s.to);
    if (!a || !b) continue;
    const path = s.coordinates
      ? s.coordinates.map(([lng, lat]) => ({ lat, lng }))
      : s.polyline
        ? google.maps.geometry.encoding.decodePath(s.polyline)
        : [
            { lat: a.latitude, lng: a.longitude },
            { lat: b.latitude, lng: b.longitude },
          ];
    lines.push(
      new google.maps.Polyline({
        map,
        path,
        strokeColor: s.source !== 'straight-line' ? '#d6404b' : '#7c8598',
        strokeOpacity: 0.8,
        strokeWeight: 3,
      }),
    );
  }
  if (props.numbered && props.places.length) {
    const bounds = new google.maps.LatLngBounds();
    props.places.forEach((p) => bounds.extend({ lat: p.latitude, lng: p.longitude }));
    map.fitBounds(bounds, 100);
    google.maps.event.addListenerOnce(map, 'idle', () => {
      if (alive && map.getZoom() > 15) map.setZoom(15);
    });
  }
}
async function init() {
  try {
    google = (window as any).google;
    if (!alive || !google?.maps?.Map) return fallback();
    await nextTick();
    map = new google.maps.Map(container.value, {
      center: { lat: props.center?.latitude ?? 43.4, lng: props.center?.longitude ?? 142.6 },
      zoom: props.zoom,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      clickableIcons: true,
      gestureHandling: 'greedy',
      styles: [
        { featureType: 'poi', stylers: [{ visibility: 'off' }] },
        { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#d9e5ee' }] },
        { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#f3f5ef' }] },
      ],
    });
    google.maps.event.addListener(map, 'idle', () => {
      if (!alive) return;
      const c = map.getCenter();
      emit('viewport', { center: { latitude: c.lat(), longitude: c.lng() }, zoom: map.getZoom() });
    });
    google.maps.event.addListenerOnce(map, 'tilesloaded', () => {
      if (alive && status.value === 'loading') {
        status.value = 'ready';
        clearTimeout(timer);
        draw();
      }
    });
  } catch {
    fallback();
  }
}
let previousFailure: any;
onMounted(() => {
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!key) return fallback();
  previousFailure = (window as any).gm_authFailure;
  (window as any).gm_authFailure = fallback;
  timer = setTimeout(fallback, 12000);
  if ((window as any).google?.maps?.Map) {
    init();
    return;
  }
  let script = document.querySelector<HTMLScriptElement>('script[data-kita-map]');
  if (script?.dataset.failed === 'true') {
    clearTimeout(timer);
    return fallback();
  }
  if (!script) {
    script = document.createElement('script');
    script.dataset.kitaMap = 'true';
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=geometry&language=ko&region=JP&loading=async&callback=kitaMapReady`;
    script.async = true;
    (window as any).kitaMapReady = init;
    script.onerror = fallback;
    document.head.appendChild(script);
  } else {
    (window as any).kitaMapReady = init;
    script.addEventListener('load', () => setTimeout(init, 200), { once: true });
  }
});
watch(() => [props.places, props.segments], draw, { deep: true });
watch(
  () => [props.center, props.zoom],
  () => {
    if (map && props.center && (!props.numbered || !props.places.length)) {
      const c = map.getCenter();
      if (
        Math.abs(c.lat() - props.center.latitude) > 0.000001 ||
        Math.abs(c.lng() - props.center.longitude) > 0.000001
      )
        map.panTo({ lat: props.center.latitude, lng: props.center.longitude });
      if (map.getZoom() !== props.zoom) map.setZoom(props.zoom);
    }
  },
  { deep: true },
);
onBeforeUnmount(() => {
  alive = false;
  clearTimeout(timer);
  markers.forEach((m) => m.setMap(null));
  lines.forEach((l) => l.setMap(null));
  if (map) google.maps.event.clearInstanceListeners(map);
  (window as any).gm_authFailure = previousFailure;
});
</script>
<template>
  <div class="travel-map">
    <div class="map-legend" aria-label="지도 범례">
      <span
        v-for="[label, color] in [
          ['추천', '#b48224'],
          ['가볼 곳', '#5266a6'],
          ['먹을 곳', '#bd5867'],
          ['머물 곳', '#33847b'],
        ]"
        :key="label"
      >
        <i :style="{ background: color }" />
        {{ label }}
      </span>
    </div>
    <div ref="container" class="google-canvas" v-show="status !== 'unavailable'" />
    <div v-if="status === 'loading'" class="map-loading">
      <span class="spinner" />
      홋카이도 지도를 펼치고 있어요
    </div>
    <div v-if="status === 'unavailable'" class="map-fallback">
      <Island @select="emit('region', $event)" />
      <p class="map-status">
        Google 지도를 불러오지 못했어요. 지역 지도로 탐색을 계속할 수 있어요.
      </p>
      <span class="map-attribution">© OpenStreetMap contributors</span>
    </div>
    <span v-if="status === 'ready'" class="map-data-caption">
      장소 데이터 © OpenStreetMap contributors
    </span>
  </div>
</template>
