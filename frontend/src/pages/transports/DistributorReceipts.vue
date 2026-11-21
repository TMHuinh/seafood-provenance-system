<script setup lang="ts">
import { dismissOnBackdrop } from '../../components/overlay-dismiss'
import LoadingState from '../../components/LoadingState.vue'
import PageHeader from '../../components/PageHeader.vue'
import EmptyState from '../../components/EmptyState.vue'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { VaAlert, VaButton } from 'vuestic-ui'
import LotQrPanel from '../../components/LotQrPanel.vue'
import { api } from '../../api/client'
import { useAuthStore } from '../../stores/auth.store'
import { SPECIES_LABELS, type LotTransport, type Species, type TransportEvent } from '../../types'

interface ReceivingTrip extends LotTransport {
  lot: { id: string; lot_code: string; quantity: number; provenance: { farm: { name: string }; batch: { batch_code: string; species?: Species | null } } } | null
}
const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const selectedId = computed(() => typeof route.query.trip === 'string' ? route.query.trip : null)
const trips = ref<ReceivingTrip[]>([])
const selectedTrip = computed(() => trips.value.find((trip) => trip.id === selectedId.value))
const drawer = ref<HTMLDialogElement | null>(null)
const loading = ref(true)
const loadedTrips = ref(false)
const busyId = ref<string | null>(null)
const loadError = ref('')
const confirmationError = ref('')
const notice = ref<{ tripId: string; text: string }>()

const tabs = [
  { value: '', label: 'Tất cả' },
  { value: 'IN_TRANSIT', label: 'Đang vận chuyển' },
  { value: 'PENDING', label: 'Chờ xác nhận' },
  { value: 'DELIVERED', label: 'Đã nhận hàng' },
] as const
const statusLabels = {
  IN_TRANSIT: 'Đang vận chuyển',
  PENDING: 'Chờ xác nhận',
  DELIVERED: 'Đã nhận hàng',
  PLANNING: 'Chờ người vận chuyển',
  CANCELLED: 'Đã hủy',
}

function shipmentStatus(trip: ReceivingTrip) {
  return trip.status === 'IN_TRANSIT' && trip.delivery_reported_at ? 'PENDING' : trip.status
}

const query = ref('')
const filterStatus = ref<(typeof tabs)[number]['value']>('')
const sender = ref('')
const fromDate = ref('')
const toDate = ref('')
const listPage = ref(1)
const pageSize = 8
const number = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 })
const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short' })

const senderName = (trip: ReceivingTrip) => trip.lot?.provenance.farm.name || trip.from_location
const senders = computed(() => [...new Set(trips.value.map(senderName))].sort((a, b) => a.localeCompare(b, 'vi')))
const invalidDates = computed(() => Boolean(fromDate.value && toDate.value && fromDate.value > toDate.value))
const hasFilters = computed(() => query.value || filterStatus.value || sender.value || fromDate.value || toDate.value)

const filteredTrips = computed(() => {
  if (invalidDates.value) return []
  const keyword = query.value.trim().toLocaleLowerCase('vi')
  return trips.value.filter((trip) => {
    if (filterStatus.value && shipmentStatus(trip) !== filterStatus.value) return false
    if (sender.value && senderName(trip) !== sender.value) return false
    if (fromDate.value || toDate.value) {
      const sent = day.format(new Date(trip.transport_date))
      if ((fromDate.value && sent < fromDate.value) || (toDate.value && sent > toDate.value)) return false
    }
    return [trip.transport_code, trip.lot?.lot_code, senderName(trip), trip.from_location, trip.to_location]
      .some((field) => field?.toLocaleLowerCase('vi').includes(keyword))
  })
})
const pages = computed(() => Math.max(1, Math.ceil(filteredTrips.value.length / pageSize)))
const visibleTrips = computed(() => filteredTrips.value.slice((listPage.value - 1) * pageSize, listPage.value * pageSize))
watch([query, filterStatus, sender, fromDate, toDate], () => { listPage.value = 1 })
watch(pages, (count) => { listPage.value = Math.min(listPage.value, count) })

watch([selectedTrip, drawer], ([trip, element]) => {
  if (!element) return
  if (trip && !element.open) element.showModal()
  if (!trip && element.open) element.close()
}, { flush: 'post' })

watch(selectedId, () => { confirmationError.value = '' })

function clearFilters() {
  query.value = ''
  filterStatus.value = ''
  sender.value = ''
  fromDate.value = ''
  toDate.value = ''
}

