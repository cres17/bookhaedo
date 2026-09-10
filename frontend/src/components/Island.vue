<script setup lang="ts">
import { onMounted, ref, useId } from 'vue';
withDefaults(defineProps<{ active?: string; interactive?: boolean }>(), {
  active: '',
  interactive: true,
});
const emit = defineEmits<{ select: [id: string]; city: [point: any] }>();
const outline = ref(''),
  cities = ref<any[]>([]),
  id = useId();
const xy = (lat: number, lon: number) => ({
  x: 55 + (lon - 139) * 105,
  y: 45 + (45.7 - lat) * 145,
});
onMounted(async () => {
  try {
    const [land, points] = await Promise.all([
      fetch('/hokkaido-outline.json').then((r) => r.json()),
      fetch('/hokkaido-cities.json').then((r) => r.json()),
    ]);
    outline.value = land.path;
    cities.value = points;
  } catch {}
});
</script>
<template>
  <svg
    viewBox="0 0 850 740"
    class="island"
    role="img"
    aria-label="실제 육지 윤곽과 도시 좌표로 표시한 홋카이도 지도"
  >
    <defs>
      <linearGradient :id="id + 'fill'" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="#f8faff" />
        <stop offset="1" stop-color="#d5dfef" />
      </linearGradient>
    </defs>
    <path :d="outline" :fill="'url(#' + id + 'fill)'" stroke="#92a3c0" stroke-width="1.5" />
    <g
      v-for="c in cities"
      :key="c.ja"
      :transform="`translate(${xy(c.latitude, c.longitude).x} ${xy(c.latitude, c.longitude).y})`"
      :class="['island-pin', { selected: active === c.region }]"
      :role="interactive ? 'button' : undefined"
      :tabindex="interactive ? 0 : undefined"
      :aria-label="c.name"
      @click="interactive && (emit('select', c.region), emit('city', c))"
      @keydown.enter="interactive && emit('select', c.region)"
      @keydown.space.prevent="interactive && emit('select', c.region)"
    >
      <circle r="11" class="pin-halo" />
      <circle r="4" />
      <line x1="0" y1="0" :x2="c.dx" :y2="c.dy" stroke="#8695af" stroke-width="1" />
      <text :x="c.dx" :y="c.dy" :text-anchor="c.dx < 0 ? 'end' : 'start'">{{ c.name }}</text>
    </g>
  </svg>
</template>
