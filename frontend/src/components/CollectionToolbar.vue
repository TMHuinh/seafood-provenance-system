<script setup lang="ts">
import { computed } from 'vue'
const props = withDefaults(defineProps<{ query: string; status?: string; statuses?: { value: string; label: string }[]; total: number; page: number; pageSize: number; loading?: boolean; label?: string }>(), { status: '', statuses: () => [], loading: false, label: 'bản ghi' })
const emit = defineEmits<{ 'update:query': [value: string]; 'update:status': [value: string]; 'update:page': [value: number] }>()
const pages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))
</script>
<template>
  <div class="collection-toolbar">
    <div class="filters">
      <label>Tìm kiếm<input type="search" :value="query" placeholder="Nhập mã hoặc tên…" @input="emit('update:query', ($event.target as HTMLInputElement).value)" /></label>
      <label v-if="statuses.length">Trạng thái<select :value="status" @change="emit('update:status', ($event.target as HTMLSelectElement).value)"><option value="">Tất cả trạng thái</option><option v-for="option in statuses" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
    </div>
    <div class="collection-navigation">
      <span aria-live="polite">{{ total.toLocaleString('vi-VN') }} {{ label }} · Trang {{ page }} / {{ pages }}</span>
      <nav aria-label="Phân trang danh sách"><button type="button" :disabled="loading || page <= 1" @click="emit('update:page', page - 1)">← Trước</button><button type="button" :disabled="loading || page >= pages" @click="emit('update:page', page + 1)">Sau →</button></nav>
    </div>
  </div>
</template>
<style scoped>
.collection-toolbar { display:grid; gap:.8rem; margin:1rem 0 1.25rem; padding:1rem; border:1px solid #dce9e5; border-radius:12px; background:#f8fbfa; color:#31565a; }
.filters,.collection-navigation,nav { display:flex; gap:.75rem; align-items:center; flex-wrap:wrap; }.filters label { display:grid; gap:.4rem; flex:1; min-width:150px; font-size:.78rem; font-weight:650; }.filters input,.filters select { box-sizing:border-box; width:100%; min-height:40px; padding:.5rem .7rem; border:1px solid #cbded8; border-radius:8px; background:white; color:#234c48; font:inherit; }.collection-navigation { justify-content:space-between; font-size:.78rem; }button { min-height:36px; padding:.4rem .75rem; border:1px solid #cbded8; border-radius:7px; background:white; color:#176e62; cursor:pointer; font:inherit; }button:disabled { opacity:.5; cursor:default; }input:focus-visible,select:focus-visible,button:focus-visible { outline:3px solid #75bdb0; outline-offset:2px; }
@media(max-width:500px) { .filters { align-items:stretch; flex-direction:column; }.collection-navigation { align-items:flex-start; flex-direction:column; } }
</style>
