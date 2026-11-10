<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { VaAlert, VaButton, VaInnerLoading } from 'vuestic-ui'
import CollectionToolbar from '../../components/CollectionToolbar.vue'
import LotQrPanel from '../../components/LotQrPanel.vue'
import { api } from '../../api/client'
import type { LotTransport, TransportEvent } from '../../types'

interface ReceivingTrip extends LotTransport {
  lot: { id: string; lot_code: string; quantity: number; provenance: { farm: { name: string }; batch: { batch_code: string } } } | null
}
const trips = ref<ReceivingTrip[]>([])
const loading = ref(false)
const busyId = ref<string | null>(null)
const error = ref('')
const notice = ref('')
const query = ref(''); const filterStatus = ref(''); const listPage = ref(1); const pageSize = 8
const statusOptions = [{ value: 'PLANNING', label: 'Chờ người vận chuyển' }, { value: 'IN_TRANSIT', label: 'Đang vận chuyển' }, { value: 'DELIVERED', label: 'Đã nhận hàng' }, { value: 'CANCELLED', label: 'Đã hủy' }]
const filteredTrips = computed(() => trips.value.filter((trip) => (!filterStatus.value || trip.status === filterStatus.value) && `${trip.transport_code} ${trip.lot?.lot_code ?? ''} ${trip.from_location} ${trip.to_location}`.toLocaleLowerCase('vi').includes(query.value.trim().toLocaleLowerCase('vi'))))
const visibleTrips = computed(() => filteredTrips.value.slice((listPage.value - 1) * pageSize, listPage.value * pageSize))
watch([query, filterStatus], () => { listPage.value = 1 })
watch(() => filteredTrips.value.length, (length) => { listPage.value = Math.min(listPage.value, Math.max(1, Math.ceil(length / pageSize))) })
let loadVersion = 0; let active = true
let refreshTimer: number | undefined
const pendingCount = computed(() => trips.value.filter((trip) => trip.status === 'IN_TRANSIT' && trip.delivery_reported_at).length)

function reportFor(trip: ReceivingTrip) {
  return trip.delivery_report && typeof trip.delivery_report === 'object' ? trip.delivery_report : {}
}
function deliveryProofUrl(trip: ReceivingTrip) {
  const value = reportFor(trip).proofImageUrl
  return typeof value === 'string' ? value : ''
}
function reportText(trip: ReceivingTrip) {
  const report = reportFor(trip)
  return [report.location && `Điểm giao: ${String(report.location)}`,
    report.temperature != null && `Nhiệt độ: ${String(report.temperature)} °C`,
    report.recipientName && `Người nhận tại điểm giao: ${String(report.recipientName)}`,
    report.receiptReference && `Mã biên nhận: ${String(report.receiptReference)}`, report.note && String(report.note)].filter(Boolean).join(' · ')
}
function eventTime(value: string) {
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}
function eventLabel(event: TransportEvent) {
  const labels: Record<string, string> = {
    REQUESTED: 'Tạo yêu cầu', CLAIMED: 'Người vận chuyển nhận chuyến', IN_TRANSIT: 'Bắt đầu vận chuyển',
    CHECKPOINT: 'Điểm kiểm tra', DELIVERY_REPORTED: 'Người vận chuyển báo giao', RECIPIENT_ASSIGNED: 'Gán nhà phân phối nhận',
    TRACKING_UPDATE: 'Cập nhật hành trình',
    DELIVERED: 'Nhà phân phối xác nhận đã nhận', CANCELLED: 'Hủy chuyến',
  }
  return labels[event.event_type] ?? event.event_type
}
function eventSummary(event: TransportEvent) {
  const value = (key: string) => event.payload[key] == null ? '' : String(event.payload[key])
  if (event.event_type === 'TRACKING_UPDATE') {
    const statuses: Record<string, string> = {
      PICKED_UP: 'Đã lấy hàng', IN_TRANSIT: 'Đang trên đường', AT_SORTING_FACILITY: 'Đã đến điểm trung chuyển',
      DEPARTED_FACILITY: 'Đã rời điểm trung chuyển', OUT_FOR_DELIVERY: 'Đang giao tới người nhận',
      DELIVERY_ATTEMPT_FAILED: 'Giao hàng chưa thành công', DELIVERED_REPORTED: 'Giao hàng thành công · chờ xác nhận', OTHER: 'Cập nhật khác',
    }
    return [statuses[value('trackingStatus')] ?? value('trackingStatus'), value('location'), value('temperature') && `${value('temperature')} °C`, value('note')].filter(Boolean).join(' · ')
  }
  if (event.event_type === 'CHECKPOINT') return [value('temperature') && `${value('temperature')} °C`, value('location'), value('note')].filter(Boolean).join(' · ')
  return ''
}
async function load(silent = false) {
  const version = ++loadVersion
  if (!silent) loading.value = true
  error.value = ''
  try { const result = await api.get<{ items: ReceivingTrip[] }>('/transports/receiving'); if (active && version === loadVersion) trips.value = result.items }
  catch (e) { if (active && version === loadVersion) error.value = e instanceof Error ? e.message : 'Không tải được các chuyến gửi tới nhà phân phối' }
  finally { if (active && version === loadVersion) loading.value = false }
}
async function confirmReceipt(trip: ReceivingTrip) {
  if (busyId.value) return
  if (!window.confirm(`Xác nhận nhà phân phối đã nhận chuyến ${trip.transport_code} (${trip.quantity} kg)?`)) return
  busyId.value = trip.id; error.value = ''; notice.value = ''
  try {
    await api.post(`/transports/${trip.id}/confirm-delivery`, {})
    notice.value = `Đã xác nhận nhận hàng cho chuyến ${trip.transport_code}.`
    await load(true)
  } catch (e) { error.value = e instanceof Error ? e.message : 'Không xác nhận được đã nhận hàng' }
  finally { busyId.value = null }
}
onMounted(() => { void load(); refreshTimer = window.setInterval(() => void load(true), 15000) })
onUnmounted(() => { active = false; ++loadVersion; if (refreshTimer) window.clearInterval(refreshTimer) })
</script>

