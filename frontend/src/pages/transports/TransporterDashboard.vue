<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { VaAlert, VaBadge, VaButton, VaCard, VaCardContent, VaIcon, VaInnerLoading } from 'vuestic-ui'
import { api } from '../../api/client'
import type { LotTransport, Species, TransportEvent } from '../../types'

interface TransportJob extends LotTransport {
  lot: {
    id: string
    lot_code: string
    quantity: number
    provenance: {
      farm: { name: string; address?: string | null }
      pond: { code: string; name: string }
      batch: { batch_code: string; species: Species }
    }
  }
}
const available = ref<TransportJob[]>([])
const assigned = ref<TransportJob[]>([])
const loading = ref(false)
const busyId = ref<string | null>(null)
const error = ref('')
const notice = ref('')
const details = ref<Record<string, {
  vehicle: string; driver: string; temperature: string | number
  cancellationReason: string
  trackingStatus: string; trackingLocation: string; trackingTemperature: string | number; trackingNote: string
}>>({})
const selectedView = ref<'available' | 'active' | 'history'>('available')
const search = ref('')
let refreshTimer: number | undefined
const labels: Record<string, string> = { PLANNING: 'Chờ nhận chuyến', IN_TRANSIT: 'Đang vận chuyển', DELIVERED: 'Đã giao', CANCELLED: 'Đã hủy' }
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
const eventLabels: Record<string, string> = { REQUESTED: 'Tạo yêu cầu', CLAIMED: 'Người vận chuyển nhận chuyến', IN_TRANSIT: 'Bắt đầu vận chuyển', CHECKPOINT: 'Điểm kiểm tra', DELIVERY_REPORTED: 'Báo đã giao', RECIPIENT_ASSIGNED: 'Gán nhà phân phối nhận', TRACKING_UPDATE: 'Cập nhật hành trình', DELIVERED: 'Nhà phân phối xác nhận đã nhận', CANCELLED: 'Hủy chuyến' }
const activeCount = computed(() => assigned.value.filter((job) => ['PLANNING', 'IN_TRANSIT'].includes(job.status)).length)
const deliveredCount = computed(() => assigned.value.filter((job) => job.status === 'DELIVERED').length)
const visibleJobs = computed(() => {
  const source = selectedView.value === 'available' ? available.value
    : selectedView.value === 'active' ? assigned.value.filter((job) => ['PLANNING', 'IN_TRANSIT'].includes(job.status))
      : assigned.value.filter((job) => ['DELIVERED', 'CANCELLED'].includes(job.status))
  const query = search.value.trim().toLocaleLowerCase('vi-VN')
  if (!query) return source
  return source.filter((job) => [job.transport_code, job.from_location, job.to_location, job.lot.lot_code,
    job.lot.provenance.farm.name, job.lot.provenance.batch.batch_code].some((value) => String(value).toLocaleLowerCase('vi-VN').includes(query)))
})

