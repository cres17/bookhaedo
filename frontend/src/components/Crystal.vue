<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 34 });
</script>
<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 100 100"
    fill="currentColor"
    aria-hidden="true"
    class="crystal"
  >
    <g v-for="i in 7" :key="i" :transform="`rotate(${(i * 360) / 7} 50 50)`">
      <path d="M50 48 44 9 50 13 56 9 51 48Z" />
      <path d="M49 42 34 25 35 17 48 31Z" />
    </g>
  </svg>
</template>
