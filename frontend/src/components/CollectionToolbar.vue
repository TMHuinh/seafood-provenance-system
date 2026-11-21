<script setup lang="ts">
import { computed } from 'vue'
const props = withDefaults(
  defineProps<{
    query: string
    status?: string
    statuses?: { value: string; label: string }[]
    total: number
    page: number
    pageSize: number
    loading?: boolean
    label?: string
    searchPlaceholder?: string
    extraFiltersActive?: boolean
  }>(),
  {
    status: '',
    statuses: () => [],
    loading: false,
    label: 'bản ghi',
    searchPlaceholder: 'Tìm theo mã hoặc tên…',
  },
)
const emit = defineEmits<{
  'update:query': [value: string]
  'update:status': [value: string]
  'update:page': [value: number]
  clear: []
}>()
const pages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))
function clearFilters() {
  emit('update:query', '')
  emit('update:status', '')
  emit('clear')
}
</script>
<template>
  <div class="collection-toolbar">
    <div class="filters">
      <label
        >Tìm kiếm<input
          type="search"
          :value="query"
          :placeholder="searchPlaceholder"
          @input="emit('update:query', ($event.target as HTMLInputElement).value)"
      /></label>
      <label v-if="statuses.length"
        >Trạng thái<select
          :value="status"
          @change="emit('update:status', ($event.target as HTMLSelectElement).value)"
        >
          <option value="">Tất cả trạng thái</option>
          <option v-for="option in statuses" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select></label
      >
      <slot name="filters" />
    </div>
    <div class="collection-navigation">
      <div class="collection-count">
        <span role="status">
          <template v-if="loading">Đang tải danh sách…</template>
          <template v-else-if="pages > 1"
            >{{ ((page - 1) * pageSize + 1).toLocaleString('vi-VN') }}–{{
              Math.min(page * pageSize, total).toLocaleString('vi-VN')
            }}
            / {{ total.toLocaleString('vi-VN') }} {{ label }}</template
          >
          <template v-else>{{ total.toLocaleString('vi-VN') }} {{ label }}</template>
        </span>
        <button
          v-if="query || status || extraFiltersActive"
          type="button"
          class="clear-filters"
          @click="clearFilters"
        >
          Xóa bộ lọc
        </button>
      </div>
      <nav v-if="pages > 1" aria-label="Phân trang danh sách">
        <span class="page-indicator">Trang {{ page }} / {{ pages }}</span
        ><button
          type="button"
          :disabled="loading || page <= 1"
          @click="emit('update:page', page - 1)"
        >
          ← Trước</button
        ><button
          type="button"
          :disabled="loading || page >= pages"
          @click="emit('update:page', page + 1)"
        >
          Sau →
        </button>
      </nav>
    </div>
  </div>
</template>
<style scoped>
.collection-toolbar {
  display: grid;
  gap: var(--app-space-3);
  margin: 0 0 var(--app-space-6);
  padding: 0;
  color: var(--app-muted);
}
.filters,
.collection-navigation,
nav {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}
.filters label {
  display: grid;
  gap: 8px;
  flex: 1;
  min-width: 150px;
  font-size: var(--app-text-xs);
  font-weight: 500;
}
.filters label:first-child {
  flex: 2;
}
.filters input,
.filters select {
  width: 100%;
  min-height: var(--app-control-height);
  padding: 10px 14px;
  border: 1px solid var(--app-control-line);
  border-radius: var(--app-control-radius);
  background: var(--app-surface);
  color: var(--app-ink);
  font: inherit;
  font-size: var(--app-text-base);
}
.collection-navigation {
  justify-content: space-between;
  font-size: 13px;
  border-top: 1px solid var(--app-line);
  padding-top: var(--app-space-3);
}
button {
  min-height: var(--app-control-height);
  padding: 8px 14px;
  border: 1px solid var(--app-line);
  border-radius: 8px;
  background: var(--app-surface);
  color: var(--app-primary-dark);
  cursor: pointer;
  font: inherit;
  font-weight: 600;
  transition: background 0.15s ease;
}
button:hover:not(:disabled) {
  background: var(--app-primary-soft);
}
button:disabled {
  opacity: 0.45;
  cursor: default;
}
.page-indicator {
  margin-right: 4px;
}
.collection-count {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  min-height: var(--app-control-height);
}
.clear-filters {
  border: 0;
  background: transparent;
  padding-inline: 4px;
  text-decoration: underline;
  text-underline-offset: 3px;
}
input:focus-visible,
select:focus-visible,
button:focus-visible {
  outline: 3px solid var(--app-primary);
  outline-offset: 3px;
}
@media (max-width: 600px) {
  .filters {
    align-items: stretch;
    flex-direction: column;
  }
  .collection-navigation {
    align-items: flex-start;
    flex-direction: column;
  }
  .filters input,
  .filters select {
    font-size: 16px;
  }
}
</style>
