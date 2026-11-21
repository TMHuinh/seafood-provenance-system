<script setup lang="ts">
defineProps<{ title: string; description?: string; context?: string }>()
</script>

<template>
  <header class="record-header">
    <div class="record-header__copy">
      <p v-if="context" class="record-header__context">{{ context }}</p>
      <h1>{{ title }}</h1>
      <p v-if="description" class="record-header__description">{{ description }}</p>
    </div>
    <div v-if="$slots.actions" class="record-header__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
.record-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--app-space-4) var(--app-space-6);
  margin-bottom: var(--app-space-6);
  padding-bottom: var(--app-space-6);
  border-bottom: 1px solid var(--app-line);
}
.record-header__copy {
  min-width: 0;
  flex: 1 1 320px;
  overflow-wrap: anywhere;
}
.record-header h1 {
  margin: 0;
  color: var(--app-ink);
  font-size: var(--app-text-title);
  font-weight: 600;
  line-height: 1.35;
  letter-spacing: -0.028em;
}
.record-header__context {
  color: var(--app-primary-dark);
  font-weight: 650;
  margin: 0 0 var(--app-space-2);
}
.record-header__description {
  color: var(--app-muted);
  margin: var(--app-space-2) 0 0;
}
.record-header__actions {
  display: flex;
  gap: var(--app-space-2);
  flex-wrap: wrap;
  align-items: center;
}
@media (max-width: 600px) {
  .record-header__copy {
    flex-basis: 100%;
  }
  .record-header__actions {
    width: 100%;
  }
  .record-header__actions :deep(.va-button) {
    flex: 1 1 auto;
  }
}
</style>