function closeDetail() {
  if (busyId.value) return
  const { trip, ...remaining } = route.query
  if (trip) void router.replace({ query: remaining })
}

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
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(value))
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
async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const result = await api.get<{ items: ReceivingTrip[] }>('/transports/receiving')
    trips.value = result.items
    loadedTrips.value = true
  } catch (cause) {
    loadError.value = cause instanceof Error ? cause.message : 'Không tải được danh sách hàng nhận.'
  } finally {
    loading.value = false
  }
}

async function confirmReceipt(trip: ReceivingTrip) {
  if (busyId.value || shipmentStatus(trip) !== 'PENDING') return
  if (!window.confirm(`Xác nhận đã nhận chuyến ${trip.transport_code} (${number.format(trip.quantity)} kg)?`)) return
  busyId.value = trip.id
  confirmationError.value = ''
  notice.value = undefined
  try {
    await api.post(`/transports/${trip.id}/confirm-delivery`, {})
    const savedTrip = trips.value.find((item) => item.id === trip.id)
    if (savedTrip) savedTrip.status = 'DELIVERED'
    notice.value = { tripId: trip.id, text: `Đã xác nhận nhận hàng cho chuyến ${trip.transport_code}.` }
    await load()
  } catch (cause) {
    confirmationError.value = cause instanceof Error ? cause.message : 'Không xác nhận được đã nhận hàng.'
  } finally {
    busyId.value = null
  }
}

onMounted(load)
</script>