function formFor(job: TransportJob) {
  details.value[job.id] ??= {
    vehicle: job.vehicle ?? '', driver: job.driver ?? '', temperature: job.temperature ?? '',
    cancellationReason: '',
    trackingStatus: 'IN_TRANSIT', trackingLocation: '', trackingTemperature: '', trackingNote: '',
  }
  return details.value[job.id]!
}
function validText(value: string, label: string, min: number, max: number) {
  const normalized = value.trim()
  if (normalized.length < min) { error.value = `${label} cần ít nhất ${min} ký tự.`; return false }
  if (normalized.length > max) { error.value = `${label} không được vượt quá ${max} ký tự.`; return false }
  return true
}
function validTemperature(value: string | number) {
  if (value === '') return true
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < -100 || parsed > 100 || Math.abs(parsed * 100 - Math.round(parsed * 100)) > 0.001) {
    error.value = 'Nhiệt độ phải từ -100 đến 100 °C, tối đa 2 chữ số thập phân.'
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
  } catch (e) { error.value = e instanceof Error ? e.message : 'Không tải được danh sách chuyến' }
  finally { loading.value = false }
}
async function claim(job: TransportJob) {
  busyId.value = job.id; error.value = ''; notice.value = ''
  try { await api.post(`/transports/${job.id}/claim`); notice.value = `Đã nhận chuyến ${job.transport_code}.`; await load() }
  catch (e) { error.value = e instanceof Error ? e.message : 'Không nhận được chuyến' }
  finally { busyId.value = null }
}
async function update(job: TransportJob, status: LotTransport['status']) {
  error.value = ''; notice.value = ''
  const form = formFor(job)
  if (status === 'IN_TRANSIT' && (!validText(form.vehicle, 'Phương tiện', 1, 255) || !validText(form.driver, 'Tài xế', 1, 255))) return
  if (status === 'CANCELLED' && !validText(form.cancellationReason, 'Lý do hủy', 3, 1000)) return
  if (!validTemperature(form.temperature)) return
  busyId.value = job.id
  try {
    await api.patch(`/transports/${job.id}/status`, {
      status, vehicle: form.vehicle, driver: form.driver,
      temperature: form.temperature === '' ? null : Number(form.temperature),
      cancellationReason: form.cancellationReason,
    })
    notice.value = status === 'IN_TRANSIT' ? `Đã bắt đầu vận chuyển ${job.transport_code}.` : `Đã hủy chuyến ${job.transport_code}.`
    await load()
  } catch (e) { error.value = e instanceof Error ? e.message : 'Không cập nhật được chuyến' }
  finally { busyId.value = null }
}
async function recordTrackingUpdate(job: TransportJob) {
  error.value = ''; notice.value = ''
  const form = formFor(job)
  if (!validText(form.trackingLocation, 'Địa điểm cập nhật', 2, 500)) return
  if (!validTemperature(form.trackingTemperature)) return
  if (form.trackingNote.trim() && !validText(form.trackingNote, 'Ghi chú cập nhật', 1, 1000)) return
  if (form.trackingStatus === 'OTHER' && !validText(form.trackingNote, 'Ghi chú khi chọn cập nhật khác', 2, 1000)) return
  busyId.value = job.id
  try {
    await api.post(`/transports/${job.id}/tracking-updates`, {
      trackingStatus: form.trackingStatus, location: form.trackingLocation,
      temperature: form.trackingTemperature === '' ? null : Number(form.trackingTemperature), note: form.trackingNote,
    })
    notice.value = form.trackingStatus === 'DELIVERED_REPORTED'
      ? `Đã báo giao thành công chuyến ${job.transport_code}. Đang chờ nhà phân phối xác nhận.`
      : `Đã cập nhật hành trình chuyến ${job.transport_code}.`
    form.trackingTemperature = ''
    form.trackingNote = ''
    await load()
  } catch (e) { error.value = e instanceof Error ? e.message : 'Không cập nhật được hành trình' }
  finally { busyId.value = null }
}
function location(job: TransportJob) { return `${job.lot.provenance.farm.name} · ${job.lot.provenance.pond.name} · ${job.lot.provenance.batch.batch_code}` }
function formatDate(value: string) { return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) }
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
function latestTracking(job: TransportJob) {
  return [...(job.events ?? [])].reverse().find((event) => event.event_type === 'TRACKING_UPDATE') ?? null
}
onMounted(() => { void load(); refreshTimer = window.setInterval(() => { if (!loading.value) void load() }, 20000) })
onUnmounted(() => { if (refreshTimer) window.clearInterval(refreshTimer) })
</script>

