<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { VaAlert, VaButton } from 'vuestic-ui'
import { api } from '../../api/client'
import { useAuthStore } from '../../stores/auth.store'
import PageHeader from '../../components/PageHeader.vue'
import LoadingState from '../../components/LoadingState.vue'
import EmptyState from '../../components/EmptyState.vue'
import ProductionFilters from '../../components/ProductionFilters.vue'
import type { LotListResponse, LotOptions, ProductionFilters as Filters } from '../../types/lots'
import { date, lotStatusLabels, quantity, queryString, speciesLabel } from './lot-utils'

const route = useRoute(); const router = useRouter()
const auth = useAuthStore()
const emptyFilters = (): Filters => ({ farmId: '', pondId: '', species: '', from: '', to: '' })
const filters = ref<Filters>(emptyFilters())
const search = ref(''); const status = ref('')
const result = ref<LotListResponse | null>(null)
const options = ref<LotOptions>({ farms: [], ponds: [] })
const loading = ref(false); const optionsLoading = ref(false); const error = ref(''); const optionsError = ref('')
let version = 0; let active = true
const pages = computed(() => Math.max(1, result.value?.totalPages ?? 1))

async function loadOptions() {
  optionsLoading.value = true; optionsError.value = ''
  try { const response = await api.get<LotOptions>('/lots/options'); if (active) options.value = response }
  catch (cause) { if (active) optionsError.value = cause instanceof Error ? cause.message : 'Không tải được cơ sở và ao nuôi' }
  finally { if (active) optionsLoading.value = false }
}
async function load() {
  const current = ++version
  const string = (key: string) => typeof route.query[key] === 'string' ? String(route.query[key]) : ''
  filters.value = { farmId: string('farmId'), pondId: string('pondId'), species: string('species'), from: string('from'), to: string('to') }
  search.value = string('search'); status.value = string('status')
  loading.value = true; error.value = ''; result.value = null
  try {
    const response = await api.get<LotListResponse>(`/lots?${queryString({ ...filters.value, search: search.value, status: status.value, page: string('page') || 1, pageSize: 12 })}`)
    if (current === version) result.value = response
  } catch (cause) { if (current === version) error.value = cause instanceof Error ? cause.message : 'Không tải được danh sách lô' }
  finally { if (current === version) loading.value = false }
}
async function apply(page = 1) {
  const query = Object.fromEntries(new URLSearchParams(queryString({ ...filters.value, search: search.value.trim(), status: status.value, page })))
  if (queryString(query) === queryString(route.query)) await load()
  else await router.push({ query })
}
function changePage(page: number) { return router.push({ query: { ...route.query, page: String(page) } }) }
function reset() { filters.value = emptyFilters(); search.value = ''; status.value = ''; void apply() }
watch(() => route.fullPath, load, { immediate: true })
onMounted(loadOptions)
onUnmounted(() => { active = false; version++ })
</script>

