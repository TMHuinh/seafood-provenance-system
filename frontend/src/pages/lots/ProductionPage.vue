<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { VaAlert, VaButton } from 'vuestic-ui'
import { api } from '../../api/client'
import PageHeader from '../../components/PageHeader.vue'
import LoadingState from '../../components/LoadingState.vue'
import EmptyState from '../../components/EmptyState.vue'
import ProductionFilters from '../../components/ProductionFilters.vue'
import type { LotOptions, ProductionFilters as Filters, ProductionResponse } from '../../types/lots'
import { date, downloadCsv, quantity, queryString, speciesLabel } from './lot-utils'

const route = useRoute(); const router = useRouter()
const emptyFilters = (): Filters => ({ farmId: '', pondId: '', species: '', from: '', to: '' })
const filters = ref<Filters>(emptyFilters())
const options = ref<LotOptions>({ farms: [], ponds: [] })
const result = ref<ProductionResponse | null>(null)
const loading = ref(false); const optionsLoading = ref(false); const error = ref(''); const optionsError = ref('')
let version = 0; let active = true
const maximum = computed(() => Math.max(1, ...(result.value?.byMonth.map(row => row.quantity) ?? [])))
const cards = computed(() => result.value ? [
  { label: 'Tổng sản lượng', value: `${quantity(result.value.summary.quantity)} kg` },
  { label: 'Lần thu hoạch', value: quantity(result.value.summary.harvestCount) },
  { label: 'Vụ có thu hoạch', value: quantity(result.value.summary.batchCount) },
  { label: 'Cơ sở có thu hoạch', value: quantity(result.value.summary.farmCount) },
] : [])
const period = computed(() => result.value ? `${result.value.filters.from ? date(result.value.filters.from + 'T00:00:00+07:00') : 'Từ đầu'} — ${result.value.filters.to ? date(result.value.filters.to + 'T00:00:00+07:00') : 'đến nay'}` : '')

async function loadOptions() {
  optionsLoading.value = true; optionsError.value = ''
  try { const response = await api.get<LotOptions>('/lots/options'); if (active) options.value = response }
  catch (cause) { if (active) optionsError.value = cause instanceof Error ? cause.message : 'Không tải được bộ lọc' }
  finally { if (active) optionsLoading.value = false }
}
async function load() {
  const current = ++version
  const string = (key: string) => typeof route.query[key] === 'string' ? String(route.query[key]) : ''
  filters.value = { farmId: string('farmId'), pondId: string('pondId'), species: string('species'), from: string('from'), to: string('to') }
  loading.value = true; error.value = ''; result.value = null
  try {
    const response = await api.get<ProductionResponse>(`/lots/production?${queryString(filters.value)}`)
    if (current === version) result.value = response
  } catch (cause) { if (current === version) error.value = cause instanceof Error ? cause.message : 'Không tải được thống kê sản lượng' }
  finally { if (current === version) loading.value = false }
}
async function apply() {
  const query = Object.fromEntries(new URLSearchParams(queryString(filters.value)))
  if (queryString(query) === queryString(route.query)) await load()
  else await router.push({ query })
}
function reset() { filters.value = emptyFilters(); void apply() }
function exportCsv() {
  const data = result.value
  if (!data) return
  const rows: (string | number | null)[][] = [
    ['THỐNG KÊ SẢN LƯỢNG'], ['Thời điểm lập', date(data.generatedAt, true)], ['Khoảng thu hoạch', period.value],
    ['Cơ sở', options.value.farms.find(f => f.id === data.filters.farmId)?.farm_name || data.filters.farmId || 'Tất cả'],
    ['Ao', options.value.ponds.find(p => p.id === data.filters.pondId)?.pond_name || data.filters.pondId || 'Tất cả'],
    ['Loài', data.filters.species ? speciesLabel(data.filters.species) : 'Tôm và cua'],
    ['Tổng sản lượng (kg)', data.summary.quantity], ['Số lần thu hoạch', data.summary.harvestCount], ['Số vụ', data.summary.batchCount], [],
    ['Theo tháng', 'Sản lượng (kg)', 'Lần thu hoạch'], ...data.byMonth.map(r => [r.month, r.quantity, r.harvestCount]), [],
    ['Theo loài', 'Sản lượng (kg)', 'Lần thu hoạch'], ...data.bySpecies.map(r => [speciesLabel(r.species), r.quantity, r.harvestCount]), [],
    ['Theo cơ sở', 'Sản lượng (kg)', 'Lần thu hoạch'], ...data.byFarm.map(r => [r.farmName, r.quantity, r.harvestCount]), [],
    ['Theo ao', 'Cơ sở', 'Sản lượng (kg)', 'Lần thu hoạch'], ...data.byPond.map(r => [r.pondName, r.farmName, r.quantity, r.harvestCount]),
  ]
  downloadCsv(`san-luong-${data.generatedAt.slice(0, 10)}.csv`, rows)
}
watch(() => route.fullPath, load, { immediate: true })
onMounted(loadOptions)
onUnmounted(() => { active = false; version++ })
</script>

