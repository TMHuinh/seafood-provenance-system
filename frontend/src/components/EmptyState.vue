<script setup lang="ts">
import { VaIcon } from 'vuestic-ui'

defineProps<{ title: string; description?: string; icon?: string; heading?: 'h2' | 'h3' }>()
</script>

<template>
  <div class="list-empty" role="status">
    <span v-if="icon" class="list-empty__icon" aria-hidden="true"><VaIcon :name="icon" /></span>
    <component :is="heading ?? 'h2'">{{ title }}</component>
    <p v-if="description">{{ description }}</p>
    <div v-if="$slots.default" class="list-empty__actions"><slot /></div>
  </div>
</template>

<style scoped>
.list-empty {
  display: grid;
  justify-items: center;
  gap: var(--app-space-2);
  padding: clamp(24px, 5vw, 48px) var(--app-space-4);
  border: 1px dashed var(--app-line);
  border-radius: var(--app-radius);
  background: var(--app-surface);
  text-align: center;
}
.list-empty__icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  margin-bottom: var(--app-space-2);
  border-radius: var(--app-control-radius);
  background: var(--app-primary-soft);
  color: var(--app-primary-dark);
}
.list-empty :is(h2, h3) { margin: 0; color: var(--app-ink); font-size: 18px; font-weight: 650; }
.list-empty p { max-width: 48ch; margin: 0; color: var(--app-muted); }
.list-empty__actions { margin-top: var(--app-space-2); }
</style>