<template>
  <main class="page-container lots-page" :aria-busy="loading">
    <PageHeader title="Tìm kiếm lô hàng" description="Tra cứu các lô thu hoạch, nguồn gốc và hồ sơ truy xuất.">
      <template #actions><RouterLink class="text-link" :to="{ name: 'production' }">Thống kê sản lượng →</RouterLink></template>
    </PageHeader>
    <form class="filter-card" @submit.prevent="apply()">
      <div class="search-row">
        <label>Từ khóa<input v-model="search" type="search" maxlength="100" placeholder="Mã lô, mã vụ, cơ sở, ao hoặc nguồn giống…" /></label>
        <label>Trạng thái lô<select v-model="status"><option value="">Tất cả trạng thái</option><option v-for="(label, value) in lotStatusLabels" :key="value" :value="value">{{ label }}</option></select></label>
      </div>
      <ProductionFilters v-model="filters" :options="options" :disabled="optionsLoading" />
      <va-alert v-if="optionsError" color="danger" role="alert">{{ optionsError }} <va-button type="button" preset="secondary" @click="loadOptions">Thử lại</va-button></va-alert>
      <div class="actions"><va-button type="submit" icon="search" :loading="loading">Tìm lô hàng</va-button><va-button type="button" preset="secondary" :disabled="loading" @click="reset">Xóa bộ lọc</va-button></div>
    </form>
    <va-alert v-if="error" color="danger" role="alert">{{ error }} <va-button preset="secondary" @click="load">Thử lại</va-button></va-alert>
    <LoadingState v-if="loading" />
    <template v-else-if="result">
      <div class="list-heading"><p role="status">{{ result.count.toLocaleString('vi-VN') }} lô hàng · Trang {{ result.page }} / {{ pages }}</p><small>Danh sách xếp theo thời điểm tạo lô mới nhất.</small></div>
      <EmptyState v-if="!result.items.length" title="Không tìm thấy lô hàng" description="Thử đổi từ khóa hoặc mở rộng khoảng ngày thu hoạch." />
      <div v-else class="table-scroll">
        <table><caption class="sr-only">Các lô thu hoạch phù hợp bộ lọc</caption><thead><tr><th>Lô / Vụ nuôi</th><th>Nguồn gốc</th><th>Thu hoạch</th><th>Khối lượng</th><th>Trạng thái lô / QR</th><th>Hồ sơ</th></tr></thead>
          <tbody><tr v-for="lot in result.items" :key="lot.id">
            <td><strong>{{ lot.lotCode }}</strong><small>{{ lot.batch.code }} · {{ speciesLabel(lot.species) }}</small></td>
            <td>{{ lot.farm.name }}<small>{{ lot.pond.name }} · {{ lot.pond.code }}</small></td>
            <td>{{ date(lot.harvestDate) }}</td><td class="numeric">{{ quantity(lot.quantity) }} kg</td>
            <td>{{ lotStatusLabels[lot.status] || lot.status }}<small>{{ !lot.qr ? 'Chưa phát hành QR' : lot.qr.status === 'ACTIVE' ? 'QR công khai' : 'QR đã thu hồi' }}</small></td>
            <td class="row-actions"><RouterLink :to="{ name: 'lot-report', params: { lotId: lot.id } }">Báo cáo truy xuất</RouterLink><RouterLink v-if="auth.user?.role === 'FARMER'" :to="{ name: 'pond-batches', params: { farmId: lot.farm.id, pondId: lot.pond.id }, query: { harvest: lot.batch.id } }">Mở thu hoạch</RouterLink><RouterLink v-if="lot.qr" :to="{ name: 'trace', params: { traceCode: lot.qr.traceCode } }">Xem QR công khai</RouterLink></td>
          </tr></tbody>
        </table>
      </div>
      <nav v-if="pages > 1" class="pagination" aria-label="Phân trang lô hàng"><va-button preset="secondary" :disabled="result.page <= 1" @click="changePage(result.page - 1)">← Trước</va-button><span>{{ result.page }} / {{ pages }}</span><va-button preset="secondary" :disabled="result.page >= pages" @click="changePage(result.page + 1)">Sau →</va-button></nav>
    </template>
  </main>
</template>

<style scoped>
.filter-card { display: grid; gap: 16px; padding: 20px; margin-bottom: 24px; background: var(--app-surface); border: 1px solid var(--app-line); border-radius: var(--app-radius); }
.search-row { display: grid; grid-template-columns: 2fr 1fr; gap: 12px; }
label { display: grid; gap: 6px; font-size: .85rem; font-weight: 600; }
input, select { width: 100%; min-height: 44px; padding: 8px 12px; font: inherit; color: var(--app-ink); background: var(--app-surface); border: 1px solid var(--app-control-line); border-radius: var(--app-control-radius); }
.actions, .pagination { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.pagination { justify-content: end; margin-top: 20px; }
.list-heading { margin-bottom: 12px; } small { color: var(--app-muted); }
.table-scroll { overflow-x: auto; border: 1px solid var(--app-line); border-radius: var(--app-radius); background: var(--app-surface); }
table { border-collapse: collapse; width: 100%; text-align: left; font-size: .9rem; }
th, td { padding: 16px; vertical-align: top; border-bottom: 1px solid var(--app-line); }
th { background: var(--app-primary-soft); font-weight: 600; white-space: nowrap; }
td:first-child { max-width: 310px; overflow-wrap: anywhere; } td small { display: block; margin-top: 6px; }
.numeric { font-variant-numeric: tabular-nums; white-space: nowrap; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.row-actions a { display: block; padding: 5px 0; min-width: 130px; }
a { color: var(--app-primary-dark); text-decoration: underline; }
@media (max-width: 600px) { .search-row { grid-template-columns: 1fr; } }
</style>