<template>
  <main class="page-container production-page" :aria-busy="loading">
    <PageHeader title="Thống kê sản lượng" description="Tổng hợp khối lượng thực tế từ các lần thu hoạch, bao gồm thu hoạch một phần.">
      <template #actions><va-button preset="secondary" icon="download" :disabled="!result || loading" @click="exportCsv">Xuất CSV</va-button></template>
    </PageHeader>
    <form class="filter-card" @submit.prevent="apply">
      <ProductionFilters v-model="filters" :options="options" :disabled="optionsLoading" />
      <va-alert v-if="optionsError" color="danger" role="alert">{{ optionsError }} <va-button type="button" preset="secondary" @click="loadOptions">Thử lại</va-button></va-alert>
      <div class="actions"><va-button type="submit" :loading="loading">Xem thống kê</va-button><va-button type="button" preset="secondary" :disabled="loading" @click="reset">Xóa bộ lọc</va-button></div>
    </form>
    <va-alert v-if="error" color="danger" role="alert">{{ error }} <va-button preset="secondary" @click="load">Thử lại</va-button></va-alert>
    <LoadingState v-if="loading" />
    <template v-else-if="result">
      <p class="period">{{ period }} · Cập nhật {{ date(result.generatedAt, true) }} (giờ Việt Nam)</p>
      <div class="summary-cards"><article v-for="card in cards" :key="card.label"><p>{{ card.label }}</p><strong>{{ card.value }}</strong></article></div>
      <EmptyState v-if="!result.summary.harvestCount" title="Chưa có thu hoạch trong phạm vi này" description="Thử mở rộng khoảng ngày hoặc chọn cơ sở khác." />
      <template v-else>
        <section class="panel"><h2>Sản lượng theo tháng</h2><p class="muted">Hiển thị các tháng có ghi nhận thu hoạch; đơn vị kg.</p>
          <div class="monthly-chart" role="list" aria-label="Sản lượng theo tháng">
            <div v-for="row in result.byMonth" :key="row.month" class="chart-row" role="listitem"><span>{{ row.month.slice(5) }}/{{ row.month.slice(0, 4) }}</span><div class="bar-track" aria-hidden="true"><div :style="{ width: `${Math.max(.5, row.quantity / maximum * 100)}%` }" /></div><strong>{{ quantity(row.quantity) }} kg</strong></div>
          </div>
          <details><summary>Bảng số liệu theo tháng</summary><div class="table-scroll"><table><thead><tr><th>Tháng</th><th>Sản lượng (kg)</th><th>Lần thu hoạch</th></tr></thead><tbody><tr v-for="row in result.byMonth" :key="row.month"><td>{{ row.month }}</td><td>{{ quantity(row.quantity) }}</td><td>{{ row.harvestCount }}</td></tr></tbody></table></div></details>
        </section>
        <div class="breakdowns">
          <section class="panel"><h2>Theo loài nuôi</h2><table><thead><tr><th>Loài</th><th>Khối lượng</th><th>Lần thu</th></tr></thead><tbody><tr v-for="row in result.bySpecies" :key="row.species"><td>{{ speciesLabel(row.species) }}</td><td>{{ quantity(row.quantity) }} kg</td><td>{{ row.harvestCount }}</td></tr></tbody></table></section>
          <section class="panel"><h2>Theo cơ sở nuôi</h2><div class="table-scroll"><table><thead><tr><th>Cơ sở</th><th>Khối lượng</th><th>Lần thu</th></tr></thead><tbody><tr v-for="row in result.byFarm" :key="row.farmId"><td>{{ row.farmName }}</td><td>{{ quantity(row.quantity) }} kg</td><td>{{ row.harvestCount }}</td></tr></tbody></table></div></section>
        </div>
        <section class="panel"><h2>Theo ao nuôi</h2><div class="table-scroll"><table><thead><tr><th>Ao</th><th>Cơ sở</th><th>Sản lượng (kg)</th><th>Lần thu hoạch</th></tr></thead><tbody><tr v-for="row in result.byPond" :key="row.pondId"><td>{{ row.pondName }}</td><td>{{ row.farmName }}</td><td>{{ quantity(row.quantity) }}</td><td>{{ row.harvestCount }}</td></tr></tbody></table></div></section>
      </template>
      <p class="muted">Số liệu cộng theo ngày thu hoạch ở múi giờ Việt Nam. Loài và tên nguồn gốc dùng hồ sơ tại lúc tạo lô; các lần thu cũ chưa có lô dùng thông tin vụ hiện có.</p>
    </template>
  </main>
