<script setup lang="ts">
import { dismissOnBackdrop } from '../../components/overlay-dismiss'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { VaAlert, VaBadge, VaButton } from 'vuestic-ui'
import EmptyState from '../../components/EmptyState.vue'
import LoadingState from '../../components/LoadingState.vue'
import { api } from '../../api/client'
import { usePondBatchesStore } from '../../stores/pond-batches.store'
import {
  FARMING_LOG_TYPE_LABELS, SPECIES_LABELS, STATUS_LABELS,
  type BatchItem, type BatchVersion, type FarmingLog, type FarmingLogListResponse,
  type FarmResponse, type HarvestLot, type Pond,
} from '../../types'
import BatchVersionList from './BatchVersionList.vue'
import { detailsRows } from './farming-log-details'

type Section = 'general' | 'logs' | 'harvest' | 'history'
const props = defineProps<{
  batch: BatchItem; farmId: string; pondId: string; pond?: Pond
  initialSection: 'general' | 'history'; badgeColor: string
}>()
const emit = defineEmits<{ close: []; edit: []; harvest: [] }>()
const store = usePondBatchesStore()
const dialog = ref<HTMLDialogElement | null>(null)
const section = ref<Section>(props.initialSection)
const retry = ref(0)
const loading = ref(false)
const error = ref('')
const farmName = ref('')
const logs = ref<FarmingLog[]>([])
const lots = ref<HarvestLot[]>([])
const versions = ref<BatchVersion[]>([])
const tabs = [
  { value: 'general', label: 'Thông tin chung' },
  { value: 'logs', label: 'Nhật ký nuôi' },
  { value: 'harvest', label: 'Thu hoạch & Lô hàng' },
  { value: 'history', label: 'Lịch sử' },
] as const
const logStatuses = { DRAFT: 'Bản nháp', CONFIRMED: 'Đã chứng thực', REVOKED: 'Đã thu hồi' }
const logColors = { DRAFT: 'secondary', CONFIRMED: 'success', REVOKED: 'danger' }
const params = computed(() => ({ farmId: props.farmId, pondId: props.pondId, batchId: props.batch.id }))
const canCreateLog = computed(() => props.pond?.permissions?.includes('LOG_CREATE'))
const canEditBatch = computed(() => props.pond?.permissions?.includes('BATCH_EDIT'))
const date = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' })
const timestamp = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' })
const day = (value: string | null | undefined) => value ? date.format(new Date(value)) : '—'
const number = new Intl.NumberFormat('vi-VN')

onMounted(() => dialog.value?.showModal())
onBeforeUnmount(() => dialog.value?.close())

watch([section, retry], async ([current], _, onCleanup) => {
  let active = true
  onCleanup(() => { active = false })
  loading.value = true
  error.value = ''
  try {
    if (current === 'general') {
      const result = await api.get<FarmResponse>(`/farms/${props.farmId}`)
      if (active) farmName.value = result.farm.farm_name
    } else if (current === 'logs') {
      const result = await api.get<FarmingLogListResponse>(`/farming-logs/batch/${props.batch.id}`)
      if (active) logs.value = [...result.items].sort((a, b) => Date.parse(b.log_date) - Date.parse(a.log_date))
    } else if (current === 'harvest') {
      const result = await api.get<{ items: HarvestLot[] }>(`/farms/${props.farmId}/ponds/${props.pondId}/batches/${props.batch.id}/harvests`)
      if (active) lots.value = result.items
    } else {
      const result = await store.history(props.farmId, props.pondId, props.batch.id)
      if (active) versions.value = result
    }
  } catch (cause) {
    if (active) error.value = cause instanceof Error ? cause.message : 'Không tải được dữ liệu. Vui lòng thử lại.'
  } finally {
    if (active) loading.value = false
  }
}, { immediate: true })
</script>

