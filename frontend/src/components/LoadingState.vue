<script setup lang="ts">
withDefaults(defineProps<{ label?: string }>(), { label: 'Đang tải dữ liệu…' })
</script>

<template>
  <div class="loading-state" role="status">
    <p>{{ label }}</p>
    <div class="loading-state__grid" aria-hidden="true">
      <div v-for="item in 3" :key="item" class="loading-state__card">
        <span></span><span></span><span></span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.loading-state p {
  margin: 0 0 var(--app-space-4);
  color: var(--app-muted);
  font-size: var(--app-text-sm);
}
.loading-state__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
}
.loading-state__card {
  display: grid;
  gap: 20px;
  padding: var(--app-space-6);
  border: 1px solid var(--app-line);
  border-radius: var(--app-radius);
  background: var(--app-surface);
}
.loading-state__card span {
  height: 14px;
  border-radius: 4px;
  background: var(--app-line);
}
.loading-state__card span:first-child {
  width: 60%;
  height: 20px;
}
.loading-state__card span:last-child {
  width: 80%;
}
@media (max-width: 800px) {
  .loading-state__grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .loading-state__card:not(:first-child) {
    display: none;
  }
}
</style>
