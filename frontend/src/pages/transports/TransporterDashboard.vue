<script setup lang="ts">
import { draftDismiss, dismissOnBackdrop } from '../../components/overlay-dismiss'
import ReceiptSummary from './ReceiptSummary.vue'
import TransportProgress from './TransportProgress.vue'
import PageHeader from '../../components/PageHeader.vue'
import EmptyState from '../../components/EmptyState.vue'
import { computed, nextTick, onMounted, ref } from 'vue'
import { VaAlert, VaButton, VaIcon } from 'vuestic-ui'
import { useAuthStore } from '../../stores/auth.store'
import { api } from '../../api/client'
import type { LotTransport, Species, TransportEvent } from '../../types'

interface TransportJob extends LotTransport {
  claimed_at?: string | null
  created_at?: string
  updated_at?: string
  lot: {
    id: string
    lot_code: string
    quantity: number
    provenance: {
      farm: { name: string; address?: string | null }
      pond: { code: string; name: string }
      batch: { batch_code: string; species: Species }
    }
  } | null
}
const props = defineProps<{ overview?: boolean }>()
const auth = useAuthStore()
const available = ref<TransportJob[]>([])
const assigned = ref<TransportJob[]>([])
const loading = ref(true)
const loadedJobs = ref(false)
const busyId = ref<string | null>(null)
const error = ref('')
const notice = ref('')
const details = ref<Record<string, {
  vehicle: string; driver: string; temperature: string | number
  cancellationReason: string
  trackingStatus: string; trackingLocation: string; trackingTemperature: string | number; trackingNote: string
  deliveryProofUrl: string
}>>({})
const selectedView = ref(props.overview ? 'all' : 'available')
const search = ref('')
const dialog = ref<HTMLDialogElement | null>(null)
const selectedId = ref('')
const dialogTrigger = ref<HTMLElement | null>(null)
const actionError = ref('')
const statusLabels: Record<string, string> = {
  available: 'Chờ nhận', planning: 'Chờ khởi hành', moving: 'Đang vận chuyển',
  reported: 'Chờ xác nhận bàn giao', delivered: 'Đã bàn giao', rejected: 'Đã từ chối nhận', cancelled: 'Đã hủy',
}

function stage(job: TransportJob) {
  if (job.status === 'PLANNING') return job.handler_id ? 'planning' : 'available'
  if (job.status === 'IN_TRANSIT') return job.delivery_reported_at ? 'reported' : 'moving'
  if (job.status === 'REJECTED') return 'rejected'
  return job.status === 'DELIVERED' ? 'delivered' : 'cancelled'
}

const trackingStatuses = [
  { value: 'PICKED_UP', label: 'Đã lấy hàng' },
  { value: 'IN_TRANSIT', label: 'Đang trên đường' },
  { value: 'AT_SORTING_FACILITY', label: 'Đã đến điểm trung chuyển' },
  { value: 'DEPARTED_FACILITY', label: 'Đã rời điểm trung chuyển' },
  { value: 'OUT_FOR_DELIVERY', label: 'Đang giao tới người nhận' },
  { value: 'DELIVERY_ATTEMPT_FAILED', label: 'Giao hàng chưa thành công' },
  { value: 'DELIVERED_REPORTED', label: 'Giao hàng thành công' },
  { value: 'OTHER', label: 'Cập nhật khác' },
]
const trackingStatusLabels = Object.fromEntries(trackingStatuses.map(({ value, label }) => [value, label])) as Record<string, string>
const eventLabels: Record<string, string> = { REQUESTED: 'Tạo yêu cầu', CLAIMED: 'Người vận chuyển nhận chuyến', IN_TRANSIT: 'Bắt đầu vận chuyển', CHECKPOINT: 'Điểm kiểm tra', DELIVERY_REPORTED: 'Báo đã giao', RECIPIENT_ASSIGNED: 'Gán nhà phân phối nhận', TRACKING_UPDATE: 'Cập nhật hành trình', DELIVERED: 'Nhà phân phối xác nhận đã nhận', REJECTED: 'Nhà phân phối từ chối nhận', CANCELLED: 'Hủy chuyến' }
const jobs = computed(() => [...available.value, ...assigned.value])
const groups = computed(() => ({
  all: jobs.value,
  available: available.value,
  planning: assigned.value.filter((job) => stage(job) === 'planning'),
  moving: assigned.value.filter((job) => stage(job) === 'moving'),
  reported: assigned.value.filter((job) => stage(job) === 'reported'),
  active: assigned.value.filter((job) => ['PLANNING', 'IN_TRANSIT'].includes(job.status)),
  delivered: assigned.value.filter((job) => stage(job) === 'delivered'),
  history: assigned.value.filter((job) => ['DELIVERED', 'REJECTED', 'CANCELLED'].includes(job.status)),
}))
type Group = keyof typeof groups.value
const tabs = computed<{ id: Group; label: string }[]>(() => props.overview
  ? [{ id: 'all', label: 'Tất cả' }, { id: 'available', label: 'Chờ nhận' }, { id: 'active', label: 'Đang thực hiện' }, { id: 'delivered', label: 'Đã bàn giao' }]
  : [{ id: 'available', label: 'Yêu cầu mới' }, { id: 'active', label: 'Đang thực hiện' }, { id: 'history', label: 'Lịch sử' }],
)
const selectedJob = computed(() => jobs.value.find((job) => job.id === selectedId.value))
const pending = computed(() => [...groups.value.available, ...groups.value.planning, ...groups.value.moving])
const recent = computed(() => jobs.value.flatMap((job) => (job.events ?? []).map((event) => ({ job, event })))
  .sort((a, b) => Date.parse(b.event.occurred_at) - Date.parse(a.event.occurred_at)).slice(0, 3))
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const deliveredToday = computed(() => {
  const today = day.format()
  return groups.value.delivered.filter((job) => {
    const deliveredAt = eventTime(job, 'DELIVERED')
    return deliveredAt && day.format(new Date(deliveredAt)) === today
  }).length
})
const stats = computed(() => [
  { label: 'Yêu cầu vận chuyển', value: groups.value.available.length, icon: 'local_shipping', tone: 'teal', hint: 'Chờ nhận' },
  props.overview
    ? { label: 'Đang vận chuyển', value: groups.value.moving.length, icon: 'calendar_today', tone: 'blue', hint: 'Đang di chuyển' }
    : { label: 'Chờ khởi hành', value: groups.value.planning.length, icon: 'schedule', tone: 'amber', hint: 'Đã nhận chuyến' },
  props.overview
    ? { label: 'Đã bàn giao hôm nay', value: deliveredToday.value, icon: 'task_alt', tone: 'green', hint: 'Hoàn tất' }
    : { label: 'Đang vận chuyển', value: groups.value.moving.length, icon: 'local_shipping', tone: 'blue', hint: 'Đang di chuyển' },
  props.overview
    ? { label: 'Tổng chuyến hiển thị', value: jobs.value.length, icon: 'inventory_2', tone: 'amber', hint: 'Toàn bộ danh sách' }
    : { label: 'Đã bàn giao', value: groups.value.delivered.length, icon: 'task_alt', tone: 'green', hint: 'Bên nhận đã xác nhận' },
])
const progressTotal = computed(() => jobs.value.length - groups.value.history.length + groups.value.delivered.length)
const progressPercent = computed(() => progressTotal.value ? groups.value.delivered.length / progressTotal.value * 100 : 0)
const visibleJobs = computed(() => {
  const source = groups.value[selectedView.value as Group]
  if (props.overview) return (selectedView.value === 'all'
    ? [...pending.value, ...groups.value.reported, ...groups.value.history]
    : source).slice(0, 3)
  const query = search.value.trim().toLocaleLowerCase('vi-VN')
  if (!query) return source
  return source.filter((job) => [job.transport_code, job.from_location, job.to_location, job.lot?.lot_code,
    job.lot?.provenance.farm.name, job.lot?.provenance.batch.batch_code]
    .some((value) => value?.toLocaleLowerCase('vi-VN').includes(query)))
})
const emptyTitles: Record<string, string> = {
  available: 'Chưa có yêu cầu mới', active: 'Chưa có chuyến đang thực hiện',
  history: 'Chưa có lịch sử vận chuyển', delivered: 'Chưa có chuyến đã bàn giao',
}
const pendingLabels: Record<string, string> = {
  available: 'Nhận chuyến', planning: 'Xác nhận khởi hành', moving: 'Cập nhật hành trình',
}