<template>
  <dialog ref="dialog" class="batch-drawer" aria-labelledby="batch-detail-name" @cancel.prevent="emit('close')" @click="dismissOnBackdrop($event, () => emit('close'))">
    <header class="drawer-header">
      <div>
        <nav class="context" aria-label="Vị trí của vụ nuôi">
          <RouterLink :to="{ name: 'farms' }">{{ farmName || 'Cơ sở nuôi' }}</RouterLink>
          <span aria-hidden="true">/</span>
          <RouterLink :to="{ name: 'ponds', params: { farmId } }">{{ pond?.pond_name || 'Ao nuôi' }}</RouterLink>
          <span aria-hidden="true">/</span><span aria-current="page">{{ batch.batch_code }}</span>
        </nav>
        <h2 id="batch-detail-name">{{ SPECIES_LABELS[batch.species] }} · {{ batch.batch_code }}</h2>
        <va-badge :color="badgeColor" :text="STATUS_LABELS[batch.status]" />
      </div>
      <va-button preset="secondary" icon="close" @click="emit('close')">Đóng</va-button>
    </header>

    <div class="drawer-actions">
      <va-button v-if="canCreateLog" :to="{ name: 'farming-logs', params, query: { create: 'log' } }" icon="edit_document">Ghi nhật ký</va-button>
      <va-button preset="secondary" icon="agriculture" @click="emit('harvest')">Thu hoạch &amp; Lô</va-button>
      <va-button v-if="canEditBatch" preset="plain" icon="edit" @click="emit('edit')">Đính chính</va-button>
    </div>

    <div class="drawer-tabs" role="group" aria-label="Nội dung chi tiết vụ">
      <button v-for="tab in tabs" :key="tab.value" type="button"
        :aria-pressed="section === tab.value" @click="section = tab.value">{{ tab.label }}</button>
    </div>

    <div class="drawer-body" :aria-busy="loading">
      <va-alert v-if="error" color="danger" role="alert">
        {{ error }} <va-button preset="secondary" size="small" @click="retry++">Thử lại</va-button>
      </va-alert>
      <template v-if="section === 'general'">
        <section class="detail-card">
          <h3>Thông tin vụ nuôi</h3>
          <dl class="facts">
            <div><dt>Mã vụ</dt><dd>{{ batch.batch_code }}</dd></div>
            <div><dt>Loại thủy sản</dt><dd>{{ SPECIES_LABELS[batch.species] }}</dd></div>
            <div><dt>Ngày thả giống</dt><dd>{{ day(batch.stocking_date) }}</dd></div>
            <div><dt>Số lượng giống</dt><dd>{{ number.format(batch.seed_quantity) }}</dd></div>
            <div><dt>Nguồn giống</dt><dd>{{ batch.seed_source || '—' }}</dd></div>
            <div><dt>Dự kiến thu hoạch</dt><dd>{{ day(batch.expected_harvest_date) }}</dd></div>
            <div v-if="batch.note"><dt>Ghi chú</dt><dd>{{ batch.note }}</dd></div>
          </dl>
        </section>
        <section class="detail-card">
          <h3>Thông tin vùng nuôi</h3>
          <dl class="facts">
            <div><dt>Cơ sở</dt><dd><RouterLink :to="{ name: 'farms' }">{{ farmName || 'Cơ sở nuôi' }}</RouterLink></dd></div>
            <div><dt>Ao nuôi</dt><dd><RouterLink :to="{ name: 'ponds', params: { farmId } }">{{ pond?.pond_name || 'Ao nuôi' }}</RouterLink></dd></div>
            <div v-if="pond?.area != null"><dt>Diện tích ao</dt><dd>{{ number.format(pond.area) }} ha</dd></div>
          </dl>
        </section>
        <section class="detail-card">
          <h3>Trạng thái và tiến độ</h3>
          <dl class="facts">
            <div><dt>Trạng thái hiện tại</dt><dd>{{ STATUS_LABELS[batch.status] }}</dd></div>
            <div><dt>Bắt đầu vụ</dt><dd>{{ day(batch.stocking_date) }}</dd></div>
            <div v-if="batch.updated_at"><dt>Cập nhật gần nhất</dt><dd>{{ timestamp.format(new Date(batch.updated_at)) }}</dd></div>
            <div v-if="batch.actual_harvest_date"><dt>Ngày thu hoạch thực tế</dt><dd>{{ day(batch.actual_harvest_date) }}</dd></div>
            <div v-if="batch.yield_quantity != null"><dt>Sản lượng đã ghi nhận</dt><dd>{{ number.format(batch.yield_quantity) }} kg</dd></div>
          </dl>
        </section>
      </template>
      <LoadingState v-else-if="loading" />
      <template v-else-if="!error">
        <section v-if="section === 'logs'" class="detail-card">
          <div class="section-heading">
            <h3>Nhật ký của vụ</h3>
            <va-button v-if="canCreateLog" :to="{ name: 'farming-logs', params, query: { create: 'log' } }" icon="add" size="small">Ghi nhật ký mới</va-button>
          </div>
          <EmptyState v-if="!logs.length" heading="h3" title="Vụ chưa có nhật ký" />
          <ul v-else class="record-list">
            <li v-for="log in logs" :key="log.id">
              <details>
                <summary>
                  <span><strong>{{ FARMING_LOG_TYPE_LABELS[log.log_type] }}</strong><small>{{ timestamp.format(new Date(log.log_date)) }}</small></span>
                  <va-badge :color="logColors[log.lifecycle_status]" :text="logStatuses[log.lifecycle_status]" />
                </summary>
                <dl class="facts">
                  <div><dt>Người ghi</dt><dd>{{ log.author_name || '—' }}</dd></div>
                  <div v-if="log.confirmed_by"><dt>Người xác nhận</dt><dd>{{ log.confirmer_name || '—' }}</dd></div>
                  <div v-for="entry in detailsRows(log)" :key="entry.label"><dt>{{ entry.label }}</dt><dd>{{ entry.value }}</dd></div>
                </dl>
                <a v-if="log.image_url" :href="log.image_url" target="_blank" rel="noopener noreferrer">Xem ảnh nhật ký</a>
              </details>
            </li>
          </ul>
        </section>
        <section v-else-if="section === 'harvest'" class="detail-card">
          <div class="section-heading">
            <h3>Đợt thu hoạch và lô</h3>
            <va-button preset="secondary" size="small" @click="emit('harvest')">Mở quản lý thu hoạch</va-button>
          </div>
          <EmptyState v-if="!lots.length" heading="h3" title="Vụ chưa có thu hoạch" />
          <ul v-else class="record-list">
            <li v-for="lot in lots" :key="lot.id">
              <details>
                <summary>
                  <span><strong>{{ lot.lot_code }}</strong><small>{{ day(lot.harvest.harvest_date) }} · {{ number.format(lot.quantity) }} kg</small></span>
                  <small>{{ lot.harvest.is_final ? 'Kết thúc thu hoạch' : 'Thu một phần' }}</small>
                </summary>
                <dl class="facts">
                  <div><dt>Mã thu hoạch</dt><dd>{{ lot.harvest.id }}</dd></div>
                  <div><dt>Loại thủy sản</dt><dd>{{ SPECIES_LABELS[lot.provenance.batch.species] }}</dd></div>
                  <div><dt>Nguồn nuôi</dt><dd>{{ lot.provenance.farm.name }} / {{ lot.provenance.pond.name }}</dd></div>
                  <div v-if="lot.harvest.note"><dt>Ghi chú</dt><dd>{{ lot.harvest.note }}</dd></div>
                </dl>
              </details>
            </li>
          </ul>
        </section>
        <BatchVersionList v-else :versions="versions" />
      </template>
    </div>
  </dialog>
