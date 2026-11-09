<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { VaAlert, VaBadge, VaButton, VaCard, VaCardContent, VaInnerLoading } from 'vuestic-ui'
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
  <main class="receipts-page">
    <header class="page-heading">
      <div><p class="eyebrow">NHÀ PHÂN PHỐI</p><h1>Hàng đang giao tới bạn</h1><p>Xác nhận tại đây sau khi đã kiểm tra và nhận hàng thực tế.</p></div>
      <va-badge color="warning">{{ pendingCount }} chuyến chờ xác nhận</va-badge>
    </header>
    <va-alert v-if="error" color="danger" class="message">{{ error }} <va-button preset="secondary" size="small" @click="load()">Thử lại</va-button></va-alert>
    <va-alert v-if="notice" color="success" class="message">{{ notice }}</va-alert>
    <CollectionToolbar v-model:query="query" v-model:status="filterStatus" v-model:page="listPage" :statuses="statusOptions" :total="filteredTrips.length" :page-size="pageSize" :loading="loading" label="chuyến trong danh sách đã tải" />
    <va-inner-loading :loading="loading">
      <section v-if="trips.length" class="trip-grid">
        <va-card v-for="trip in visibleTrips" :key="trip.id" class="trip-card"><va-card-content>
          <div class="trip-heading"><div><small>MÃ CHUYẾN</small><h2>{{ trip.transport_code }}</h2></div>
            <va-badge :color="trip.status === 'DELIVERED' ? 'success' : trip.status === 'CANCELLED' ? 'danger' : 'warning'">
              {{ trip.status === 'DELIVERED' ? 'Đã nhận hàng' : trip.status === 'CANCELLED' ? 'Đã hủy' : trip.delivery_reported_at ? 'Chờ xác nhận' : trip.status === 'IN_TRANSIT' ? 'Đang vận chuyển' : 'Chờ người vận chuyển' }}
            </va-badge>
          </div>
          <p class="route">{{ trip.from_location }} → {{ trip.to_location }}</p>
          <p class="meta">{{ trip.quantity }} kg · {{ trip.lot?.lot_code ?? 'Lô hàng' }} · {{ trip.lot?.provenance.farm.name ?? 'Cơ sở nuôi' }}</p>
          <div v-if="trip.delivery_reported_at" class="delivery-report">
            <strong>Người vận chuyển đã báo giao</strong>
            <p>{{ reportText(trip) || 'Vui lòng kiểm tra hàng thực tế rồi xác nhận đã nhận.' }}</p>
          </div>
          <va-button v-if="trip.status === 'IN_TRANSIT' && trip.delivery_reported_at" color="primary" :loading="busyId === trip.id" :disabled="Boolean(busyId)" @click="confirmReceipt(trip)">Xác nhận đã nhận hàng</va-button>
          <LotQrPanel v-if="trip.status === 'DELIVERED' && trip.lot" :api-path="`/transports/${trip.id}/qr`" :lot-code="trip.lot.lot_code" />
          <p v-else-if="trip.status !== 'CANCELLED'" class="meta">Bạn có thể phát hành QR cho lô sau khi xác nhận đã nhận hàng.</p>
          <ol v-if="trip.events?.length" class="event-list">
            <li v-for="event in trip.events" :key="event.id"><strong>{{ eventLabel(event) }}</strong><small>{{ eventTime(event.occurred_at) }} · {{ event.blockchain_status === 'SUCCESS' ? 'Đã xác nhận blockchain' : event.blockchain_status === 'FAILED' ? 'Sẽ thử lại blockchain' : 'Đang chờ blockchain' }}</small><small v-if="eventSummary(event)">{{ eventSummary(event) }}</small></li>
          </ol>
        </va-card-content></va-card>
      </section>
      <p v-if="!loading && !error && trips.length && !filteredTrips.length" class="empty-state" role="status">Không có chuyến phù hợp. Thử đổi từ khóa hoặc trạng thái.</p>
      <p v-else-if="!loading && !error && !trips.length" class="empty-state">Chưa có chuyến nào được gửi tới nhà phân phối của bạn.</p>
    </va-inner-loading>
  </main>
</template>

<style scoped>
.receipts-page { max-width: 1180px; margin: 0 auto; padding: 2rem; color: #183b3a; }
.page-heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1.5rem; }
.eyebrow, .trip-heading small { color: #688582; font-size: .72rem; font-weight: 800; letter-spacing: .1em; margin: 0; }
h1 { margin: .25rem 0; font-size: 1.8rem; }
.page-heading p:last-child { margin: .25rem 0 0; color: #688582; }
.trip-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr)); gap: 1rem; }
.trip-card { min-width:0; overflow-wrap:anywhere; border: 1px solid #dce9e6; border-radius: 16px; }
.trip-heading { flex-wrap:wrap; display: flex; align-items: center; justify-content: space-between; gap: .75rem; }
.trip-heading h2 { margin: .25rem 0; font-size: 1.2rem; }
.route { font-weight: 700; margin: 1rem 0 .3rem; }
.meta, .delivery-report p { color: #688582; font-size: .9rem; }
.delivery-report { background: #eff8f3; border-radius: 10px; padding: .85rem; margin: 1rem 0; }
.delivery-report p { margin: .4rem 0 0; }
.event-list { padding-left: 1.2rem; margin: 1rem 0 0; }
.event-list li { padding: .35rem 0; }
.event-list small { display: block; color: #688582; margin-top: .2rem; }
.empty-state { padding: 3rem 1rem; text-align: center; color: #688582; }
.message { margin-bottom: 1rem; }
@media (max-width: 600px) { .receipts-page { padding: 1rem; } .page-heading { align-items: flex-start; flex-direction: column; } }
</style>