function eventTime(job: TransportJob, type: string) {
  return job.events?.find((event) => event.event_type === type)?.occurred_at
}
function rowTime(job: TransportJob) {
  return eventTime(job, 'DELIVERED') ?? job.updated_at ?? job.created_at
}
function rowTimeLabel(job: TransportJob) {
  if (eventTime(job, 'DELIVERED')) return 'Bàn giao'
  return job.updated_at ? 'Cập nhật' : 'Tạo yêu cầu'
}
const detailDismiss = draftDismiss(() => selectedJob.value && formFor(selectedJob.value), () => Boolean(busyId.value))
function requestCloseDetail() { detailDismiss.dismiss(() => dialog.value?.close()) }
async function openDetail(job: TransportJob, trigger?: Event) {
  dialogTrigger.value = trigger?.currentTarget instanceof HTMLElement ? trigger.currentTarget : null
  selectedId.value = job.id
  detailDismiss.markClean()
  actionError.value = ''
  await nextTick()
  if (!dialog.value?.open) dialog.value?.showModal()
}
function closeDetail() {
  delete details.value[selectedId.value]
  selectedId.value = ''
  actionError.value = ''
  if (dialogTrigger.value?.isConnected) dialogTrigger.value.focus()
  else document.getElementById('transport-list-title')?.focus()
}

function formFor(job: TransportJob) {
  details.value[job.id] ??= {
    vehicle: job.vehicle ?? '', driver: job.driver ?? '', temperature: job.temperature ?? '',
    cancellationReason: '',
    trackingStatus: 'IN_TRANSIT', trackingLocation: '', trackingTemperature: '', trackingNote: '',
    deliveryProofUrl: typeof job.delivery_report?.proofImageUrl === 'string' ? job.delivery_report.proofImageUrl : '',
  }
  return details.value[job.id]!
}
async function uploadDeliveryProof(event: Event, job: TransportJob) {
  if (busyId.value) return
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  actionError.value = ''
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { actionError.value = 'Chỉ hỗ trợ ảnh JPG, PNG hoặc WebP.'; return }
  if (file.size > 10 * 1024 * 1024) { actionError.value = 'Ảnh không được lớn hơn 10 MB.'; return }
  const payload = new FormData()
  payload.append('image', file)
  busyId.value = job.id
  try {
    const result = await api.upload<{ imageUrl: string }>(`/transports/${job.id}/delivery-proof`, payload)
    formFor(job).deliveryProofUrl = result.imageUrl
    notice.value = 'Đã tải ảnh bằng chứng lên. Ảnh sẽ được lưu cùng báo cáo khi bạn ghi nhận giao hàng thành công.'
  } catch (e) { actionError.value = e instanceof Error ? e.message : 'Không tải được ảnh bằng chứng giao hàng.' }
  finally { busyId.value = null }
}
function validText(value: string, label: string, min: number, max: number) {
  const normalized = value.trim()
  if (normalized.length < min) { actionError.value = `${label} cần ít nhất ${min} ký tự.`; return false }
  if (normalized.length > max) { actionError.value = `${label} không được vượt quá ${max} ký tự.`; return false }
  return true
}
function validTemperature(value: string | number) {
  if (value === '') return true
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < -100 || parsed > 100 || Math.abs(parsed * 100 - Math.round(parsed * 100)) > 0.001) {
    actionError.value = 'Nhiệt độ phải từ -100 đến 100 °C, tối đa 2 chữ số thập phân.'
    return false
  }
  return true
}
async function load() {
  loading.value = true; error.value = ''
  try {
    const result = await api.get<{ available: TransportJob[]; assigned: TransportJob[] }>('/transports')
    available.value = result.available; assigned.value = result.assigned
    for (const item of [...result.available, ...result.assigned]) formFor(item)
    loadedJobs.value = true
  } catch (e) { error.value = e instanceof Error ? e.message : 'Không tải được danh sách chuyến' }
  finally { loading.value = false }
}
async function claim(job: TransportJob) {
  if (busyId.value || !window.confirm(`Nhận chuyến ${job.transport_code}?`)) return
  busyId.value = job.id; actionError.value = ''; notice.value = ''
  try { await api.post(`/transports/${job.id}/claim`); notice.value = `Đã nhận chuyến ${job.transport_code}.`; await load() }
  catch (e) { actionError.value = e instanceof Error ? e.message : 'Không nhận được chuyến' }
  finally { busyId.value = null }
}
async function update(job: TransportJob, status: LotTransport['status']) {
  if (busyId.value) return
  actionError.value = ''; notice.value = ''
  const form = formFor(job)
  if (status === 'IN_TRANSIT' && (!validText(form.vehicle, 'Phương tiện', 1, 255) || !validText(form.driver, 'Tài xế', 1, 255))) return
  if (status === 'CANCELLED' && !validText(form.cancellationReason, 'Lý do hủy', 3, 1000)) return
  if (!validTemperature(form.temperature)) return
  if (status === 'CANCELLED' && !window.confirm(`Hủy chuyến ${job.transport_code}?`)) return
  if (status === 'IN_TRANSIT' && !window.confirm(`Bắt đầu vận chuyển ${job.transport_code}?`)) return
  busyId.value = job.id
  try {
    await api.patch(`/transports/${job.id}/status`, {
      status, vehicle: form.vehicle, driver: form.driver,
      temperature: form.temperature === '' ? null : Number(form.temperature),
      cancellationReason: form.cancellationReason,
    })
    notice.value = status === 'IN_TRANSIT' ? `Đã bắt đầu vận chuyển ${job.transport_code}.` : `Đã hủy chuyến ${job.transport_code}.`
    detailDismiss.markClean()
    await load()
  } catch (e) { actionError.value = e instanceof Error ? e.message : 'Không cập nhật được chuyến' }
  finally { busyId.value = null }
}
async function recordTrackingUpdate(job: TransportJob) {
  if (busyId.value) return
  actionError.value = ''; notice.value = ''
  const form = formFor(job)
  if (!validText(form.trackingLocation, 'Địa điểm cập nhật', 2, 500)) return
  if (!validTemperature(form.trackingTemperature)) return
  if (form.trackingNote.trim() && !validText(form.trackingNote, 'Ghi chú cập nhật', 1, 1000)) return
  if (form.trackingStatus === 'OTHER' && !validText(form.trackingNote, 'Ghi chú khi chọn cập nhật khác', 2, 1000)) return
  if (form.trackingStatus === 'DELIVERED_REPORTED' && !form.deliveryProofUrl) { actionError.value = 'Vui lòng tải ảnh bằng chứng giao hàng trước khi báo giao thành công.'; return }
  if (form.trackingStatus === 'DELIVERED_REPORTED' && !window.confirm(`Báo giao thành công chuyến ${job.transport_code}?`)) return
  busyId.value = job.id
  try {
    await api.post(`/transports/${job.id}/tracking-updates`, {
      trackingStatus: form.trackingStatus, location: form.trackingLocation,
      temperature: form.trackingTemperature === '' ? null : Number(form.trackingTemperature), note: form.trackingNote,
      deliveryProofUrl: form.deliveryProofUrl || null,
    })
    notice.value = form.trackingStatus === 'DELIVERED_REPORTED'
      ? `Đã báo giao thành công chuyến ${job.transport_code}. Đang chờ nhà phân phối xác nhận.`
      : `Đã cập nhật hành trình chuyến ${job.transport_code}.`
    form.trackingTemperature = ''
    form.trackingNote = ''
    detailDismiss.markClean()
    await load()
  } catch (e) { actionError.value = e instanceof Error ? e.message : 'Không cập nhật được hành trình' }
  finally { busyId.value = null }
}
function formatDate(value: string) { return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) }
function proofLabel(status?: string) { return status === 'SUCCESS' ? 'Đã xác nhận' : status === 'FAILED' ? 'Cần thử lại' : 'Đang chờ blockchain' }
function eventSummary(event: TransportEvent) {
  const payload = event.payload
  const value = (key: string) => payload[key] == null ? '' : String(payload[key])
  if (event.event_type === 'REQUESTED') return `${value('quantity')} kg · ${value('fromLocation')} → ${value('toLocation')}`
  if (event.event_type === 'IN_TRANSIT') return [value('vehicle'), value('driver') && `Tài xế ${value('driver')}`, value('temperature') && `${value('temperature')} °C`].filter(Boolean).join(' · ')
  if (event.event_type === 'CHECKPOINT') return [value('temperature') && `${value('temperature')} °C`, value('location'), value('note')].filter(Boolean).join(' · ')
  if (event.event_type === 'TRACKING_UPDATE') return [trackingStatusLabels[value('trackingStatus')] ?? value('trackingStatus'), value('location'), value('temperature') && `${value('temperature')} °C`, value('note')].filter(Boolean).join(' · ')
  if (event.event_type === 'CANCELLED') {
    const evidence = payload.evidence && typeof payload.evidence === 'object' ? payload.evidence as Record<string, unknown> : {}
    return evidence.cancellationReason ? `Lý do: ${String(evidence.cancellationReason)}` : ''
  }
  if (event.event_type === 'DELIVERY_REPORTED' || event.event_type === 'DELIVERED') {
    const report = payload.deliveryReport && typeof payload.deliveryReport === 'object' ? payload.deliveryReport as Record<string, unknown> : {}
    return [report.recipientName && `Người nhận: ${String(report.recipientName)}`, report.receiptReference && `Phiếu: ${String(report.receiptReference)}`, report.note && `Ghi chú: ${String(report.note)}`].filter(Boolean).join(' · ')
  }
  return ''
}
function deliveryProofForEvent(event: TransportEvent) {
  const report = event.payload.deliveryReport
  return report && typeof report === 'object' && typeof (report as Record<string, unknown>).proofImageUrl === 'string'
    ? String((report as Record<string, unknown>).proofImageUrl)
    : ''
}
onMounted(() => {
  void load()
})
</script>

