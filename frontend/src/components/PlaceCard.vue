<script setup lang="ts">
import type { Place } from '../types';
import { categoryName } from '../store';
import Icon from './Icon.vue';
defineProps<{ place: Place }>();
defineEmits<{ select: [] }>();
</script>
<template>
  <button class="place-card" @click="$emit('select')">
    <span
      :class="['place-glyph', place.recommended ? 'recommended' : place.category.toLowerCase()]"
    >
      <Icon
        :name="
          place.category === 'ATTRACTION' ? 'pin' : place.category === 'RESTAURANT' ? 'sun' : 'map'
        "
        :size="23"
      />
    </span>
    <span class="place-card-content">
      <small>
        {{ place.recommended ? '추천' : categoryName(place.category) }}
        <span v-if="place.municipality">· {{ place.municipality }}</span>
      </small>
      <strong>{{ place.name }}</strong>
      <span v-if="place.trendBadge" class="trend-badge">{{ place.trendBadge }}</span>
      <span>{{ place.name !== place.nameJa ? place.nameJa : place.address || '' }}</span>
      <span v-if="place.recommendationReasons?.length" class="recommendation-reason">
        {{ place.recommendationReasons[0] }}
      </span>
    </span>
    <Icon name="chevron" :size="16" />
  </button>
</template>