<template>
  <main class="transport-page">
    <section class="welcome-panel">
      <div class="welcome-copy">
        <div class="welcome-kicker"><span class="live-dot"></span> KHÔNG GIAN LÀM VIỆC · NGƯỜI VẬN CHUYỂN</div>
        <h1>Điều phối vận chuyển</h1>
        <p>Nhận chuyến, cập nhật tiến độ và báo giao lô hàng cho nhà phân phối.</p>
      </div>
      <div class="welcome-actions">
        <div class="today-label">HÔM NAY</div>
        <div class="today-date">{{ new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()) }}</div>
        <va-button preset="secondary" icon="refresh" :loading="loading" @click="load">Làm mới dữ liệu</va-button>
      </div>
    </section>

    <va-alert v-if="error" color="danger" class="message">{{ error }}</va-alert>
    <va-alert v-if="notice" color="success" class="message">{{ notice }}</va-alert>

    <section class="summary-grid" aria-label="Tổng quan vận chuyển">
      <article class="summary-card new-summary"><span class="summary-icon"><va-icon name="add_task" /></span><span class="summary-label">Yêu cầu mới</span><strong>{{ available.length }}</strong><small>Đang chờ người nhận</small></article>
      <article class="summary-card active-summary"><span class="summary-icon"><va-icon name="local_shipping" /></span><span class="summary-label">Đang xử lý</span><strong>{{ activeCount }}</strong><small>Chuyến bạn đã nhận</small></article>
      <article class="summary-card done-summary"><span class="summary-icon"><va-icon name="task_alt" /></span><span class="summary-label">Đã giao</span><strong>{{ deliveredCount }}</strong><small>Hoàn tất bàn giao</small></article>
      <article class="summary-card total-summary"><span class="summary-icon"><va-icon name="inventory_2" /></span><span class="summary-label">Tổng chuyến của tôi</span><strong>{{ assigned.length }}</strong><small>Tính từ trước đến nay</small></article>
    </section>

    <section class="dispatch-board">
      <div class="board-heading">
        <div><p class="eyebrow">BẢNG CÔNG VIỆC</p><h2>Quản lý chuyến hàng</h2><p class="board-description">Chọn một yêu cầu để nhận, hoặc mở chuyến đang chạy để cập nhật tiến độ.</p></div>
        <label class="search-box"><span aria-hidden="true">⌕</span><input v-model="search" type="search" placeholder="Tìm mã chuyến, lô hàng, tuyến đường…" aria-label="Tìm chuyến vận chuyển" /></label>
      </div>

      <div class="board-tabs" role="tablist" aria-label="Lọc chuyến vận chuyển">
        <button role="tab" :aria-selected="selectedView === 'available'" :class="{ selected: selectedView === 'available' }" @click="selectedView = 'available'">Yêu cầu mới <span>{{ available.length }}</span></button>
        <button role="tab" :aria-selected="selectedView === 'active'" :class="{ selected: selectedView === 'active' }" @click="selectedView = 'active'">Đang xử lý <span>{{ activeCount }}</span></button>
        <button role="tab" :aria-selected="selectedView === 'history'" :class="{ selected: selectedView === 'history' }" @click="selectedView = 'history'">Lịch sử <span>{{ assigned.length - activeCount }}</span></button>
      </div>

      <va-inner-loading :loading="loading">
        <div v-if="visibleJobs.length" class="job-grid">
          <article v-for="job in visibleJobs" :key="job.id" class="job-card" :class="{ 'request-card': selectedView === 'available' }">
            <div class="job-topline"><div class="job-code"><span class="truck-icon"><va-icon name="local_shipping" /></span><div><small>MÃ CHUYẾN</small><strong>{{ job.transport_code }}</strong></div></div>
              <span class="status-pill" :class="job.status.toLowerCase()"><i></i>{{ labels[job.status] }}</span>
            </div>
            <div class="route-line">
              <div class="route-point"><span class="route-dot origin-dot"></span><div><small>ĐIỂM LẤY HÀNG</small><strong>{{ job.from_location }}</strong></div></div>
              <div class="route-connector"><span>{{ Number(job.quantity).toLocaleString('vi-VN') }} kg</span></div>
              <div class="route-point"><span class="route-dot destination-dot"></span><div><small>ĐIỂM GIAO HÀNG</small><strong>{{ job.to_location }}</strong></div></div>
            </div>
            <div class="cargo-strip"><div class="cargo-icon"><va-icon name="inventory_2" /></div><div class="cargo-copy"><strong>{{ job.lot.lot_code }} <span>·</span> {{ job.lot.provenance.batch.batch_code }}</strong><small>{{ job.lot.provenance.farm.name }} · {{ job.lot.provenance.pond.name }}</small></div><time>{{ formatDate(job.transport_date) }}</time></div>
            <div v-if="latestTracking(job)" class="latest-tracking">
              <span class="tracking-pulse"></span>
              <div><small>CẬP NHẬT HÀNH TRÌNH MỚI NHẤT</small><strong>{{ trackingStatusLabels[String(latestTracking(job)?.payload.trackingStatus)] || String(latestTracking(job)?.payload.trackingStatus) }}</strong><span>{{ String(latestTracking(job)?.payload.location ?? '') }}</span></div>
              <time>{{ formatDate(latestTracking(job)!.occurred_at) }}</time>
            </div>
            <p v-if="job.note" class="job-note">{{ job.note }}</p>

            <template v-if="selectedView === 'available'">
              <div class="request-hint"><span>i</span><p>Nhận chuyến để bắt đầu theo dõi và cập nhật phương tiện, tài xế.</p></div>
              <va-button class="primary-action" :loading="busyId === job.id" :disabled="Boolean(busyId)" @click="claim(job)">Nhận chuyến <span aria-hidden="true">→</span></va-button>
            </template>

            <template v-else-if="job.status === 'PLANNING' || (job.status === 'IN_TRANSIT' && !job.delivery_reported_at)">
              <div class="journey-progress" aria-label="Tiến trình chuyến hàng">
                <div class="progress-step done"><span>✓</span><small>Đã nhận</small></div><div class="progress-track" :class="{ reached: job.status === 'IN_TRANSIT' }"></div>
                <div class="progress-step" :class="{ done: job.status === 'IN_TRANSIT' }"><span>{{ job.status === 'IN_TRANSIT' ? '✓' : '2' }}</span><small>Đang đi</small></div><div class="progress-track"></div>
                <div class="progress-step"><span>3</span><small>Đã giao</small></div>
              </div>
              <div class="driver-form">
                <label>Phương tiện<input v-model="formFor(job).vehicle" maxlength="255" placeholder="VD: Xe tải lạnh · 51A-12345" /></label>
                <label>Tài xế<input v-model="formFor(job).driver" maxlength="255" placeholder="Tên người lái xe" /></label>
                <label>Nhiệt độ (°C)<input v-model="formFor(job).temperature" type="number" min="-100" max="100" step="0.01" placeholder="VD: 4" /></label>
              </div>
              <label class="cancel-field">Lý do hủy chuyến<input v-model="formFor(job).cancellationReason" minlength="3" maxlength="1000" placeholder="Bắt buộc khi chọn hủy chuyến" /></label>
              <div v-if="job.status === 'IN_TRANSIT' && !job.delivery_reported_at" class="tracking-panel">
                <div class="tracking-panel-heading"><strong>Cập nhật hành trình</strong><small>Cập nhật trạng thái, địa điểm và điều kiện hàng hóa trong cùng một mốc.</small></div>
                <label>Trạng thái<select v-model="formFor(job).trackingStatus"><option v-for="item in trackingStatuses" :key="item.value" :value="item.value">{{ item.label }}</option></select></label>
                <label>Địa điểm hiện tại<input v-model="formFor(job).trackingLocation" maxlength="500" placeholder="VD: Bưu cục Quận 7, TP. Hồ Chí Minh" /></label>
                <label>Nhiệt độ (°C)<input v-model="formFor(job).trackingTemperature" type="number" min="-100" max="100" step="0.01" placeholder="Không bắt buộc" /></label>
                <label>Ghi chú<input v-model="formFor(job).trackingNote" maxlength="1000" placeholder="Thông tin thêm (không bắt buộc)" /></label>
                <va-button preset="secondary" :loading="busyId === job.id" :disabled="Boolean(busyId)" @click="recordTrackingUpdate(job)">Lưu cập nhật hành trình</va-button>
              </div>
              <div class="job-actions">
                <va-button v-if="job.status === 'PLANNING'" class="primary-action" :loading="busyId === job.id" :disabled="Boolean(busyId)" @click="update(job, 'IN_TRANSIT')">Bắt đầu vận chuyển <span aria-hidden="true">→</span></va-button>
                <button v-if="!job.delivery_reported_at" class="cancel-action" :disabled="Boolean(busyId)" @click="update(job, 'CANCELLED')">Hủy chuyến</button>
              </div>
            </template>
            <div v-else-if="job.delivery_reported_at" class="completed-note awaiting-confirmation"><span>…</span>Người vận chuyển đã báo giao thành công. Đang chờ nhà phân phối xác nhận đã nhận hàng.</div>
            <div v-else class="completed-note"><span>{{ job.status === 'DELIVERED' ? '✓' : '!' }}</span>{{ job.status === 'DELIVERED' ? 'Lô hàng đã được bàn giao thành công.' : 'Chuyến vận chuyển đã được hủy.' }}</div>
            <details v-if="job.events?.length" class="event-disclosure">
              <summary>Lịch sử sự kiện <span>{{ job.events.length }} mốc</span></summary>
              <ol class="event-list">
                <li v-for="event in job.events" :key="event.id" class="event-row">
                  <div class="event-heading"><strong>{{ eventLabels[event.event_type] || event.event_type }}</strong><time>{{ formatDate(event.occurred_at) }}</time></div>
                  <small v-if="eventSummary(event)" class="event-summary">{{ eventSummary(event) }}</small>
                  <div class="proof-line"><span class="proof-dot" :class="event.blockchain_status.toLowerCase()"></span>{{ proofLabel(event.blockchain_status) }} · {{ event.event_id }}</div>
                  <code v-if="event.data_hash" class="event-hash">Hash: {{ event.data_hash }}</code>
                  <code v-if="event.previous_hash" class="event-hash">Hash mốc trước: {{ event.previous_hash }}</code>
                  <code v-if="event.transaction_hash" class="event-transaction">TX: {{ event.transaction_hash }}</code>
                  <small v-if="event.last_error && event.blockchain_status === 'FAILED'" class="event-error">{{ event.last_error }}</small>
                </li>
              </ol>
            </details>
          </article>
        </div>
        <div v-else class="empty-state">
          <div class="empty-icon"><va-icon :name="selectedView === 'available' ? 'local_shipping' : selectedView === 'active' ? 'inventory_2' : 'task_alt'" /></div>
          <h3>{{ search ? 'Không tìm thấy chuyến phù hợp' : selectedView === 'available' ? 'Chưa có yêu cầu mới' : selectedView === 'active' ? 'Bạn chưa có chuyến đang xử lý' : 'Chưa có lịch sử chuyến' }}</h3>
          <p>{{ search ? 'Thử tìm theo mã chuyến, mã lô hoặc điểm giao nhận.' : selectedView === 'available' ? 'Yêu cầu vận chuyển mới từ các cơ sở sẽ hiển thị tại đây.' : 'Các chuyến của bạn sẽ được hiển thị tại đây.' }}</p>
        </div>
      </va-inner-loading>
      <footer class="board-footer">Hiển thị {{ visibleJobs.length }} / {{ selectedView === 'available' ? available.length : selectedView === 'active' ? activeCount : assigned.length - activeCount }} chuyến</footer>
    </section>
  </main>