</template>

<style scoped>
.filter-card, .panel { padding: 20px; background: var(--app-surface); border: 1px solid var(--app-line); border-radius: var(--app-radius); margin-bottom: 20px; min-width: 0; }
.actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 16px; }
.summary-cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin: 20px 0; }
.summary-cards article { padding: 20px; border: 1px solid var(--app-line); border-radius: var(--app-radius); background: var(--app-surface); overflow-wrap: anywhere; }
.summary-cards p, .muted, .period { color: var(--app-muted); font-size: .88rem; }
.summary-cards strong { display: block; font-size: clamp(1.2rem, 2.2vw, 1.8rem); margin-top: 8px; color: var(--app-primary-dark); }
h2 { font-size: 1.08rem; margin: 0 0 12px; } .breakdowns { display: grid; grid-template-columns: 1fr 1.5fr; gap: 20px; }
.monthly-chart { display: grid; gap: 14px; margin: 20px 0; max-height: 400px; overflow-y: auto; }
.chart-row { display: grid; grid-template-columns: 75px minmax(20px, 1fr) 120px; gap: 12px; align-items: center; font-size: .88rem; }
.chart-row strong { text-align: right; font-variant-numeric: tabular-nums; } .bar-track { background: var(--app-primary-soft); border-radius: 4px; height: 20px; } .bar-track > div { height: 100%; background: var(--app-primary); border-radius: 4px; }
.table-scroll { overflow-x: auto; } table { width: 100%; text-align: left; border-collapse: collapse; font-size: .88rem; } th, td { padding: 12px 8px; border-bottom: 1px solid var(--app-line); } th { color: var(--app-muted); font-weight: 600; } td:not(:first-child) { font-variant-numeric: tabular-nums; }
summary { cursor: pointer; min-height: 44px; display: flex; align-items: center; color: var(--app-primary-dark); }
@media (max-width: 800px) { .summary-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); } .breakdowns { grid-template-columns: 1fr; gap: 0; } }
@media (max-width: 480px) { .chart-row { grid-template-columns: 58px minmax(10px, 1fr) 92px; gap: 6px; font-size: .8rem; } }
</style>