<template>
  <main class="receipts-page" :aria-busy="loading">
    <header class="page-heading">
      <div>
        <p class="eyebrow">NHÀ PHÂN PHỐI</p>
        <h1>Hàng nhận</h1>
        <p>Theo dõi chuyến hàng và xác nhận khi đã nhận đủ hàng thực tế.</p>
      </div>
      <span class="pending-summary">{{ pendingCount }} chuyến chờ xác nhận</span>
    </header>
    <va-alert v-if="error" color="danger" class="message" role="alert">{{ error }} <va-button preset="secondary" size="small" @click="load()">Thử lại</va-button></va-alert>
    <va-alert v-if="notice" color="success" class="message" role="status">{{ notice }}</va-alert>
    <CollectionToolbar v-model:query="query" v-model:status="filterStatus" v-model:page="listPage" :statuses="statusOptions" :total="filteredTrips.length" :page-size="pageSize" :loading="loading" label="chuyến" />
    <va-inner-loading :loading="loading">
      <section v-if="visibleTrips.length" class="trip-list" aria-label="Danh sách hàng nhận">
        <article v-for="trip in visibleTrips" :key="trip.id" class="trip-card">
          <div class="trip-overview">
            <div class="trip-heading">
              <span class="field-label">Chuyến hàng</span>
              <h2>{{ trip.transport_code }}</h2>
              <span class="trip-status" :class="{ delivered: trip.status === 'DELIVERED', cancelled: trip.status === 'CANCELLED' }">
                {{ trip.status === 'DELIVERED' ? 'Đã nhận hàng' : trip.status === 'CANCELLED' ? 'Đã hủy' : trip.delivery_reported_at ? 'Chờ xác nhận' : trip.status === 'IN_TRANSIT' ? 'Đang vận chuyển' : 'Chờ người vận chuyển' }}
              </span>
            </div>
            <div class="shipment-origin">
              <span class="field-label">Nơi gửi</span>
              <p>{{ trip.from_location }}</p>
            </div>
            <dl class="shipment-facts">
              <div><dt>Mã lô</dt><dd>{{ trip.lot?.lot_code ?? 'Chưa có thông tin' }}</dd></div>
              <div><dt>Khối lượng</dt><dd>{{ Number(trip.quantity).toLocaleString('vi-VN') }} <span>kg</span></dd></div>
            </dl>
            <div class="trip-action">
              <va-button v-if="trip.status === 'IN_TRANSIT' && trip.delivery_reported_at" color="primary" :loading="busyId === trip.id" :disabled="Boolean(busyId)" @click="confirmReceipt(trip)">Xác nhận đã nhận hàng</va-button>
              <span v-else class="action-note">{{ trip.status === 'DELIVERED' ? 'Đã hoàn tất nhận hàng' : trip.status === 'CANCELLED' ? 'Chuyến hàng đã hủy' : 'Chờ giao hàng' }}</span>
            </div>
          </div>
          <details class="shipment-details">
            <summary><span>Chi tiết chuyến hàng</span><span class="details-chevron" aria-hidden="true">⌄</span></summary>
            <div class="details-content">
              <dl class="delivery-facts">
                <div><dt>Điểm nhận</dt><dd>{{ trip.to_location }}</dd></div>
                <div v-if="trip.lot?.provenance.farm.name"><dt>Cơ sở nuôi</dt><dd>{{ trip.lot.provenance.farm.name }}</dd></div>
              </dl>
              <section v-if="trip.delivery_reported_at" class="delivery-report">
                <h3>Thông tin bàn giao</h3>
                <p>{{ reportText(trip) || 'Người vận chuyển đã báo giao. Vui lòng kiểm tra hàng thực tế trước khi xác nhận.' }}</p>
                <a v-if="deliveryProofUrl(trip)" class="delivery-proof-link" :href="deliveryProofUrl(trip)" target="_blank" rel="noopener noreferrer">
                  <img class="delivery-proof-image" :src="deliveryProofUrl(trip)" alt="Ảnh bằng chứng giao hàng do người vận chuyển cung cấp" loading="lazy" />
                  Xem ảnh giao hàng ↗
                </a>
              </section>
              <section v-if="trip.events?.length" class="shipment-history">
                <h3>Hành trình giao hàng</h3>
                <ol class="event-list">
                  <li v-for="event in trip.events" :key="event.id">
                    <strong>{{ eventLabel(event) }}</strong>
                    <time :datetime="event.occurred_at">{{ eventTime(event.occurred_at) }}</time>
                    <p v-if="eventSummary(event)">{{ eventSummary(event) }}</p>
                  </li>
                </ol>
              </section>
            </div>
          </details>
          <details v-if="trip.status === 'DELIVERED' && trip.lot" class="shipment-details qr-details">
            <summary><span>QR truy xuất nguồn gốc</span><span class="details-chevron" aria-hidden="true">⌄</span></summary>
            <LotQrPanel :api-path="`/transports/${trip.id}/qr`" :lot-code="trip.lot.lot_code" />
          </details>
        </article>
      </section>
      <p v-if="!loading && !error && trips.length && !filteredTrips.length" class="empty-state" role="status">Không có chuyến phù hợp. Thử đổi từ khóa hoặc trạng thái.</p>
      <p v-else-if="!loading && !error && !trips.length" class="empty-state" role="status">Chưa có chuyến hàng gửi đến bạn.</p>
    </va-inner-loading>
  </main>