</template>

<style scoped>
.transport-page { --ink:#15343a; --muted:#6b8287; --line:#e4eeec; --teal:#0f766e; --mint:#e8f5f1; max-width:1240px; width:calc(100% - 2rem); margin:2rem auto 4rem; color:var(--ink); }
.welcome-panel { min-height:190px; position:relative; overflow:hidden; display:flex; align-items:center; justify-content:space-between; gap:2rem; padding:2rem 2.25rem; border-radius:22px; color:#f5fffc; background:linear-gradient(115deg,#103f43 0%,#0d6663 55%,#17847a 100%); box-shadow:0 16px 40px #104d421a; }
.welcome-panel::after { content:""; position:absolute; width:340px; height:340px; right:90px; top:-220px; border:1px solid #ffffff18; border-radius:50%; box-shadow:0 0 0 35px #ffffff08,0 0 0 75px #ffffff06; }
.welcome-copy,.welcome-actions { position:relative; z-index:1; }
.welcome-kicker { display:flex; align-items:center; gap:.55rem; color:#bde8d9; font-size:.69rem; font-weight:800; letter-spacing:.11em; }
.live-dot { width:8px; height:8px; border-radius:50%; background:#7de1b2; box-shadow:0 0 0 4px #8be5b222; }
.welcome-copy h1 { margin:.8rem 0 .45rem; color:#fff; font-size:clamp(1.7rem,3vw,2.35rem); letter-spacing:-.035em; }
.welcome-copy p { max-width:610px; margin:0; color:#d0e8e3; font-size:.95rem; line-height:1.6; }
.welcome-actions { min-width:210px; text-align:right; }
.today-label { color:#a8d6ca; font-size:.65rem; letter-spacing:.12em; font-weight:800; }
.today-date { margin:.3rem 0 1rem; color:#fff; font-weight:700; text-transform:capitalize; }
.welcome-actions :deep(.va-button) { color:#fff; border-color:#ffffff60; background:#ffffff12; }
.message { margin:1rem 0; }
.summary-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:1rem; margin:1.25rem 0 1.5rem; }
.summary-card { position:relative; display:grid; grid-template-columns:1fr auto; align-items:center; gap:.1rem .75rem; padding:1.1rem 1.2rem; border:1px solid var(--line); border-radius:15px; background:#fff; box-shadow:0 4px 14px #183a3506; }
.summary-icon { grid-column:2; grid-row:1 / span 3; display:grid; place-items:center; width:42px; height:42px; border-radius:13px; color:#0d766b; background:#e9f5f1; font-size:1.35rem; font-weight:700; }
.active-summary .summary-icon { color:#3e6cbb; background:#edf3ff; }.done-summary .summary-icon { color:#18805b; background:#e9f7ef; }.total-summary .summary-icon { color:#aa771b; background:#fff6df; }
.summary-label { color:#61797e; font-size:.79rem; font-weight:650; }.summary-card strong { font-size:1.75rem; letter-spacing:-.04em; line-height:1.25; }.summary-card small { color:#8a9c9e; font-size:.72rem; }
.dispatch-board { overflow:hidden; border:1px solid var(--line); border-radius:18px; background:#fff; box-shadow:0 8px 30px #193b3507; }
.board-heading { display:flex; align-items:flex-end; justify-content:space-between; gap:1.5rem; padding:1.55rem 1.6rem 1.2rem; }
.eyebrow { margin:0 0 .35rem; color:#0f8376; font-size:.67rem; font-weight:850; letter-spacing:.12em; }
.board-heading h2 { margin:0; font-size:1.35rem; letter-spacing:-.025em; }.board-description { margin:.38rem 0 0; color:var(--muted); font-size:.84rem; }
.search-box { display:flex; align-items:center; gap:.55rem; width:min(360px,40%); height:42px; padding:0 .8rem; border:1px solid #dce8e6; border-radius:10px; color:#759092; background:#fbfdfd; }.search-box span { font-size:1.5rem; line-height:1; }.search-box input { width:100%; border:0; outline:0; background:transparent; color:var(--ink); font:inherit; font-size:.8rem; }.search-box:focus-within { border-color:#63aaa1; box-shadow:0 0 0 3px #0f766e14; }
.board-tabs { display:flex; gap:.3rem; padding:0 1.6rem; border-bottom:1px solid var(--line); }.board-tabs button { position:relative; display:flex; align-items:center; gap:.55rem; padding:.8rem .85rem .9rem; border:0; background:none; color:#718588; font:inherit; font-size:.82rem; font-weight:650; cursor:pointer; }.board-tabs button::after { position:absolute; right:.8rem; bottom:-1px; left:.8rem; height:2px; background:transparent; content:""; }.board-tabs button.selected { color:#0d766b; }.board-tabs button.selected::after { background:#0f8376; }.board-tabs button span { padding:.12rem .42rem; border-radius:99px; color:#73878a; background:#f0f5f4; font-size:.7rem; }.board-tabs button.selected span { color:#0e766b; background:#e3f3ef; }
.job-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1rem; padding:1.25rem 1.6rem; }.job-card { min-width:0; padding:1.15rem; border:1px solid #e4edeb; border-radius:14px; background:#fff; transition:border-color .18s,box-shadow .18s,transform .18s; }.job-card:hover { border-color:#b8d8d1; box-shadow:0 8px 24px #124d4010; transform:translateY(-1px); }.request-card { border-left:3px solid #daae50; }
.job-topline,.job-code,.route-point,.cargo-strip,.job-actions { display:flex; align-items:center; }.job-topline { justify-content:space-between; gap:.75rem; }.job-code { gap:.65rem; }.truck-icon { display:grid; place-items:center; width:38px; height:38px; border-radius:12px; color:#0e766b; background:#e9f5f1; font-size:1.3rem; font-weight:700; }.job-code div { display:grid; gap:.12rem; }.job-code small,.route-point small { color:#8a9c9e; font-size:.61rem; font-weight:800; letter-spacing:.08em; }.job-code strong { color:#193c41; font-size:.98rem; }.status-pill { display:inline-flex; align-items:center; gap:.4rem; padding:.38rem .65rem; border-radius:99px; color:#8a6a23; background:#fff5dd; font-size:.68rem; font-weight:750; white-space:nowrap; }.status-pill i { width:6px; height:6px; border-radius:50%; background:currentColor; }.status-pill.in_transit { color:#3569a9; background:#edf4ff; }.status-pill.delivered { color:#22815a; background:#eaf7ef; }.status-pill.cancelled { color:#a44c4c; background:#fff0ef; }
.route-line { display:grid; grid-template-columns:minmax(0,1fr) 55px minmax(0,1fr); align-items:center; margin:1.15rem 0 1rem; }.route-point { min-width:0; gap:.55rem; }.route-point div { min-width:0; display:grid; gap:.25rem; }.route-point strong { overflow:hidden; color:#28464b; font-size:.82rem; text-overflow:ellipsis; white-space:nowrap; }.route-dot { flex:none; width:9px; height:9px; border:2px solid #fff; border-radius:50%; box-shadow:0 0 0 2px #2e9b8c; }.destination-dot { box-shadow:0 0 0 2px #d6a13a; }.route-connector { position:relative; border-top:1px dashed #afc6c1; text-align:center; }.route-connector span { position:relative; top:-.57rem; padding:0 .35rem; color:#5d7778; background:#fff; font-size:.64rem; font-weight:750; white-space:nowrap; }
.cargo-strip { gap:.65rem; min-width:0; padding:.72rem .75rem; border:1px solid #edf2f1; border-radius:10px; background:#f8fbfa; }.cargo-icon { display:grid; place-items:center; flex:none; width:32px; height:32px; border-radius:9px; color:#358d7d; background:#e6f2ee; }.cargo-copy { display:grid; min-width:0; flex:1; gap:.2rem; }.cargo-copy strong { overflow:hidden; color:#315055; font-size:.76rem; text-overflow:ellipsis; white-space:nowrap; }.cargo-copy strong span { color:#91aaa4; }.cargo-copy small { overflow:hidden; color:#829695; font-size:.68rem; text-overflow:ellipsis; white-space:nowrap; }.cargo-strip time { color:#718588; font-size:.66rem; white-space:nowrap; }.job-note { margin:.65rem 0 0; color:#718588; font-size:.75rem; }
.request-hint { display:flex; align-items:center; gap:.55rem; margin:.8rem 0 .65rem; color:#738588; }.request-hint span { display:grid; place-items:center; flex:none; width:18px; height:18px; border:1px solid #b6cbc6; border-radius:50%; font-size:.65rem; font-weight:800; }.request-hint p { margin:0; font-size:.72rem; line-height:1.45; }.primary-action { min-height:40px; display:flex; justify-content:space-between; width:100%; padding:0 .85rem; border:0; border-radius:9px; color:#fff; background:#107c70; font:inherit; font-size:.79rem; font-weight:750; cursor:pointer; }.primary-action:hover { background:#0b695f; }.primary-action:disabled { opacity:.65; cursor:wait; }.delivered-action { background:#16845d; }.delivered-action:hover { background:#116e4d; }
.journey-progress { display:flex; align-items:center; margin:.9rem 0 .8rem; }.progress-step { display:grid; justify-items:center; gap:.25rem; color:#9aabaa; }.progress-step span { display:grid; place-items:center; width:22px; height:22px; border:1px solid #d7e2e0; border-radius:50%; background:#fff; font-size:.65rem; font-weight:800; }.progress-step small { font-size:.61rem; white-space:nowrap; }.progress-step.done { color:#148373; }.progress-step.done span { border-color:#168779; color:#fff; background:#168779; }.progress-track { flex:1; height:2px; margin:-1rem .35rem 0; background:#dce7e5; }.progress-track.reached { background:#168779; }
.driver-form { display:grid; grid-template-columns:1.2fr 1fr .75fr; gap:.55rem; margin:.75rem 0; }.driver-form label,.delivery-fields label,.cancel-field,.tracking-panel label { display:grid; gap:.33rem; color:#627a7e; font-size:.67rem; font-weight:700; }.driver-form input,.delivery-fields input,.cancel-field input,.tracking-panel input,.tracking-panel select { width:100%; min-width:0; height:36px; box-sizing:border-box; padding:0 .58rem; border:1px solid #dce7e5; border-radius:7px; outline:0; color:#26454a; background:#fff; font:inherit; font-size:.72rem; }.driver-form input:focus,.delivery-fields input:focus,.cancel-field input:focus,.tracking-panel input:focus,.tracking-panel select:focus { border-color:#66a99f; box-shadow:0 0 0 3px #0f766e12; }.delivery-fields { display:grid; grid-template-columns:1fr 1fr; gap:.6rem; margin:.7rem 0; }.cancel-field { margin:.65rem 0; }.latest-tracking { display:flex; align-items:center; gap:.65rem; margin:.65rem 0; padding:.65rem .75rem; border:1px solid #dcebe7; border-radius:9px; background:#f7fbf9; }.tracking-pulse { flex:none; width:9px; height:9px; border-radius:50%; background:#168779; box-shadow:0 0 0 4px #16877918; }.latest-tracking > div { display:grid; gap:.15rem; }.latest-tracking small { color:#77908d; font-size:.57rem; font-weight:800; letter-spacing:.06em; }.latest-tracking strong { color:#31565a; font-size:.72rem; }.latest-tracking span:not(.tracking-pulse) { color:#627a7e; font-size:.67rem; }.latest-tracking time { margin-left:auto; color:#829394; font-size:.61rem; white-space:nowrap; }.tracking-panel { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); align-items:end; gap:.75rem; margin:.8rem 0; padding:1rem; border:1px solid #cfe5df; border-radius:10px; background:#f3faf7; }.tracking-panel-heading { display:grid; grid-column:1/-1; gap:.25rem; }.tracking-panel-heading strong { color:#28665f; font-size:.82rem; }.tracking-panel-heading small { color:#7c9291; font-size:.68rem; line-height:1.4; }.tracking-panel :deep(.va-button) { grid-column:1/-1; justify-self:end; min-height:36px; white-space:nowrap; }.job-actions { gap:.8rem; }.job-actions .primary-action { flex:1; }.cancel-action { padding:.4rem .25rem; border:0; color:#a27676; background:transparent; font:inherit; font-size:.7rem; cursor:pointer; }.cancel-action:hover { color:#a33636; }.cancel-action:disabled { opacity:.5; }
.completed-note { display:flex; align-items:center; gap:.55rem; margin-top:.8rem; padding:.65rem .75rem; border-radius:8px; color:#39765d; background:#eff8f2; font-size:.74rem; }.completed-note span { font-weight:900; }
.event-disclosure { margin-top:.8rem; border-top:1px solid #edf2f1; color:#3c5b5e; }.event-disclosure summary { display:flex; align-items:center; gap:.5rem; padding:.7rem 0 .2rem; color:#39766e; font-size:.72rem; font-weight:750; cursor:pointer; list-style-position:inside; }.event-disclosure summary span { padding:.12rem .45rem; border-radius:99px; color:#607b79; background:#eef5f3; font-size:.63rem; }.event-list { display:grid; gap:.7rem; margin:.5rem 0 0; padding:0 0 0 1.5rem; }.event-row { padding:.15rem 0 .45rem .2rem; color:#849695; font-size:.68rem; }.event-heading { display:flex; justify-content:space-between; gap:.5rem; }.event-heading strong { color:#365b5e; font-size:.7rem; }.event-heading time { color:#839493; font-size:.63rem; white-space:nowrap; }.event-summary { display:block; margin-top:.25rem; color:#536f70; font-size:.63rem; }.proof-line { display:flex; align-items:center; gap:.35rem; margin-top:.3rem; color:#788e8d; font-size:.62rem; overflow-wrap:anywhere; }.proof-dot { flex:none; width:7px; height:7px; border-radius:50%; background:#d9aa45; }.proof-dot.success { background:#278760; }.proof-dot.failed { background:#c65757; }.event-hash,.event-transaction { display:block; margin-top:.3rem; color:#617d7b; font-size:.59rem; overflow-wrap:anywhere; white-space:normal; }.event-error { display:block; margin-top:.3rem; color:#a94e4e; font-size:.63rem; }
.empty-state { display:grid; justify-items:center; padding:3rem 1rem; text-align:center; }.empty-icon { display:grid; place-items:center; width:54px; height:54px; margin-bottom:.85rem; border-radius:16px; color:#348a7b; background:#eaf5f1; font-size:1.5rem; }.empty-state h3 { margin:0; color:#27464a; font-size:1rem; }.empty-state p { max-width:420px; margin:.4rem 0 0; color:#829395; font-size:.8rem; line-height:1.5; }.board-footer { padding:.75rem 1.6rem; border-top:1px solid #eef3f2; color:#89999a; font-size:.68rem; }
@media (max-width:900px) { .summary-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }.job-grid { grid-template-columns:1fr; } }
@media (max-width:600px) { .transport-page { width:calc(100% - 1rem); margin:1rem auto 2rem; }.welcome-panel { align-items:flex-start; flex-direction:column; gap:1rem; padding:1.35rem; border-radius:17px; }.welcome-actions { display:flex; align-items:center; flex-wrap:wrap; gap:.4rem .65rem; min-width:0; text-align:left; }.today-label { width:100%; }.today-date { margin:0 auto 0 0; font-size:.8rem; }.welcome-actions :deep(.va-button) { min-height:34px; }.summary-grid { gap:.55rem; margin: .75rem 0 1rem; }.summary-card { padding:.8rem; }.summary-label { max-width:112px; font-size:.7rem; }.summary-card strong { font-size:1.45rem; }.summary-card small { font-size:.63rem; }.summary-icon { width:34px; height:34px; }.board-heading { align-items:stretch; flex-direction:column; padding:1.1rem 1rem .9rem; }.search-box { width:auto; }.board-tabs { gap:0; padding:0 .55rem; }.board-tabs button { gap:.35rem; padding:.75rem .5rem .8rem; font-size:.72rem; }.board-tabs button::after { right:.4rem; left:.4rem; }.job-grid { gap:.7rem; padding:.75rem; }.job-card { padding:.85rem; }.route-line { grid-template-columns:minmax(0,1fr) 36px minmax(0,1fr); }.route-point { gap:.4rem; }.route-point strong { font-size:.73rem; }.route-point small { font-size:.53rem; }.cargo-strip { flex-wrap:wrap; }.cargo-strip time { margin-left:2.55rem; }.driver-form,.delivery-fields,.tracking-panel { grid-template-columns:1fr; }.driver-form label:first-child { grid-column:1/-1; }.tracking-panel-heading,.tracking-panel :deep(.va-button) { grid-column:1; }.board-footer { padding:.7rem 1rem; } }
</style>