</template>

<style scoped>
.batch-drawer { position: fixed; inset: 0 0 0 auto; margin: 0; padding: 0; width: min(100%, 680px); max-width: none; height: 100dvh; max-height: none; border: 0; color: var(--app-ink); background: var(--app-canvas); }
.batch-drawer[open] { display: flex; flex-direction: column; }
.batch-drawer::backdrop { background: rgb(7 28 36 / 45%); }
.drawer-header, .drawer-actions, .drawer-tabs { padding: 12px 20px; background: var(--app-surface); }
.drawer-header { display: flex; align-items: start; justify-content: space-between; gap: 10px; }
.drawer-header h2 { font-size: 1.4rem; margin: 8px 0; }
.context, .drawer-actions, .drawer-tabs, .section-heading { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.context { color: var(--app-muted); font-size: .82rem; }
a { color: var(--app-primary-dark); text-decoration: underline; text-underline-offset: 3px; }
.drawer-tabs { padding-block: 0; border-bottom: 1px solid var(--app-line); }
.drawer-tabs button { min-height: 44px; padding: 6px 8px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--app-muted); cursor: pointer; font: inherit; }
.drawer-tabs button[aria-pressed="true"] { border-bottom-color: var(--app-primary); color: var(--app-primary-dark); font-weight: 650; }
.drawer-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 16px 20px; overflow-wrap: anywhere; }
.drawer-body > * + * { margin-top: 12px; }
.detail-card { padding: 14px; border: 1px solid var(--app-line); border-radius: var(--app-radius); background: var(--app-surface); }
h3 { margin: 0 0 10px; font-size: 1rem; }
.section-heading { justify-content: space-between; }
.section-heading h3 { margin: 0; }
.facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 0; }
dt, small { display: block; color: var(--app-muted); font-size: .8rem; }
dd { margin: 4px 0 0; font-weight: 600; }
.record-list { list-style: none; padding: 0; margin: 10px 0 0; }
.record-list li + li { border-top: 1px solid var(--app-line); }
summary { display: list-item; padding: 10px 0; min-height: 44px; cursor: pointer; }
summary span { display: inline-block; margin-inline: 4px 10px; }
.record-list .facts { padding: 4px 0 12px; }
:focus-visible { outline: 2px solid var(--app-primary); outline-offset: 2px; }
@media (max-width: 600px) {
  .drawer-header, .drawer-tabs, .drawer-actions, .drawer-body { padding-inline: 14px; }
  .drawer-tabs { column-gap: 4px; }
}
</style>