<template>
  <main class="receipts-page">
    <PageHeader title="Hàng nhận" description="Quản lý các chuyến hàng được gửi đến tổ chức của bạn">
      <template #actions>
        <va-button preset="secondary" icon="refresh" :loading="loading" :disabled="Boolean(busyId)" @click="load">
          Làm mới
        </va-button>
      </template>
    </PageHeader>

    <va-alert v-if="loadError" color="danger" role="alert" class="message">{{ loadError }}</va-alert>
    <va-alert v-if="notice && !selectedTrip" color="success" role="status" class="message">{{ notice.text }}</va-alert>
    <va-alert v-if="loadedTrips && selectedId && !selectedTrip" color="warning" role="status" class="message">
      Chuyến này không có trong danh sách hàng nhận hiện tại.
      <button type="button" class="text-button" @click="closeDetail">Về danh sách</button>
    </va-alert>

    <section class="list-panel" aria-label="Danh sách hàng nhận" :aria-busy="loading">
      <div class="status-tabs" role="group" aria-label="Lọc theo trạng thái">
        <button v-for="tab in tabs" :key="tab.value" type="button"
          :aria-pressed="filterStatus === tab.value" @click="filterStatus = tab.value">
          {{ tab.label }}
        </button>
      </div>

      <div class="filters">
        <label class="search-field">Tìm kiếm
          <input v-model="query" type="search" placeholder="Mã chuyến, mã lô hoặc nguồn gửi" />
        </label>
        <div class="sender-field">
          <label for="receipt-sender">Nguồn gửi</label>
          <select id="receipt-sender" v-model="sender">
            <option value="">Tất cả nguồn gửi</option>
            <option v-for="name in senders" :key="name">{{ name }}</option>
          </select>
        </div>
        <label>Ngày gửi từ <input v-model="fromDate" type="date" :max="toDate || undefined" /></label>
        <label>Ngày gửi đến <input v-model="toDate" type="date" :min="fromDate || undefined" /></label>
        <button v-if="hasFilters" type="button" class="text-button" @click="clearFilters">Xóa bộ lọc</button>
      </div>
      <p v-if="invalidDates" role="alert" class="filter-error">Ngày kết thúc phải từ ngày bắt đầu trở đi.</p>

      <LoadingState v-if="loading && !loadedTrips" />
      <template v-else-if="loadedTrips && !invalidDates">
        <table v-if="visibleTrips.length" class="shipments" role="table" aria-label="Các chuyến gửi đến">
          <thead role="rowgroup">
            <tr role="row">
              <th scope="col">Mã chuyến</th><th scope="col">Nguồn gửi</th><th scope="col">Số lô</th>
              <th scope="col">Khối lượng</th><th scope="col">Trạng thái</th><th scope="col">Ngày gửi</th><th scope="col">Thao tác</th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            <tr v-for="trip in visibleTrips" :key="trip.id" role="row">
              <th scope="row" role="rowheader" class="trip-code">{{ trip.transport_code }}</th>
              <td role="cell"><span class="mobile-label">Nguồn gửi</span>{{ senderName(trip) }}</td>
              <td role="cell"><span class="mobile-label">Số lô</span>{{ trip.lot ? '1' : '—' }}</td>
              <td role="cell"><span class="mobile-label">Khối lượng</span>{{ number.format(trip.quantity) }} kg</td>
              <td role="cell"><span class="mobile-label">Trạng thái</span><span class="badge" :data-status="shipmentStatus(trip)">{{ statusLabels[shipmentStatus(trip)] }}</span></td>
              <td role="cell"><span class="mobile-label">Ngày gửi</span><time :datetime="trip.transport_date">{{ eventTime(trip.transport_date) }}</time></td>
              <td role="cell" class="row-action">
                <RouterLink :to="{ query: { ...route.query, trip: trip.id } }" class="detail-link"
                  :aria-label="`Xem chi tiết chuyến ${trip.transport_code}`">Xem chi tiết</RouterLink>
              </td>
            </tr>
          </tbody>
        </table>
        <EmptyState v-else-if="!loadError" icon="inventory_2"
          :title="hasFilters ? 'Không có chuyến phù hợp' : 'Chưa có chuyến hàng gửi đến bạn'"
          :description="hasFilters ? 'Thử đổi hoặc xóa bộ lọc.' : undefined" />
        <footer class="list-footer">
          <span role="status">{{ filteredTrips.length }} chuyến phù hợp trong tối đa 100 chuyến gần nhất đã tải</span>
          <nav v-if="pages > 1" aria-label="Phân trang hàng nhận">
            <button type="button" :disabled="listPage === 1" @click="listPage--">Trước</button>
            <span>Trang {{ listPage }} / {{ pages }}</span>
            <button type="button" :disabled="listPage === pages" @click="listPage++">Sau</button>
          </nav>
        </footer>
      </template>
    </section>

    <dialog ref="drawer" class="shipment-drawer" aria-labelledby="receipt-detail-title" @cancel.prevent="closeDetail" @click="dismissOnBackdrop($event, closeDetail)">
      <template v-if="selectedTrip">
        <header class="drawer-header">
          <div>
            <p class="eyebrow">Chi tiết chuyến hàng</p>
            <h2 id="receipt-detail-title">{{ selectedTrip.transport_code }}</h2>
            <span class="badge" :data-status="shipmentStatus(selectedTrip)">{{ statusLabels[shipmentStatus(selectedTrip)] }}</span>
          </div>
          <va-button preset="secondary" icon="close" @click="closeDetail">Đóng</va-button>
        </header>

        <div class="drawer-body">
          <va-alert v-if="confirmationError" color="danger" role="alert">{{ confirmationError }}</va-alert>
          <va-alert v-if="notice?.tripId === selectedTrip.id" color="success" role="status">{{ notice.text }}</va-alert>
          <va-alert v-if="loadError" color="danger" role="alert">{{ loadError }}</va-alert>

          <section class="detail-card">
            <h3>Thông tin giao nhận</h3>
            <dl class="facts">
              <div><dt>Nguồn gửi</dt><dd>{{ senderName(selectedTrip) }}</dd></div>
              <div><dt>Tổ chức nhận</dt><dd>{{ authStore.organizationName ?? 'Chưa có thông tin' }}</dd></div>
              <div><dt>Điểm gửi</dt><dd>{{ selectedTrip.from_location }}</dd></div>
              <div><dt>Điểm nhận</dt><dd>{{ selectedTrip.to_location }}</dd></div>
              <div><dt>Ngày gửi</dt><dd>{{ eventTime(selectedTrip.transport_date) }}</dd></div>
              <div><dt>Khối lượng chuyến</dt><dd>{{ number.format(selectedTrip.quantity) }} kg</dd></div>
              <div v-if="selectedTrip.driver"><dt>Tài xế</dt><dd>{{ selectedTrip.driver }}</dd></div>
              <div v-if="selectedTrip.vehicle"><dt>Phương tiện</dt><dd>{{ selectedTrip.vehicle }}</dd></div>
            </dl>
          </section>

          <section v-if="selectedTrip.delivery_reported_at" class="detail-card delivery-report">
            <h3>Báo giao hàng</h3>
            <p>{{ eventTime(selectedTrip.delivery_reported_at) }}</p>
            <p v-if="reportText(selectedTrip)">{{ reportText(selectedTrip) }}</p>
            <a v-if="deliveryProofUrl(selectedTrip)" class="proof-link" :href="deliveryProofUrl(selectedTrip)" target="_blank" rel="noopener noreferrer">
              <img :src="deliveryProofUrl(selectedTrip)" alt="Ảnh bằng chứng giao hàng" loading="lazy" />
              Xem ảnh giao hàng
            </a>
          </section>

          <section class="detail-card">
            <h3>Lô hàng</h3>
            <ul v-if="selectedTrip.lot" class="lot-list">
              <li>
                <strong>{{ selectedTrip.lot.lot_code }}</strong>
                <dl class="facts">
                  <div><dt>Khối lượng lô</dt><dd>{{ number.format(selectedTrip.lot.quantity) }} kg</dd></div>
                  <div v-if="selectedTrip.lot.provenance.batch.species"><dt>Loại thủy sản</dt><dd>{{ SPECIES_LABELS[selectedTrip.lot.provenance.batch.species] ?? selectedTrip.lot.provenance.batch.species }}</dd></div>
                  <div v-if="selectedTrip.lot.provenance.batch.batch_code"><dt>Mã vụ nuôi</dt><dd>{{ selectedTrip.lot.provenance.batch.batch_code }}</dd></div>
                </dl>
                <details v-if="selectedTrip.status === 'DELIVERED'" class="trace-details">
                  <summary>QR truy xuất nguồn gốc</summary>
                  <LotQrPanel :key="selectedTrip.id" :api-path="`/transports/${selectedTrip.id}/qr`" :lot-code="selectedTrip.lot.lot_code" />
                </details>
              </li>
            </ul>
            <p v-else>Chưa có thông tin lô liên kết.</p>
          </section>

          <section v-if="selectedTrip.events?.length" class="detail-card">
            <h3>Hành trình giao hàng</h3>
            <ol class="event-list">
              <li v-for="(event, index) in selectedTrip.events" :key="event.id"
                :class="{ latest: index === selectedTrip.events.length - 1 }">
                <strong>{{ eventLabel(event) }}</strong>
                <time :datetime="event.occurred_at">{{ eventTime(event.occurred_at) }}</time>
                <p v-if="eventSummary(event)">{{ eventSummary(event) }}</p>
              </li>
            </ol>
          </section>
        </div>

        <footer v-if="shipmentStatus(selectedTrip) === 'PENDING'" class="drawer-footer">
          <p>Kiểm tra hàng thực tế trước khi xác nhận.</p>
          <va-button color="primary" :loading="busyId === selectedTrip.id"
            :disabled="Boolean(busyId) || loading" @click="confirmReceipt(selectedTrip)">
            Xác nhận nhận hàng
          </va-button>
        </footer>
      </template>
    </dialog>
  </main>