<template>
  <main class="transport-workspace-page" :class="{ 'transport-overview': overview }" :aria-busy="loading">
    <header v-if="overview" class="transport-banner">
      <h1>Chào {{ auth.fullName }}! <span aria-hidden="true">👋</span></h1>
      <p>Quản lý các chuyến vận chuyển, nhận hàng và theo dõi giao hàng an toàn, đúng thời gian.</p>
    </header>
    <PageHeader v-else title="Quản lý vận chuyển" description="Tiếp nhận yêu cầu, quản lý các chuyến hàng và cập nhật tiến trình vận chuyển.">
      <template #actions>
        <label class="search-box"><va-icon name="search" aria-hidden="true" /><input v-model="search" type="search" placeholder="Nhập mã chuyến, mã lô hoặc điểm giao nhận…" aria-label="Tìm chuyến vận chuyển" /></label>
      </template>
    </PageHeader>

    <div v-if="error" class="load-error">
      <va-alert color="danger" role="alert">{{ error }}</va-alert>
      <button class="transport-button" type="button" :disabled="loading || Boolean(busyId)" @click="load">Thử lại</button>
    </div>
    <va-alert v-if="notice" color="success" class="message" role="status">{{ notice }}</va-alert>

    <section class="summary-grid" aria-label="Tổng quan vận chuyển">
      <article v-for="stat in stats" :key="stat.label" class="summary-card" :data-tone="stat.tone">
        <span class="summary-icon"><va-icon :name="stat.icon" aria-hidden="true" /></span>
        <span class="summary-label">{{ stat.label }}</span>
        <strong v-if="loadedJobs">{{ stat.value }}</strong>
        <span v-else-if="loading" class="transport-skeleton stat-skeleton" aria-hidden="true"></span>
        <strong v-else>—</strong>
        <small>{{ stat.hint }}</small>
      </article>
    </section>

    <div class="transport-columns">
      <section class="dispatch-board" aria-labelledby="transport-list-title">
        <div class="board-heading">
          <h2 id="transport-list-title" tabindex="-1"><va-icon name="local_shipping" aria-hidden="true" /> {{ overview ? 'Chuyến vận chuyển' : 'Danh sách chuyến vận chuyển' }}</h2>
          <router-link v-if="overview" class="transport-button primary" :to="{ name: 'transports' }"><va-icon name="add" aria-hidden="true" /> Nhận chuyến</router-link>
          <button v-else type="button" class="transport-button" :disabled="loading || Boolean(busyId)" @click="load"><va-icon name="refresh" aria-hidden="true" /> Làm mới</button>
        </div>

        <div class="board-tabs" role="group" aria-label="Lọc chuyến vận chuyển">
          <button v-for="tab in tabs" :key="tab.id" type="button" :aria-pressed="selectedView === tab.id" :class="{ selected: selectedView === tab.id }" @click="selectedView = tab.id">
            {{ tab.label }} <span v-if="loadedJobs">{{ groups[tab.id].length }}</span>
          </button>
        </div>

        <div v-if="loading && !loadedJobs" class="job-grid" role="status" aria-label="Đang tải chuyến vận chuyển">
          <div v-for="index in 3" :key="index" class="job-card skeleton-card" aria-hidden="true"><span class="transport-skeleton"></span><span class="transport-skeleton"></span></div>
        </div>
        <div v-else-if="visibleJobs.length" class="job-grid">
          <article v-for="job in visibleJobs" :key="job.id" class="job-card" :class="{ 'compact-job': overview }">
            <div class="job-topline">
              <div class="job-code">
                <span class="truck-icon" :class="stage(job)"><va-icon :name="stage(job) === 'delivered' ? 'task_alt' : stage(job) === 'available' ? 'assignment' : 'local_shipping'" aria-hidden="true" /></span>
                <div><strong :title="job.transport_code">{{ job.transport_code }}</strong>
                  <template v-if="overview">
                    <span>{{ job.from_location }} → {{ job.to_location }}</span>
                    <small>Lô {{ job.lot?.lot_code ?? '—' }} · {{ Number(job.quantity).toLocaleString('vi-VN') }} kg</small>
                  </template>
                </div>
              </div>
              <span v-if="!overview" class="status-pill" :class="stage(job)">{{ statusLabels[stage(job)] }}</span>
            </div>
            <template v-if="!overview">
              <div class="route-line">
                <div class="route-point"><span class="route-dot"></span><div><small>Điểm lấy hàng</small><strong>{{ job.from_location }}</strong></div></div>
                <div class="route-connector" aria-hidden="true"><span>→</span></div>
                <div class="route-point"><span class="route-dot destination-dot"></span><div><small>Điểm giao hàng</small><strong>{{ job.to_location }}</strong></div></div>
              </div>
              <div class="cargo-strip">Lô {{ job.lot?.lot_code ?? '—' }} · {{ Number(job.quantity).toLocaleString('vi-VN') }} kg</div>
            </template>
            <TransportProgress v-if="overview || selectedView === 'active'" :job="job" />
            <div class="row-meta">
              <span v-if="overview" class="status-pill" :class="stage(job)">{{ statusLabels[stage(job)] }}</span>
              <small v-if="rowTime(job)">{{ rowTimeLabel(job) }} · <time>{{ formatDate(rowTime(job)!) }}</time></small>
            </div>
            <div class="row-actions">
              <button v-if="!overview && pendingLabels[stage(job)]" type="button" class="transport-button primary" :disabled="Boolean(busyId)" @click="openDetail(job, $event)">{{ pendingLabels[stage(job)] }}</button>
              <button type="button" class="transport-button" :class="{ 'icon-action': overview }" :aria-label="`Xem chi tiết ${job.transport_code}`" @click="openDetail(job, $event)">
                <va-icon v-if="overview" name="more_horiz" aria-hidden="true" /><template v-else>Xem chi tiết</template>
              </button>
            </div>
          </article>
        </div>
        <EmptyState
          v-else-if="loadedJobs"
          heading="h3" icon="local_shipping"
          :title="search.trim() ? 'Không tìm thấy chuyến phù hợp' : emptyTitles[selectedView] ?? 'Chưa có chuyến vận chuyển nào trong danh sách.'"
          :description="search.trim() ? 'Thử tìm theo mã chuyến, mã lô hoặc điểm giao nhận.' : undefined"
        />
        <footer v-if="overview || loadedJobs" class="board-footer">
          <router-link v-if="overview" :to="{ name: 'transports' }">Xem tất cả chuyến vận chuyển <va-icon name="arrow_forward" aria-hidden="true" /></router-link>
          <template v-else>Hiển thị {{ visibleJobs.length }} / {{ groups[selectedView as Group].length }} chuyến</template>
        </footer>
      </section>

      <aside v-if="overview" class="transport-aside" aria-label="Tình hình vận chuyển">
        <section class="side-panel">
          <h2><va-icon name="assignment" aria-hidden="true" /> Tiến độ giao hàng</h2>
          <template v-if="loadedJobs">
            <div class="delivery-progress">
              <div class="delivery-ring">
                <svg viewBox="0 0 110 110" aria-hidden="true">
                  <circle cx="55" cy="55" r="47" pathLength="100" />
                  <circle v-if="progressPercent" class="ring-fill" cx="55" cy="55" r="47" pathLength="100" :stroke-dasharray="`${progressPercent} 100`" />
                </svg>
                <div><strong>{{ groups.delivered.length }}/{{ progressTotal }}</strong><small>chuyến</small></div>
              </div>
              <ul class="progress-legend">
                <li v-for="item in ['delivered', 'moving', 'reported', 'planning', 'available'] as const" :key="item"><span class="legend-dot" :class="item"></span>{{ statusLabels[item] }} <strong>{{ groups[item].length }}</strong></li>
              </ul>
            </div>
            <p class="panel-scope">Phạm vi danh sách đang tải, trừ chuyến đã hủy.</p>
          </template>
          <span v-else-if="loading" class="transport-skeleton side-skeleton" aria-hidden="true"></span>
          <p v-else class="panel-empty">Chưa tải được tiến độ.</p>
        </section>
        <section class="side-panel">
          <h2><va-icon name="fact_check" aria-hidden="true" /> Việc cần xử lý <span v-if="loadedJobs">({{ pending.length }})</span></h2>
          <ul v-if="pending.length" class="task-list">
            <li v-for="job in pending.slice(0, 3)" :key="job.id">
              <span class="mini-icon"><va-icon name="inventory_2" aria-hidden="true" /></span>
              <div><strong>{{ pendingLabels[stage(job)] }} · {{ job.transport_code }}</strong><small>{{ job.from_location }} → {{ job.to_location }} · {{ Number(job.quantity).toLocaleString('vi-VN') }} kg</small></div>
              <button type="button" class="transport-button" :aria-label="`Xử lý chuyến ${job.transport_code}`" @click="openDetail(job, $event)">Xử lý</button>
            </li>
          </ul>
          <span v-else-if="loading" class="transport-skeleton side-skeleton" aria-hidden="true"></span>
          <p v-else-if="loadedJobs" class="panel-empty">Hiện chưa có việc cần xử lý.</p>
          <p v-else class="panel-empty">Chưa tải được công việc.</p>
        </section>
        <section class="side-panel">
          <h2><va-icon name="history" aria-hidden="true" /> Hoạt động gần đây</h2>
          <ol v-if="recent.length" class="activity-list">
            <li v-for="{ event, job } in recent" :key="event.id">
              <span class="mini-icon"><va-icon :name="event.event_type === 'DELIVERED' ? 'task_alt' : 'history'" aria-hidden="true" /></span>
              <button type="button" :aria-label="`Xem chi tiết ${job.transport_code}`" @click="openDetail(job, $event)">{{ eventLabels[event.event_type] ?? event.event_type }} <strong>{{ job.transport_code }}</strong></button>
              <time :datetime="event.occurred_at">{{ formatDate(event.occurred_at) }}</time>
            </li>
          </ol>
          <span v-else-if="loading" class="transport-skeleton side-skeleton" aria-hidden="true"></span>
          <p v-else-if="loadedJobs" class="panel-empty">Chưa ghi nhận hoạt động nào.</p>
          <p v-else class="panel-empty">Chưa tải được hoạt động.</p>
        </section>
      </aside>
    </div>
    <p v-if="loadedJobs" class="page-scope">Dữ liệu gồm tối đa 100 yêu cầu chờ nhận và 100 chuyến được giao cho bạn.</p>

    <dialog ref="dialog" class="transport-dialog" aria-labelledby="transport-detail-title" @close="closeDetail" @cancel.prevent="requestCloseDetail" @click="dismissOnBackdrop($event, requestCloseDetail)">
      <div v-if="selectedJob" class="detail-content">
        <template v-for="job in [selectedJob]" :key="job.id">
          <header class="detail-heading">
            <div><small>Chi tiết chuyến vận chuyển</small><h2 id="transport-detail-title">{{ job.transport_code }}</h2></div>
            <button type="button" class="transport-button icon-action" aria-label="Đóng chi tiết" autofocus @click="requestCloseDetail"><va-icon name="close" aria-hidden="true" /></button>
          </header>
          <va-alert v-if="actionError || error" color="danger" class="message" role="alert">{{ actionError || error }}</va-alert>
          <va-alert v-if="notice" color="success" class="message" role="status">{{ notice }}</va-alert>
          <span class="status-pill" :class="stage(job)">{{ statusLabels[stage(job)] }}</span>
          <dl class="detail-facts">
            <div><dt>Điểm lấy hàng</dt><dd>{{ job.from_location }}</dd></div>
            <div><dt>Điểm giao hàng</dt><dd>{{ job.to_location }}</dd></div>
            <div><dt>Mã lô</dt><dd>{{ job.lot?.lot_code ?? '—' }}</dd></div>
            <div><dt>Khối lượng</dt><dd>{{ Number(job.quantity).toLocaleString('vi-VN') }} kg</dd></div>
            <div v-if="job.lot"><dt>Nguồn gốc</dt><dd>{{ job.lot.provenance.farm.name }} · {{ job.lot.provenance.pond.name }}</dd></div>
            <div v-if="job.claimed_at"><dt>Nhận chuyến</dt><dd>{{ formatDate(job.claimed_at) }}</dd></div>
            <div v-if="eventTime(job, 'DELIVERED')"><dt>Bàn giao</dt><dd>{{ formatDate(eventTime(job, 'DELIVERED')!) }}</dd></div>
            <div v-if="job.vehicle"><dt>Phương tiện</dt><dd>{{ job.vehicle }}</dd></div>
            <div v-if="job.driver"><dt>Tài xế</dt><dd>{{ job.driver }}</dd></div>
            <div v-if="job.temperature !== null"><dt>Nhiệt độ</dt><dd>{{ job.temperature }} °C</dd></div>
          </dl>
          <TransportProgress :job="job" />
                      <p v-if="job.note" class="job-note">{{ job.note }}</p>

            <template v-if="stage(job) === 'available'">
              <div class="request-hint"><span>i</span><p>Nhận chuyến để bắt đầu theo dõi và cập nhật phương tiện, tài xế.</p></div>
              <va-button class="primary-action" :loading="busyId === job.id" :disabled="Boolean(busyId)" @click="claim(job)">Nhận chuyến <span aria-hidden="true">→</span></va-button>
            </template>

            <template v-else-if="job.status === 'PLANNING' || (job.status === 'IN_TRANSIT' && !job.delivery_reported_at)">
              <h3 class="job-section-title">Thao tác vận chuyển</h3>
              <div class="driver-form">
                <label>Phương tiện<input v-model="formFor(job).vehicle" maxlength="255" placeholder="VD: Xe tải lạnh · 51A-12345" /></label>
                <label>Tài xế<input v-model="formFor(job).driver" maxlength="255" placeholder="Tên người lái xe" /></label>
                <label>Nhiệt độ (°C)<input v-model="formFor(job).temperature" type="number" min="-100" max="100" step="0.01" placeholder="VD: 4" /></label>
              </div>
              <div v-if="job.status === 'IN_TRANSIT' && !job.delivery_reported_at" class="tracking-panel">
                <div class="tracking-panel-heading"><strong>Cập nhật hành trình</strong><small>Cập nhật trạng thái, địa điểm và điều kiện hàng hóa trong cùng một mốc.</small></div>
                <label>Trạng thái<select v-model="formFor(job).trackingStatus"><option v-for="item in trackingStatuses" :key="item.value" :value="item.value">{{ item.label }}</option></select></label>
                <label>Địa điểm hiện tại<input v-model="formFor(job).trackingLocation" maxlength="500" placeholder="VD: Bưu cục Quận 7, TP. Hồ Chí Minh" /></label>
                <label>Nhiệt độ (°C)<input v-model="formFor(job).trackingTemperature" type="number" min="-100" max="100" step="0.01" placeholder="Không bắt buộc" /></label>
                <label>Ghi chú<input v-model="formFor(job).trackingNote" maxlength="1000" placeholder="Thông tin thêm (không bắt buộc)" /></label>
                <div v-if="formFor(job).trackingStatus === 'DELIVERED_REPORTED'" class="delivery-proof-field">
                  <label>Ảnh bằng chứng giao hàng *<input type="file" accept="image/jpeg,image/png,image/webp" :disabled="Boolean(busyId)" @change="uploadDeliveryProof($event, job)" /></label>
                  <small>JPG, PNG hoặc WebP · tối đa 10 MB. Cần tải ảnh trước khi báo giao thành công.</small>
                  <img v-if="formFor(job).deliveryProofUrl" class="delivery-proof-preview" :src="formFor(job).deliveryProofUrl" alt="Ảnh bằng chứng giao hàng đã tải lên" />
                  <a v-if="formFor(job).deliveryProofUrl" :href="formFor(job).deliveryProofUrl" target="_blank" rel="noopener noreferrer">Xem ảnh đã tải lên</a>
                </div>
                <va-button preset="secondary" :loading="busyId === job.id" :disabled="Boolean(busyId)" @click="recordTrackingUpdate(job)">Lưu cập nhật hành trình</va-button>
              </div>
              <div class="job-actions">
                <va-button v-if="job.status === 'PLANNING'" class="primary-action" :loading="busyId === job.id" :disabled="Boolean(busyId)" @click="update(job, 'IN_TRANSIT')">Bắt đầu vận chuyển <span aria-hidden="true">→</span></va-button>

              </div>
              <details v-if="!job.delivery_reported_at" class="cancellation-panel">
                <summary>Hủy chuyến vận chuyển</summary>
                <p>Chỉ hủy khi chuyến không thể tiếp tục. Vui lòng nêu rõ lý do.</p>
              <label class="cancel-field">Lý do hủy chuyến<input v-model="formFor(job).cancellationReason" minlength="3" maxlength="1000" placeholder="Bắt buộc khi chọn hủy chuyến" /></label>
                <button v-if="!job.delivery_reported_at" class="cancel-action" :disabled="Boolean(busyId)" @click="update(job, 'CANCELLED')">Hủy chuyến</button>
              </details>
            </template>
            <div v-else-if="job.delivery_reported_at && job.status === 'IN_TRANSIT'" class="completed-note awaiting-confirmation"><span>…</span>Người vận chuyển đã báo giao thành công. Đang chờ nhà phân phối xác nhận đã nhận hàng.</div>
            <ReceiptSummary v-else-if="job.status === 'DELIVERED' || job.status === 'REJECTED'" :trip="job" />
            <div v-else class="completed-note">Chuyến vận chuyển đã được hủy.</div>
            <details v-if="job.events?.length" open class="event-disclosure">
              <summary>Lịch sử sự kiện <span>{{ job.events.length }} mốc</span></summary>
              <ol class="event-list">
                <li v-for="event in job.events" :key="event.id" class="event-row">
                  <div class="event-heading"><strong>{{ eventLabels[event.event_type] || event.event_type }}</strong><time>{{ formatDate(event.occurred_at) }}</time></div>
                  <small v-if="eventSummary(event)" class="event-summary">{{ eventSummary(event) }}</small>
                  <div class="proof-line"><span class="proof-dot" :class="event.blockchain_status.toLowerCase()"></span>{{ proofLabel(event.blockchain_status) }} · {{ event.event_id }}</div>
                  <small v-if="event.last_error && event.blockchain_status === 'FAILED'" class="event-error">{{ event.last_error }}</small>
                  <a v-if="deliveryProofForEvent(event)" class="delivery-proof-link" :href="deliveryProofForEvent(event)" target="_blank" rel="noopener noreferrer">Xem ảnh bằng chứng giao hàng</a>
                  <img v-if="deliveryProofForEvent(event)" class="delivery-proof-preview" :src="deliveryProofForEvent(event)" alt="Ảnh bằng chứng giao hàng" loading="lazy" />
                </li>
              </ol>
            </details>

        </template>
      </div>
    </dialog>
  </main>
