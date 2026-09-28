<script setup lang="ts">
import Icon from './Icon.vue';
withDefaults(
  defineProps<{
    title: string;
    closeLabel: string;
    eyebrow?: string;
    compact?: boolean;
    disabled?: boolean;
  }>(),
  { compact: false, disabled: false },
);
defineEmits<{ close: [] }>();
</script>
<template>
  <header :class="['panel-header', { compact }]">
    <div class="panel-heading-copy">
      <small v-if="eyebrow">{{ eyebrow }}</small>
      <h2>{{ title }}</h2>
      <slot />
    </div>
    <button
      type="button"
      class="panel-dismiss"
      :aria-label="closeLabel"
      :disabled="disabled"
      @click="$emit('close')"
    >
      <Icon name="close" :size="19" />
    </button>
  </header>
</template>
<style scoped>
.panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin: 0 0 12px;
  min-width: 0;
}
.panel-heading-copy {
  min-width: 0;
  flex: 1;
}
.panel-header h2 {
  font-size: 24px;
  line-height: 1.4;
  margin: 4px 0 0;
  overflow-wrap: anywhere;
}
.panel-heading-copy > small {
  display: block;
  font-size: 13px;
  line-height: 1.5;
  color: #8b7d96;
  margin: 0 0 6px;
}
.panel-dismiss {
  position: static;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  min-height: 40px;
  flex: 0 0 40px;
  border-radius: 10px;
  padding: 0;
  color: #756a83;
  background: transparent;
  transition: background 0.15s;
}
.panel-dismiss:hover {
  background: #e7e0ed;
}
.compact {
  margin-bottom: 8px;
  gap: 8px;
}
.compact h2 {
  font-size: 16px;
  line-height: 1.5;
  margin-top: 7px;
}
@media (max-width: 760px) {
  .panel-header h2 {
    font-size: 22px;
  }
  .compact h2 {
    font-size: 16px;
  }
  .panel-dismiss {
    width: 44px;
    height: 44px;
    flex-basis: 44px;
  }
}
</style>