</template>

<style scoped>
.receipts-page {
  --receipt-ink: var(--app-ink);
  --receipt-muted: var(--app-muted);
  --receipt-line: var(--app-line);
  width: min(100%, 1200px);
  margin: 24px auto 48px;
  padding: 32px;
  border-radius: 28px;
  color: var(--receipt-ink);
  background: var(--app-canvas);
  line-height: 1.6;
}
.page-heading { display: flex; align-items: center; justify-content: space-between; gap: 24px; margin-bottom: 28px; }
.eyebrow { color: #526d51; font-size: 11px; font-weight: 700; letter-spacing: .12em; margin: 0; }
h1 { margin: 6px 0 8px; font-size: clamp(28px, 3vw, 36px); font-weight: 650; line-height: 1.2; letter-spacing: -.04em; }
.page-heading p:last-child { margin: 0; color: var(--receipt-muted); font-size: 14px; }
.pending-summary { padding: 9px 16px; border-radius: 24px; background: var(--app-primary-soft); color: var(--app-primary-dark); font-size: 13px; font-weight: 600; flex-shrink: 0; }
.trip-list { display: grid; gap: 16px; }
.trip-card { min-width: 0; overflow-wrap: anywhere; border: 1px solid var(--receipt-line); border-radius: 20px; background: #fff; box-shadow: 0 4px 20px rgb(47 72 55 / 3%); }
.trip-overview { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1.2fr) minmax(0, 1.2fr) 185px; gap: 24px; align-items: start; padding: 24px; }
.field-label, .shipment-facts dt, .delivery-facts dt { display: block; color: var(--receipt-muted); font-size: 12px; margin-bottom: 8px; }
.trip-heading h2 { margin: 0 0 10px; font-size: 16px; font-weight: 650; line-height: 1.5; }
.trip-status { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 20px; background: #fcf2db; color: #79591f; font-size: 12px; font-weight: 600; }
.trip-status::before { content: ''; width: 5px; height: 5px; background: currentColor; border-radius: 50%; flex-shrink: 0; }
.trip-status.delivered { background: #eaf2e5; color: #42653c; }
.trip-status.cancelled { background: #f9eae6; color: #934e43; }
.shipment-origin p { margin: 0; font-size: 14px; font-weight: 500; }
.shipment-facts { display: grid; gap: 14px; margin: 0; }
.shipment-facts dt { margin-bottom: 4px; }
.shipment-facts dd, .delivery-facts dd { margin: 0; font-size: 14px; font-weight: 600; }
.shipment-facts dd span { font-weight: 400; color: var(--receipt-muted); }
.trip-action { align-self: center; text-align: right; }
.trip-action :deep(.va-button) { width: 100%; min-height: 44px; border-radius: 12px; font-size: 13px; }
.action-note { color: var(--receipt-muted); font-size: 13px; }
.shipment-details { border-top: 1px solid #edf0e8; }
.shipment-details > summary { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 48px; padding: 12px 24px; cursor: pointer; list-style: none; color: var(--app-primary-dark); font-size: 13px; font-weight: 600; }
.shipment-details > summary::-webkit-details-marker { display: none; }
.details-chevron { font-size: 20px; line-height: 1; }
.shipment-details[open] > summary { background: var(--app-primary-soft); }
.shipment-details[open] > summary .details-chevron { transform: rotate(180deg); }
.details-content { padding: 24px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 28px; }
.delivery-facts { display: grid; align-content: start; gap: 18px; margin: 0; }
.delivery-report { background: #fcf8ed; border: 1px solid #eee4ca; border-radius: 16px; padding: 20px; }
h3 { margin: 0 0 12px; font-size: 14px; font-weight: 650; }
.delivery-report p, .event-list p { margin: 0; color: var(--receipt-muted); font-size: 13px; line-height: 1.7; }
.delivery-proof-link { display: grid; justify-items: start; gap: 10px; margin-top: 16px; color: var(--app-primary-dark); font-size: 13px; font-weight: 600; text-decoration: underline; text-underline-offset: 4px; }
.delivery-proof-image { width: 100%; max-height: 220px; aspect-ratio: 4 / 3; border: 1px solid var(--receipt-line); border-radius: 12px; object-fit: contain; background: #fffdf7; }
.shipment-history { grid-column: 1 / -1; }
.event-list { list-style: none; padding: 0 0 0 23px; margin: 18px 0 0 5px; border-left: 1px solid #d6e1cf; }
.event-list li { position: relative; padding: 0 0 20px; }
.event-list li:last-child { padding-bottom: 0; }
.event-list li::before { content: ''; position: absolute; left: -28px; top: 6px; width: 9px; height: 9px; border-radius: 50%; background: #7b9470; box-shadow: 0 0 0 4px #f1f5ed; }
.event-list strong { font-size: 13px; font-weight: 600; }
.event-list time { display: block; color: var(--receipt-muted); font-size: 12px; margin: 4px 0; }
.qr-details :deep(.qr-panel) { border: 0; margin: 0; padding: 20px 24px 24px; }
.empty-state { padding: 48px 24px; text-align: center; color: var(--receipt-muted); background: #fff; border: 1px dashed #d2ddc9; border-radius: 20px; }
.message { margin-bottom: 20px; border-radius: 14px; }
.receipts-page :deep(.collection-toolbar) { padding: 20px; margin: 0 0 24px; border-radius: 18px; border-color: var(--receipt-line); background: #fff; }
.receipts-page :deep(.collection-toolbar input), .receipts-page :deep(.collection-toolbar select), .receipts-page :deep(.collection-toolbar button) { min-height: 44px; border-radius: 10px; font-size: 14px; }
.receipts-page :deep(.collection-toolbar input), .receipts-page :deep(.collection-toolbar select) { background: var(--app-canvas); border-color: var(--app-line); }
a:focus-visible, summary:focus-visible { outline: 3px solid #6e8e62; outline-offset: 3px; border-radius: 6px; }
@media (max-width: 1000px) {
  .trip-overview { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px; }
  .shipment-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .trip-action { align-self: end; }
  .trip-action :deep(.va-button) { width: auto; }
}
@media (max-width: 600px) {
  .receipts-page { padding: 24px 16px; margin: 0 auto 24px; border-radius: 0; }
  .page-heading { align-items: flex-start; flex-direction: column; gap: 16px; }
  .trip-overview { padding: 20px; }
  .trip-heading, .shipment-origin, .shipment-facts, .trip-action { grid-column: 1 / -1; }
  .trip-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; }
  .trip-heading .field-label { width: 100%; margin: 0; }
  .trip-heading h2 { margin: 0; }
  .trip-action :deep(.va-button) { width: 100%; }
  .trip-action { text-align: left; }
  .shipment-details > summary { padding-inline: 20px; }
  .details-content { padding: 20px; grid-template-columns: minmax(0, 1fr); gap: 20px; }
}
</style>
