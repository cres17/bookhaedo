<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
const canvas = ref<HTMLCanvasElement>(),
  paused = ref(false),
  reduced = ref(false);
type Flake = { x: number; y: number; z: number; r: number; speed: number; phase: number };
let flakes: Flake[] = [],
  frame = 0,
  last = 0,
  width = 0,
  height = 0,
  wind = 0,
  pointer = { x: -1000, y: -1000 },
  observer: ResizeObserver,
  media: MediaQueryList,
  visible = true;
const random = (a: number, b: number) => a + Math.random() * (b - a);
function resize() {
  const c = canvas.value;
  if (!c) return;
  const rect = c.getBoundingClientRect();
  width = rect.width;
  height = rect.height;
  const ratio = Math.min(devicePixelRatio || 1, 2);
  c.width = Math.round(width * ratio);
  c.height = Math.round(height * ratio);
  c.getContext('2d')?.setTransform(ratio, 0, 0, ratio, 0, 0);
  flakes = Array.from(
    { length: Math.min(100, Math.max(24, Math.floor((width * height) / 6500))) },
    () => {
      const z = random(0.25, 1);
      return {
        x: random(0, width),
        y: random(0, height),
        z,
        r: random(0.7, 2.8) * z,
        speed: random(18, 40) * z,
        phase: random(0, Math.PI * 2),
      };
    },
  );
}
function move(e: PointerEvent) {
  const rect = canvas.value?.getBoundingClientRect();
  if (!rect) return;
  pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
}
function draw(time: number) {
  frame = 0;
  if (paused.value || reduced.value || !visible || document.hidden) return;
  const ctx = canvas.value?.getContext('2d');
  if (!ctx) return;
  const dt = Math.min((time - last) / 1000, 0.05) || 0.016;
  last = time;
  ctx.clearRect(0, 0, width, height);
  const inside = pointer.x >= 0 && pointer.x < width && pointer.y >= 0 && pointer.y < height;
  wind += ((inside ? (pointer.x / width - 0.5) * 36 : Math.sin(time / 7500) * 10) - wind) * 0.025;
  for (const f of flakes) {
    const dx = f.x - pointer.x,
      dy = f.y - pointer.y,
      dist = Math.hypot(dx, dy);
    const push = inside && dist < 100 ? (1 - dist / 100) * 22 : 0;
    f.x +=
      (wind * f.z + Math.sin(time / 1600 + f.phase) * 7 + (dx / Math.max(1, dist)) * push) * dt;
    f.y += (f.speed + Math.cos(f.phase + time / 2300) * 3 + (dy / Math.max(1, dist)) * push) * dt;
    if (f.y > height + 8) {
      f.y = -8;
      f.x = random(0, width);
    }
    if (f.x > width + 8) f.x = -8;
    if (f.x < -8) f.x = width + 8;
    ctx.beginPath();
    ctx.fillStyle = 'rgba(255,255,255,' + (0.3 + f.z * 0.6) + ')';
    ctx.shadowColor = 'rgba(215,230,247,.5)';
    ctx.shadowBlur = f.z > 0.8 ? 4 : 0;
    ctx.ellipse(f.x, f.y, f.r, Math.max(0.8, f.r * 1.15), wind / 120, 0, Math.PI * 2);
    ctx.fill();
  }
  frame = requestAnimationFrame(draw);
}
function sync() {
  cancelAnimationFrame(frame);
  frame = 0;
  last = performance.now();
  if (paused.value || reduced.value) {
    canvas.value?.getContext('2d')?.clearRect(0, 0, width, height);
    return;
  }
  if (visible && !document.hidden) frame = requestAnimationFrame(draw);
}
function toggle() {
  paused.value = !paused.value;
  sync();
}
function motion() {
  reduced.value = media.matches;
  sync();
}
let intersection: IntersectionObserver;
onMounted(() => {
  media = matchMedia('(prefers-reduced-motion: reduce)');
  reduced.value = media.matches;
  resize();
  observer = new ResizeObserver(resize);
  observer.observe(canvas.value!);
  intersection = new IntersectionObserver((entries) => {
    visible = entries[0]?.isIntersecting ?? true;
    sync();
  });
  intersection.observe(canvas.value!);
  window.addEventListener('pointermove', move, { passive: true });
  document.addEventListener('visibilitychange', sync);
  media.addEventListener('change', motion);
  sync();
});
onBeforeUnmount(() => {
  cancelAnimationFrame(frame);
  observer?.disconnect();
  intersection?.disconnect();
  window.removeEventListener('pointermove', move);
  document.removeEventListener('visibilitychange', sync);
  media?.removeEventListener('change', motion);
});
</script>
<template>
  <div class="snow-scene">
    <canvas ref="canvas" class="snow-canvas" aria-hidden="true" />
    <button
      v-if="!reduced"
      class="snow-toggle"
      type="button"
      :aria-pressed="!paused"
      :aria-label="paused ? '눈 효과 재생' : '눈 효과 멈추기'"
      @click="toggle"
    >
      {{ paused ? '눈 켜기' : '눈 잠시 멈추기' }}
    </button>
  </div>
</template>
<style scoped>
.snow-scene {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1;
  overflow: hidden;
  border-radius: inherit;
}
.snow-canvas {
  width: 100%;
  height: 100%;
  display: block;
}
.snow-toggle {
  position: absolute;
  right: 14px;
  bottom: 12px;
  pointer-events: auto;
  border: 1px solid #ffffff55;
  background: #303252b3;
  color: white;
  border-radius: 20px;
  padding: 7px 11px;
  font-size: 11px;
  backdrop-filter: blur(8px);
}
@media (prefers-reduced-motion: reduce) {
  .snow-scene {
    display: none;
  }
}
</style>