</template>

<style scoped>
.receipts-page {
  width: min(100%, 1320px);
  margin: 0 auto;
  min-width: 0;
  color: var(--app-ink);
}
.message { margin-bottom: 16px; }
.list-panel {
  background: var(--app-surface);
  border: 1px solid var(--app-line);
  border-radius: var(--app-radius);
  min-width: 0;
}
.status-tabs, .filters, .list-footer {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding: 14px 18px;
  align-items: center;
}
.status-tabs { border-bottom: 1px solid var(--app-line); }
.status-tabs button, .list-footer button, .text-button, .detail-link {
  min-height: var(--app-control-height);
  padding: 8px 12px;
  border: 1px solid var(--app-line);
  border-radius: var(--app-control-radius);
  background: var(--app-surface);
  color: var(--app-primary-dark);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.status-tabs button { border-color: transparent; color: var(--app-muted); }
.status-tabs button[aria-pressed="true"], .detail-link:hover, button:hover:not(:disabled) {
  background: var(--app-primary-soft);
  color: var(--app-primary-dark);
}
.list-footer button:disabled { opacity: .5; cursor: default; }
.filters { align-items: end; }
.filters label, .sender-field { display: grid; flex: 1 1 135px; min-width: 0; gap: 5px; font-size: .8rem; font-weight: 650; }
.sender-field label { display: block; }
.filters .search-field { flex-grow: 2; min-width: min(225px, 100%); }
.filters input, .filters select {
  width: 100%;
  min-width: 0;
  min-height: var(--app-control-height);
  padding: 6px 9px;
  border: 1px solid var(--app-control-line);
  border-radius: var(--app-control-radius);
  color: var(--app-ink);
  background: var(--app-surface);
  font: inherit;
  font-size: 1rem;
}
.filter-error { margin: 0 18px 14px; color: #8f3027; }
.shipments { width: 100%; border-collapse: collapse; font-size: .875rem; overflow-wrap: anywhere; }
.shipments th, .shipments td { text-align: left; padding: var(--app-space-3); border-bottom: 1px solid var(--app-line); }
.shipments thead { background: var(--app-primary-soft); color: var(--app-primary-dark); }
.shipments tbody tr:hover { background: var(--app-canvas); }
.trip-code { color: var(--app-primary-dark); }
.detail-link { display: inline-flex; align-items: center; font-size: .82rem; text-decoration: none; }
.mobile-label { display: none; }
.badge { display: inline-block; border-radius: var(--app-pill-radius); padding: var(--app-space-1) var(--app-space-2); background: var(--app-canvas); color: var(--app-ink); font-size: var(--app-text-xs); font-weight: 650; }
.badge[data-status="IN_TRANSIT"] { background: var(--app-info-soft); color: var(--app-info); }
.badge[data-status="PENDING"] { background: var(--app-warning-soft); color: var(--app-warning); }
.badge[data-status="DELIVERED"] { background: var(--app-success-soft); color: var(--app-success); }
.badge[data-status="CANCELLED"] { background: var(--app-danger-soft); color: var(--app-danger); }
.list-footer { justify-content: space-between; color: var(--app-muted); font-size: .8rem; }
.list-footer nav { display: flex; align-items: center; gap: 8px; }
.shipment-drawer {
  position: fixed;
  inset: 0 0 0 auto;
  width: min(100%, 640px);
  max-width: none;
  height: 100dvh;
  max-height: none;
  margin: 0;
  padding: 0;
  border: 0;
  background: var(--app-canvas);
  color: var(--app-ink);
  box-shadow: -10px 0 36px rgb(0 0 0 / 14%);
}
.shipment-drawer[open] { display: flex; flex-direction: column; }
.shipment-drawer::backdrop { background: rgb(7 28 36 / 45%); }
.drawer-header, .drawer-footer { padding: 16px 22px; background: var(--app-surface); }
.drawer-header { display: flex; align-items: start; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--app-line); overflow-wrap: anywhere; }
.drawer-header h2 { margin: 3px 0 8px; font-size: var(--app-text-section); }
.eyebrow, dt, time, .drawer-footer p { color: var(--app-muted); font-size: .82rem; }
.drawer-body { min-height: 0; flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: 16px 22px; }
.drawer-body > * + * { margin-top: 14px; }
.drawer-footer { border-top: 1px solid var(--app-line); display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; }
p, h3, dl, dd { margin: 0; }
h3 { margin-bottom: 10px; font-size: 1rem; }
.detail-card { padding: 16px; background: var(--app-surface); border: 1px solid var(--app-line); border-radius: var(--app-radius); overflow-wrap: anywhere; }
.facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
dd { margin-top: 3px; font-weight: 600; }
.delivery-report p + p { margin-top: 6px; }
.proof-link { display: grid; justify-items: start; gap: 6px; margin-top: 12px; color: var(--app-primary-dark); text-decoration: underline; }
.proof-link img { max-width: 100%; max-height: 180px; border-radius: var(--app-control-radius); }
.lot-list, .event-list { margin: 0; padding: 0; list-style: none; }
.lot-list .facts { margin-top: 10px; }
.trace-details { margin-top: 12px; }
.trace-details summary { cursor: pointer; color: var(--app-primary-dark); font-weight: 600; min-height: var(--app-control-height); padding-block: 10px; }
.event-list { margin-left: 5px; border-left: 1px solid var(--app-line); }
.event-list li { position: relative; padding: 0 0 14px 16px; }
.event-list li:last-child { padding-bottom: 0; }
.event-list li::before { content: ''; position: absolute; left: -4px; top: 7px; width: 7px; height: 7px; border-radius: 50%; background: var(--app-muted); }
.event-list .latest { color: var(--app-primary-dark); }
.event-list .latest::before { background: var(--app-primary); }
.event-list time { display: block; }
@media (max-width: 1000px) {
  .shipments thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .shipments, .shipments tbody { display: block; }
  .shipments tr { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--app-line); }
  .shipments th, .shipments td { border: 0; padding: 0; }
  .trip-code, .row-action { grid-column: 1 / -1; }
  .mobile-label { display: block; color: var(--app-muted); font-size: .75rem; margin-bottom: 3px; }
}
@media (max-width: 600px) {
  .shipment-drawer { width: 100%; }
  .drawer-header, .drawer-body, .drawer-footer { padding-inline: 14px; }
  .drawer-footer :deep(.va-button) { width: 100%; }
}
</style>
