<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { VaAlert, VaButton, VaIcon } from 'vuestic-ui'
import LoadingState from '../../components/LoadingState.vue'
import { api } from '../../api/client'
import { SPECIES_LABELS, type BatchItem, type BatchListResponse, type Farm } from '../../types'

const props = defineProps<{ farms: Farm[]; recent: BatchItem[] }>()
const growing = ref<BatchItem[]>([])
const ready = ref<BatchItem[]>([])
const loading = ref(true)
const error = ref('')
const panels = computed(() => [
  { title: 'Cần xử lý', icon: 'agriculture', rows: ready.value, work: true, empty: 'Chưa có vụ sẵn sàng thu hoạch.' },
  { title: 'Vụ nuôi đang hoạt động', icon: 'water', rows: growing.value, work: false, empty: 'Chưa có vụ đang nuôi.' },
])
const date = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeZone: 'Asia/Ho_Chi_Minh' })
const recentBatches = computed(() => props.recent.slice(0, 4))

function destination(batch: BatchItem, harvest: boolean) {
  const pond = batch.pond
  if (!pond?.farm_id || !props.farms.some((farm) => farm.id === pond.farm_id)) return null
  const params = { farmId: pond.farm_id, pondId: pond.id }
  return harvest
    ? { name: 'pond-batches', params, query: { harvest: batch.id } }
    : { name: 'farming-logs', params: { ...params, batchId: batch.id } }
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [readyResult, growingResult] = await Promise.all([
      api.get<BatchListResponse>('/batches?pageSize=5&status=READY_FOR_HARVEST'),
      api.get<BatchListResponse>('/batches?pageSize=5&status=GROWING'),
    ])
    ready.value = readyResult.items
    growing.value = growingResult.items
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Không tải được tổng quan công việc.'
  } finally {
    loading.value = false
  }
}
onMounted(load)
</script>

<template>
  <LoadingState v-if="loading" />
  <va-alert v-else-if="error" color="danger" role="alert">
    {{ error }} <va-button preset="secondary" size="small" @click="load">Thử lại</va-button>
  </va-alert>
  <div v-else class="operations-grid">
    <section v-for="panel in panels" :key="panel.title" class="operation-card" :class="{ 'work-card': panel.work }">
      <h2><va-icon :name="panel.icon" aria-hidden="true" />{{ panel.title }}</h2>
      <p v-if="!panel.rows.length" class="empty">{{ panel.empty }}</p>
      <ul v-else>
        <li v-for="batch in panel.rows" :key="batch.id" class="batch-row">
          <div>
            <strong>{{ batch.batch_code }} · {{ SPECIES_LABELS[batch.species] }}</strong>
            <small>{{ [batch.pond?.farm_name, batch.pond?.pond_name].filter(Boolean).join(' / ') }}</small>
            <small v-if="panel.work">Sẵn sàng thu hoạch</small>
            <template v-else>
              <small>Thả giống {{ date.format(new Date(batch.stocking_date)) }}</small>
              <small v-if="batch.expected_harvest_date">Dự kiến thu hoạch {{ date.format(new Date(batch.expected_harvest_date)) }}</small>
            </template>
          </div>
          <RouterLink v-if="destination(batch, panel.work)" :to="destination(batch, panel.work)!" class="action">
            {{ panel.work ? 'Mở thu hoạch' : 'Mở nhật ký' }}
          </RouterLink>
        </li>
      </ul>
    </section>
    <section class="operation-card recent-card">
      <h2><va-icon name="history" aria-hidden="true" />Hoạt động gần đây</h2>
      <p v-if="!recentBatches.length" class="empty">Chưa có hoạt động tạo vụ trong danh sách hiện tại.</p>
      <ul v-else>
        <li v-for="batch in recentBatches" :key="batch.id">
          <strong>Đã tạo vụ {{ batch.batch_code }}</strong>
          <small><time :datetime="batch.created_at">{{ date.format(new Date(batch.created_at)) }}</time></small>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.operations-grid { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 16px; margin: 0 0 24px; align-items: start; }
.operation-card { min-width: 0; padding: 16px; border: 1px solid var(--app-line); border-radius: var(--app-radius); background: var(--app-surface); overflow-wrap: anywhere; }
.work-card { grid-column: 1 / -1; }
h2 { display: flex; align-items: center; gap: 8px; font-size: 1.05rem; margin: 0; padding: 10px; border-radius: var(--app-control-radius); }
h2 .va-icon, .action { color: var(--app-primary-dark); }
.work-card h2 { background: var(--app-primary-soft); }
ul { list-style: none; margin: 0; padding: 0 10px; }
li { padding: 10px 0; border-bottom: 1px solid var(--app-line); }
li:last-child { border-bottom: 0; }
.batch-row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
small { display: block; margin-top: 4px; }
small, .empty { color: var(--app-muted); }
.empty { margin: 10px; }
.action { display: inline-flex; min-height: 44px; align-items: center; padding: 6px 10px; border: 1px solid var(--app-line); border-radius: var(--app-control-radius); font-weight: 650; }
.action:hover { background: var(--app-primary-soft); }
@media (max-width: 750px) { .operations-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