</template>

<style scoped>
.driver-form { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:.7rem; margin-top:.9rem; }
.driver-form label,.cancel-field,.tracking-panel>label,.delivery-proof-field label { display:grid; min-width:0; gap:.35rem; color:#526d70; font-size:13px; font-weight:500; line-height:1.6; }
.driver-form input,.cancel-field input,.tracking-panel input,.tracking-panel select,.delivery-proof-field input { box-sizing:border-box; width:100%; min-width:0; min-height:44px; padding:8px 12px; border:1px solid var(--app-control-line); border-radius:8px; outline:none; color:#244449; background:#fff; font:inherit; font-size:14px; font-weight:400; }
.driver-form input::placeholder,.cancel-field input::placeholder,.tracking-panel input::placeholder { color:var(--app-muted); }
.driver-form input:focus,.cancel-field input:focus,.tracking-panel input:focus,.tracking-panel select:focus,.delivery-proof-field input:focus { border-color:#63aaa1; box-shadow:0 0 0 3px #0f766e14; }
.cancel-field { margin-top:.75rem; }
.job-actions { gap:.6rem; margin-top:.75rem; }
.job-actions .primary-action { flex:1 1 auto; width:auto; min-width:0; }
.cancel-action { flex:none; min-height:40px; padding:0 .85rem; border:1px solid #edcfca; border-radius:9px; color:#a34c45; background:#fff; font:inherit; font-size:.75rem; font-weight:700; cursor:pointer; }
.cancel-action:hover:not(:disabled) { border-color:#dca9a2; background:#fff6f4; }
.cancel-action:disabled { opacity:.55; cursor:wait; }
.tracking-panel { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:.75rem; margin-top:.85rem; padding:.9rem; border:1px solid #e3eeeb; border-radius:11px; background:var(--app-canvas); }
.tracking-panel-heading { display:grid; grid-column:1/-1; gap:.2rem; }
.tracking-panel-heading strong { color:#31575a; font-size:.82rem; }
.tracking-panel-heading small,.delivery-proof-field small { color:var(--app-muted); font-size:.68rem; line-height:1.45; }
.tracking-panel :deep(.va-button) { grid-column:1/-1; justify-self:start; }
.delivery-proof-field { padding:.75rem; border:1px dashed #bdd6d0; border-radius:9px; background:#fff; }
.delivery-proof-field input { height:auto; padding:.5rem; }
.request-hint { display:flex; align-items:center; gap:.55rem; margin:.8rem 0 .65rem; color:var(--app-muted); }.request-hint span { display:grid; place-items:center; flex:none; width:18px; height:18px; border:1px solid #b6cbc6; border-radius:50%; font-size:.65rem; font-weight:800; }.request-hint p { margin:0; font-size:.72rem; line-height:1.45; }.primary-action { min-height:40px; display:flex; justify-content:space-between; width:100%; padding:0 .85rem; border:0; border-radius:9px; color:#fff; background:#107c70; font:inherit; font-size:.79rem; font-weight:750; cursor:pointer; }.primary-action:hover { background:#0b695f; }.primary-action:disabled { opacity:.65; cursor:wait; }.delivered-action { background:#16845d; }.delivered-action:hover { background:#116e4d; }
.delivery-proof-field { padding:.75rem; border:1px dashed #bdd6d0; border-radius:9px; background:#fff; }
.delivery-proof-field input { height:auto; padding:.5rem; }
.request-hint { display:flex; align-items:center; gap:.55rem; margin:.8rem 0 .65rem; color:var(--app-muted); }.request-hint span { display:grid; place-items:center; flex:none; width:18px; height:18px; border:1px solid #b6cbc6; border-radius:50%; font-size:.65rem; font-weight:800; }.request-hint p { margin:0; font-size:.72rem; line-height:1.45; }.primary-action { min-height:40px; display:flex; justify-content:space-between; width:100%; padding:0 .85rem; border:0; border-radius:9px; color:#fff; background:#107c70; font:inherit; font-size:.79rem; font-weight:750; cursor:pointer; }.primary-action:hover { background:#0b695f; }.primary-action:disabled { opacity:.65; cursor:wait; }.delivered-action { background:#16845d; }.delivered-action:hover { background:#116e4d; }
.journey-progress { display:flex; align-items:center; margin:.9rem 0 .8rem; }.progress-step { display:grid; justify-items:center; gap:.25rem; color:var(--app-muted); }.progress-step span { display:grid; place-items:center; width:22px; height:22px; border:1px solid #d7e2e0; border-radius:50%; background:#fff; font-size:.65rem; font-weight:800; }.progress-step small { font-size:12px; text-align:center; max-width:76px; line-height:1.5; }.progress-step.done { color:var(--app-primary-dark); }.progress-step.done span { border-color:#168779; color:#fff; background:var(--app-primary); }.progress-track { flex:1; height:2px; margin:-1rem .35rem 0; background:#dce7e5; }.progress-track.reached { background:var(--app-primary); }
.delivery-proof-field { display:grid; grid-column:1/-1; gap:.35rem; color:#627a7e; font-size:.67rem; }.delivery-proof-field label { display:grid; gap:.4rem; }.delivery-proof-field input { height:auto; padding:.4rem; }.delivery-proof-field small { color:var(--app-muted); }.delivery-proof-preview { display:block; width:min(100%,260px); max-height:180px; border:1px solid #dce7e5; border-radius:8px; object-fit:cover; }.delivery-proof-link { display:block; margin-top:.4rem; color:#107c70; font-size:.68rem; }
.completed-note { display:flex; align-items:center; gap:.55rem; margin-top:.8rem; padding:.65rem .75rem; border-radius:8px; color:#39765d; background:#eff8f2; font-size:.74rem; }.completed-note span { font-weight:900; }
.event-disclosure { margin-top:.8rem; border-top:1px solid #edf2f1; color:#3c5b5e; }.event-disclosure summary { display:flex; align-items:center; gap:.5rem; padding:.7rem 0 .2rem; color:#39766e; font-size:.72rem; font-weight:750; cursor:pointer; list-style-position:inside; }.event-disclosure summary span { padding:.12rem .45rem; border-radius:99px; color:#607b79; background:#eef5f3; font-size:.63rem; }.event-list { display:grid; gap:.7rem; margin:.5rem 0 0; padding:0 0 0 1.5rem; }.event-row { padding:.15rem 0 .45rem .2rem; color:var(--app-muted); font-size:.68rem; }.event-heading { display:flex; justify-content:space-between; gap:.5rem; }.event-heading strong { color:#365b5e; font-size:.7rem; }.event-heading time { color:var(--app-muted); font-size:.63rem; white-space:nowrap; }.event-summary { display:block; margin-top:.25rem; color:#536f70; font-size:.63rem; }.proof-line { display:flex; align-items:center; gap:.35rem; margin-top:.3rem; color:var(--app-muted); font-size:.62rem; overflow-wrap:anywhere; }.proof-dot { flex:none; width:7px; height:7px; border-radius:50%; background:#d9aa45; }.proof-dot.success { background:#278760; }.proof-dot.failed { background:#c65757; }.event-error { display:block; margin-top:.3rem; color:#a94e4e; font-size:.63rem; }

.transport-workspace-page {
  min-width: 0;
}
.transport-banner, .summary-card, .dispatch-board, .side-panel {
  min-width: 0;
  border: 1px solid var(--app-line);
  border-radius: var(--app-radius);
  background: white;
}
.transport-banner {
  min-height: 138px;
  display: grid;
  align-content: center;
  padding: 20px 26px;
  background: linear-gradient(90deg, #eff6fb 35%, #eaf4fad9 43%, transparent 64%),
    url('../../assets/transport-banner.png') right center / auto 100% no-repeat, #eaf4fa;
}
.transport-banner h1 { margin: 0 0 4px; color: #092f42; font-size: var(--app-text-title); letter-spacing: -.04em; overflow-wrap: anywhere; max-width: 46%; }
.transport-banner p { max-width: min(46%, 535px); margin: 0; color: #25495f; font-size: 15px; line-height: 1.55; }
.summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin: 14px 0; }
.summary-card { display: grid; grid-template-columns: auto minmax(0, 1fr); align-content: center; align-items: center; gap: 3px 17px; min-height: 124px; padding: 16px 20px; }
.summary-icon, .truck-icon, .mini-icon { display: grid; place-items: center; flex: none; color: var(--app-primary); background: var(--app-primary-soft); }
.summary-icon { width: 56px; height: 56px; grid-row: span 3; align-self: start; border-radius: 22px; font-size: 28px; }
.summary-label { font-weight: 650; }
.summary-card strong { font-size: 32px; font-variant-numeric: tabular-nums; line-height: 1.1; }
.summary-card small { justify-self: start; padding: 3px 10px; border-radius: 20px; color: var(--app-muted); background: #eff4f7; line-height: 1.4; }
[data-tone='blue'] :is(.summary-icon, small), .moving:is(.truck-icon, .status-pill) { background: var(--app-info-soft); color: var(--app-info); }
[data-tone='green'] :is(.summary-icon, small), .delivered:is(.truck-icon, .status-pill) { background: var(--app-success-soft); color: var(--app-success); }
[data-tone='amber'] .summary-icon, .task-list .mini-icon, :is(.available, .planning, .reported).status-pill { background: var(--app-warning-soft); color: var(--app-warning); }
.rejected.status-pill, .cancelled.status-pill { background: var(--app-danger-soft); color: var(--app-danger); }
.transport-overview .transport-columns { display: grid; grid-template-columns: minmax(0, 1.9fr) minmax(0, 1fr); align-items: start; gap: 14px; }
.transport-aside { display: grid; gap: 10px; min-width: 0; }
.dispatch-board { box-shadow: 0 14px 30px #18355008; }
.board-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; padding: 19px 23px 8px; }
.board-heading h2, .side-panel h2 { display: flex; align-items: center; gap: 10px; margin: 0; font-weight: 730; }
.board-heading h2 { font-size: var(--app-text-section); }
.board-heading h2 .va-icon, .side-panel h2 .va-icon { color: var(--app-primary); }
a.transport-button { text-decoration: none; }
.transport-button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: var(--app-control-height); padding: 7px 12px; border: 1px solid var(--app-line); border-radius: var(--app-control-radius); color: var(--app-primary-dark); background: var(--app-surface); font: inherit; font-weight: 680; cursor: pointer; text-align: center; }
.transport-button:hover { background: var(--app-primary-soft); }
.transport-button.primary { border-color: var(--app-primary); color: white; background: var(--app-primary); }
.transport-button.primary:hover { background: var(--app-primary-dark); }
.transport-button:disabled { opacity: .6; cursor: wait; }
.icon-action { flex: none; width: var(--app-control-height); padding: 0; color: var(--app-ink); border-radius: 50%; }
.transport-workspace-page :is(a, button, input, select, summary):focus-visible { outline: var(--app-focus-width) solid var(--app-primary); outline-offset: 2px; }
.board-tabs { display: flex; flex-wrap: wrap; gap: 6px 12px; padding: 0 20px; border-bottom: 1px solid var(--app-line); }
.board-tabs button { min-height: 46px; padding: 4px 8px; border: 0; border-bottom: 3px solid transparent; color: #34536b; background: transparent; font: inherit; font-weight: 600; cursor: pointer; }
.board-tabs button.selected { border-color: var(--app-primary); color: var(--app-primary); }
.board-tabs button span { font-variant-numeric: tabular-nums; margin-left: 3px; }
.search-box { display: flex; align-items: center; gap: 8px; width: min(370px, 75vw); min-height: 46px; border: 1px solid var(--app-control-line); border-radius: var(--app-control-radius); padding: 0 12px; color: var(--app-muted); background: white; }
.search-box input { min-width: 0; width: 100%; min-height: var(--app-control-height); border: 0; background: transparent; color: var(--app-ink); font: inherit; }
.job-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 430px), 1fr)); gap: 12px; padding: 13px; }
.transport-overview .job-grid { grid-template-columns: 1fr; }
.job-card { min-width: 0; display: grid; align-content: start; gap: 13px; padding: 16px; border: 1px solid var(--app-line); border-radius: var(--app-radius); overflow-wrap: anywhere; background: #fcfdff; }
.compact-job { min-height: 105px; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1.5fr) minmax(115px, .95fr) auto; align-content: center; align-items: center; gap: 12px; }
.job-topline, .job-code { display: flex; align-items: center; gap: 12px; min-width: 0; }
.job-topline { justify-content: space-between; flex-wrap: wrap; }
.job-code div { display: grid; min-width: 0; gap: 3px; }
.job-code strong { font-size: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.job-code small, .row-meta small { color: var(--app-muted); font-size: 12px; }
.truck-icon { width: 44px; height: 44px; border-radius: 14px; font-size: 23px; }
.status-pill { display: inline-flex; width: fit-content; max-width: 100%; padding: 5px 10px; border-radius: var(--app-pill-radius); font-size: var(--app-text-xs); font-weight: 700; line-height: 1.4; }
.row-meta { display: grid; gap: 6px; }
.row-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 7px; }
.route-line { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); gap: 12px; align-items: center; padding-block: 4px; }
.route-point { display: flex; align-items: center; gap: 8px; min-width: 0; }
.route-point div { display: grid; gap: 2px; }
.route-point small { color: var(--app-muted); }
.route-dot { flex: none; width: 9px; height: 9px; border-radius: 100%; background: var(--app-primary); }
.route-dot.destination-dot { background: #c48524; }
.route-connector { color: var(--app-primary); }
.cargo-strip { border-radius: 10px; padding: 9px 12px; color: #31536b; background: #edf4f8; }
.board-footer { padding: 11px 23px 19px; color: var(--app-muted); font-size: 13px; }
.board-footer a { display: inline-flex; align-items: center; gap: 6px; min-height: 38px; color: var(--app-primary); font-weight: 700; }
.side-panel { padding: 16px 18px; }
.side-panel h2 { margin-bottom: 10px; font-size: 16px; line-height: 1.4; }
.delivery-progress { display: grid; grid-template-columns: minmax(80px, 1fr) minmax(0, 1.25fr); align-items: center; gap: 12px; }
.delivery-ring { position: relative; width: min(100%, 116px); aspect-ratio: 1; justify-self: center; }
.delivery-ring svg { width: 100%; transform: rotate(-90deg); }
.delivery-ring circle { fill: none; stroke: #e4eef1; stroke-width: 11; }
.delivery-ring .ring-fill { stroke: #008a74; stroke-linecap: round; }
.delivery-ring div { position: absolute; inset: 0; display: grid; align-content: center; text-align: center; line-height: 1.15; }
.delivery-ring strong { font-size: 25px; }
.progress-legend, .task-list, .activity-list { display: grid; padding: 0; margin: 0; list-style: none; }
.progress-legend li { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 12px; border-bottom: 1px solid #e8eff3; }
.progress-legend strong { margin-left: auto; }
.legend-dot { flex: none; width: 9px; height: 9px; border-radius: 50%; background: #d39b26; }
.legend-dot.delivered { background: #008a74; }
.legend-dot.moving { background: #287ccb; }
.legend-dot.reported { background: #6973aa; }
.task-list li, .activity-list li { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 5px 0; overflow-wrap: anywhere; font-size: 12px; }
.task-list li + li { border-top: 1px solid #e8eff3; }
.task-list small, .activity-list time { display: block; color: var(--app-muted); font-size: 12px; }
.task-list .transport-button { min-height: 36px; background: var(--app-primary-soft); }
.mini-icon { width: 34px; height: 34px; border-radius: 11px; font-size: 17px; }
.activity-list li { position: relative; }
.activity-list li:not(:last-child)::before { position: absolute; top: 26px; bottom: -10px; left: 12px; width: 1px; background: var(--app-line); content: ''; }
.activity-list .mini-icon { z-index: 0; width: 25px; height: 25px; border-radius: 50%; font-size: 14px; }
.activity-list button { display: block; min-height: 36px; padding: 0; border: 0; color: var(--app-ink); background: transparent; text-align: left; font: inherit; cursor: pointer; }
.activity-list button:hover { text-decoration: underline; }
.activity-list time { max-width: 11ch; text-align: right; }
.panel-scope, .panel-empty, .page-scope { margin: 8px 0 0; color: var(--app-muted); font-size: 12px; }
.load-error { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin: 12px 0; }
.message { margin: 12px 0; }
.transport-skeleton { display: block; width: 100%; height: 16px; border-radius: 8px; background: #e7eff4; }
.stat-skeleton { width: min(46px, 100%); height: 32px; }
.side-skeleton { height: 68px; }
.skeleton-card { min-height: 105px; align-content: center; }
.skeleton-card span:first-child { width: 44%; }
.skeleton-card span:last-child { width: 78%; }
.transport-dialog { width: min(calc(100vw - 20px), 680px); max-height: calc(100dvh - 24px); margin: auto; padding: 0; border: 1px solid var(--app-line); border-radius: var(--app-radius); color: var(--app-ink); background: white; overflow: auto; overscroll-behavior: contain; }
.transport-dialog::backdrop { background: #062f397d; }
.detail-content { padding: clamp(14px, 4vw, 25px); overflow-wrap: anywhere; }
.detail-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
.detail-heading h2 { margin: 3px 0 0; font-size: var(--app-text-section); }
.detail-heading small, .detail-facts dt { color: var(--app-muted); }
.detail-facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; padding: 14px; margin: 12px 0 20px; border: 1px solid var(--app-line); border-radius: 12px; background: #f5f9fb; }
.detail-facts dd { margin: 2px 0 0; font-weight: 650; }
.job-actions, .cancellation-panel { margin-top: 12px; }
.job-section-title { margin: 20px 0 6px; font-size: 16px; }
.cancellation-panel summary { min-height: var(--app-control-height); padding: 12px 0; color: #a2383f; cursor: pointer; font-weight: 650; }
.cancel-action { min-height: var(--app-control-height); margin-top: 8px; padding: 0 12px; border: 1px solid #e7bdc0; border-radius: 8px; color: #973038; background: #fff0f1; cursor: pointer; }
.event-heading { flex-wrap: wrap; }
.event-heading :is(strong, time), .event-summary, .proof-line { font-size: 12px; }
@media (max-width: 1420px) {
  .compact-job { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; }
  .compact-job .journey-progress { grid-row: 2; grid-column: 1 / -1; }
}
@media (max-width: 1279px) {
  .transport-overview .transport-columns { grid-template-columns: 1fr; }
  .transport-aside { grid-template-columns: repeat(auto-fit, minmax(min(100%, 270px), 1fr)); }
  .compact-job { grid-template-columns: minmax(0, 1.2fr) minmax(0, 1.5fr) minmax(115px, .95fr) auto; }
  .compact-job .journey-progress { grid-row: auto; grid-column: auto; }
}
@media (max-width: 1000px) { .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 767px) {
  .transport-banner { padding: 16px; background: linear-gradient(100deg, #eaf4fa 32%, #eaf4faf0 66%, #eaf4fa65), url('../../assets/transport-banner.png') right center / auto 100% no-repeat, #eaf4fa; }
  .transport-banner h1 { max-width: 100%; }
  .transport-banner p { max-width: 87%; font-size: 14px; }
  .summary-grid { gap: 8px; }
  .summary-card { grid-template-columns: minmax(0, 1fr); min-height: 116px; padding: 10px 11px; gap: 5px; }
  .summary-icon { width: 34px; height: 34px; grid-row: auto; border-radius: 11px; font-size: 19px; }
  .summary-card strong { font-size: 24px; }
  .summary-card small { padding: 2px 6px; }
  .board-heading { padding: 12px 12px 4px; }
  .board-heading h2 { font-size: 17px; }
  .board-tabs { gap: 0 5px; padding-inline: 8px; }
  .board-tabs button { padding-inline: 6px; font-size: 13px; }
  .job-grid { padding: 8px; }
  .job-card { padding: 12px; }
  .compact-job { grid-template-columns: minmax(0, 1fr) auto; }
  .compact-job .job-topline, .compact-job .journey-progress { grid-column: 1 / -1; }
  .transport-workspace-page :is(input, select) { font-size: 16px; }
  .driver-form, .tracking-panel { grid-template-columns: 1fr; }
  .task-list .transport-button, .transport-button { min-height: var(--app-control-height); }
  .icon-action { width: 44px; }
}
</style>
