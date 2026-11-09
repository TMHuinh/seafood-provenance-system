<script setup lang="ts">
import { computed } from 'vue'
const props = withDefaults(defineProps<{ query: string; status?: string; statuses?: { value: string; label: string }[]; total: number; page: number; pageSize: number; loading?: boolean; label?: string }>(), { status: '', statuses: () => [], loading: false, label: 'bản ghi' })
const emit = defineEmits<{ 'update:query': [value: string]; 'update:status': [value: string]; 'update:page': [value: number] }>()
const pages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))
</script>
<template>
  <div class="collection-toolbar">
    <div class="filters">
      <label>Tìm kiếm<input type="search" :value="query" placeholder="Tìm theo mã hoặc tên…" @input="emit('update:query', ($event.target as HTMLInputElement).value)" /></label>
      <label v-if="statuses.length">Trạng thái<select :value="status" @change="emit('update:status', ($event.target as HTMLSelectElement).value)"><option value="">Tất cả trạng thái</option><option v-for="option in statuses" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
    </div>
    <div class="collection-navigation">
      <span aria-live="polite">{{ total ? ((page - 1) * pageSize + 1).toLocaleString('vi-VN') : 0 }}–{{ Math.min(page * pageSize, total).toLocaleString('vi-VN') }} / {{ total.toLocaleString('vi-VN') }} {{ label }}</span>
      <nav aria-label="Phân trang danh sách"><span class="page-indicator">Trang {{ page }} / {{ pages }}</span><button type="button" :disabled="loading || page <= 1" @click="emit('update:page', page - 1)">← Trước</button><button type="button" :disabled="loading || page >= pages" @click="emit('update:page', page + 1)">Sau →</button></nav>
    </div>
  </div>
</template>
<style scoped>
.collection-toolbar { display: grid; gap: 18px; margin: 0 0 24px; padding: 20px; border: 1px solid rgb(30 67 58 / 4%); border-radius: var(--app-radius); background: var(--app-surface); box-shadow: var(--app-shadow); color: var(--app-muted); }
.filters, .collection-navigation, nav { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.filters label { display: grid; gap: 8px; flex: 1; min-width: 150px; font-size: 12px; font-weight: 600; }
.filters label:first-child { flex: 2; }
.filters input, .filters select { width: 100%; min-height: 44px; padding: 10px 14px; border: 1px solid var(--app-line); border-radius: var(--app-control-radius); background: var(--app-canvas); color: var(--app-ink); font: inherit; font-size: 14px; }
.collection-navigation { justify-content: space-between; font-size: 12px; }
button { min-height: 40px; padding: 8px 14px; border: 1px solid var(--app-line); border-radius: 8px; background: var(--app-surface); color: var(--app-primary-dark); cursor: pointer; font: inherit; font-weight: 600; transition: background .15s ease; }
button:hover:not(:disabled) { background: var(--app-primary-soft); }
button:disabled { opacity: .45; cursor: default; }
.page-indicator { margin-right: 4px; }
input:focus-visible, select:focus-visible, button:focus-visible { outline: 3px solid var(--app-primary); outline-offset: 3px; }
@media(max-width:600px) { .filters { align-items: stretch; flex-direction: column; } .collection-navigation { align-items: flex-start; flex-direction: column; } .filters input, .filters select { font-size: 16px; } }
</style>
