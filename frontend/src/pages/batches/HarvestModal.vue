<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { VaModal, VaButton, VaInput, VaTextarea, VaSelect, VaAlert, VaInnerLoading, VaCard, VaCardContent, VaBadge } from 'vuestic-ui'
import { api } from '../../api/client'
import LotQrPanel from '../../components/LotQrPanel.vue'
import { SPECIES_LABELS, type BatchItem, type HarvestLot, type HarvestCreateResponse, type LotTransport, type TransportEvent, type TransportRecipient } from '../../types'

const props = defineProps<{ batch: BatchItem; farmId: string; pondId: string }>()
const emit = defineEmits<{ close: []; updated: [batch: BatchItem] }>()
const lots = ref<HarvestLot[]>([])
const loading = ref(false); const saving = ref(false); const error = ref(''); const notice = ref('')
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const form = reactive({ harvestDate: today, quantity: '' as string | number, isFinal: false, note: '' })
const requestId = ref(crypto.randomUUID())
const transportLot = ref<HarvestLot | null>(null)
const transports = ref<LotTransport[]>([])
const recipients = ref<TransportRecipient[]>([])
const recipientAssignments = ref<Record<string, string>>({})
const transportSaving = ref(false)
const transportDataLoaded = ref(false)
const transportLoading = ref(false); const transportError = ref(''); const transportNotice = ref('')
let transportVersion = 0
let active = true
onUnmounted(() => { active = false; ++transportVersion })
function closeTransport() { if (transportSaving.value) return; ++transportVersion; transportLot.value = null; transportLoading.value = false }
const remainingTransportQuantity = computed(() => {
  if (!transportLot.value) return 0
  const lotCents = Math.round(Number(transportLot.value.quantity) * 100)
  const shippedCents = transports.value
    .filter((trip) => trip.status !== 'CANCELLED')
    .reduce((total, trip) => total + Math.round(Number(trip.quantity) * 100), 0)
  return Math.max(0, lotCents - shippedCents) / 100
})
const localDateTime = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)
const transportRequestId = ref(crypto.randomUUID())
const transportForm = reactive({ transportDate: localDateTime(), quantity: '' as string | number, fromLocation: '', toLocation: '', recipientOrganizationId: '', note: '' })
const options = [{ value: false, label: 'Thu hoạch một phần, tiếp tục nuôi' }, { value: true, label: 'Kết thúc thu hoạch vụ này' }]
const base = `/farms/${props.farmId}/ponds/${props.pondId}/batches/${props.batch.id}/harvests`
const labels: Record<string, string> = { SUCCESS: 'Đã ghi blockchain', PENDING: 'Chưa gửi blockchain', FAILED: 'Ghi blockchain thất bại', UNKNOWN: 'Chưa xác định kết quả' }
const transportLabels: Record<string, string> = { PLANNING: 'Đang chờ người vận chuyển nhận', IN_TRANSIT: 'Đang vận chuyển', DELIVERED: 'Đã giao', CANCELLED: 'Đã hủy' }
const transportEventLabels: Record<string, string> = { REQUESTED: 'Tạo yêu cầu', CLAIMED: 'Người vận chuyển nhận chuyến', IN_TRANSIT: 'Bắt đầu vận chuyển', CHECKPOINT: 'Điểm kiểm tra', DELIVERY_REPORTED: 'Người vận chuyển báo giao', RECIPIENT_ASSIGNED: 'Gán nhà phân phối nhận', TRACKING_UPDATE: 'Cập nhật hành trình', DELIVERED: 'Nhà phân phối xác nhận đã nhận', CANCELLED: 'Hủy chuyến' }
const blockchainStatusLabels: Record<string, string> = { SUCCESS: 'Đã xác nhận trên blockchain', PENDING: 'Đang chờ blockchain', FAILED: 'Sẽ tự động thử lại' }
const harvestDay = (value: string) => new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(value))
const eventTime = (value: string) => new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
function transportEventSummary(event: TransportEvent) {
  const payload = event.payload
  const value = (key: string) => payload[key] == null ? '' : String(payload[key])
  if (event.event_type === 'REQUESTED') return `${value('quantity')} kg · ${value('fromLocation')} → ${value('toLocation')}`
  if (event.event_type === 'IN_TRANSIT') return [value('vehicle'), value('driver'), value('temperature') && `${value('temperature')} °C`].filter(Boolean).join(' · ')
  if (event.event_type === 'CHECKPOINT') return [value('temperature') && `${value('temperature')} °C`, value('location'), value('note')].filter(Boolean).join(' · ')
  if (event.event_type === 'TRACKING_UPDATE') {
    const labels: Record<string, string> = {
      PICKED_UP: 'Đã lấy hàng', IN_TRANSIT: 'Đang trên đường', AT_SORTING_FACILITY: 'Đã đến điểm trung chuyển',
      DEPARTED_FACILITY: 'Đã rời điểm trung chuyển', OUT_FOR_DELIVERY: 'Đang giao tới người nhận',
      DELIVERY_ATTEMPT_FAILED: 'Giao hàng chưa thành công', DELIVERED_REPORTED: 'Giao hàng thành công · chờ nhà phân phối xác nhận', OTHER: 'Cập nhật khác',
    }
    return [labels[value('trackingStatus')] ?? value('trackingStatus'), value('location'), value('temperature') && `${value('temperature')} °C`, value('note')].filter(Boolean).join(' · ')
  }
  const report = payload.deliveryReport && typeof payload.deliveryReport === 'object' ? payload.deliveryReport as Record<string, unknown> : {}
  if (event.event_type === 'DELIVERY_REPORTED' || event.event_type === 'DELIVERED') {
    return [report.recipientName && `Người nhận: ${String(report.recipientName)}`, report.receiptReference && `Phiếu: ${String(report.receiptReference)}`].filter(Boolean).join(' · ')
  }
  return ''
}
function transportDeliveryProof(event: TransportEvent) {
  const report = event.payload.deliveryReport
  return report && typeof report === 'object' && typeof (report as Record<string, unknown>).proofImageUrl === 'string'
    ? String((report as Record<string, unknown>).proofImageUrl)
    : ''
}

async function load() {
  loading.value = true; error.value = ''
  try { const result = await api.get<{ items: HarvestLot[] }>(base); if (active) lots.value = result.items }
  catch (e) { error.value = e instanceof Error ? e.message : 'Không tải được các lô thu hoạch' }
  finally { loading.value = false }
}
async function submit() {
  if (saving.value || loading.value) return
  error.value = ''; notice.value = ''
  if (!form.harvestDate || !Number.isFinite(Number(form.quantity)) || Number(form.quantity) <= 0) {
    error.value = 'Vui lòng nhập ngày thu hoạch và khối lượng lớn hơn 0.'; return
  }
  saving.value = true
  try {
    const result = await api.post<HarvestCreateResponse>(base, { ...form, quantity: Number(form.quantity), requestId: requestId.value })
    if (!active) return
    emit('updated', result.batch)
    const lot: HarvestLot = { ...result.lot, harvest: result.harvest,
      blockchain: result.blockchain.status === 'UNKNOWN' ? null : {
        status: result.blockchain.status, transaction_hash: result.blockchain.transactionHash, data_hash: result.blockchain.dataHash,
      } }
    lots.value = [lot, ...lots.value.filter((item) => item.id !== lot.id)]
    notice.value = `Đã lưu thu hoạch và tạo lô ${lot.lot_code}. ${labels[result.blockchain.status]}.`
    requestId.value = crypto.randomUUID(); form.quantity = ''; form.note = ''
  } catch (e) { error.value = e instanceof Error ? e.message : 'Không lưu được thu hoạch' }
  finally { saving.value = false }
}
async function openTransport(lot: HarvestLot) {
  if (transportSaving.value) return
  const version = ++transportVersion
  const sameLot = transportLot.value?.id === lot.id
  transportLoading.value = true; transportError.value = ''; transportNotice.value = ''
  if (!sameLot) {
    transportRequestId.value = crypto.randomUUID()
    Object.assign(transportForm, { transportDate: localDateTime(), quantity: '', fromLocation: '', toLocation: '', recipientOrganizationId: '', note: '' })
  }
  transportLot.value = lot; transports.value = []; recipients.value = []; recipientAssignments.value = {}; transportDataLoaded.value = false
  try {
    const [transportResult, recipientResult] = await Promise.all([
      api.get<{ items: LotTransport[] }>(`${base.replace('/harvests', `/lots/${lot.id}/transports`)}`),
      api.get<{ items: TransportRecipient[] }>('/transports/recipients'),
    ])
    if (!active || version !== transportVersion) return
    transports.value = transportResult.items
    recipients.value = recipientResult.items
    recipientAssignments.value = Object.fromEntries(transportResult.items.map((trip) => [trip.id, '']))
    transportDataLoaded.value = true
  } catch (e) { if (active && version === transportVersion) transportError.value = e instanceof Error ? e.message : 'Không tải được chuyến vận chuyển' }
  finally { if (active && version === transportVersion) transportLoading.value = false }
}
function chooseRecipient(id: string) {
  transportForm.recipientOrganizationId = id
  const recipient = recipients.value.find((item) => item.id === id)
  if (recipient?.address) transportForm.toLocation = recipient.address
}
function recipientName(trip: LotTransport) {
  return recipients.value.find((recipient) => recipient.id === trip.recipient_organization_id)?.name ?? 'Đã gán nhà phân phối'
}
async function assignTripRecipient(trip: LotTransport) {
  const recipientOrganizationId = recipientAssignments.value[trip.id]
  if (!recipientOrganizationId || transportSaving.value || !transportLot.value) return
  transportSaving.value = true; transportError.value = ''; transportNotice.value = ''
  try {
    const path = base.replace('/harvests', `/lots/${transportLot.value.id}/transports`)
    await api.patch(`/transports/${trip.id}/recipient`, { recipientOrganizationId })
    const result = await api.get<{ items: LotTransport[] }>(path)
    if (!active) return
    transports.value = result.items
    recipientAssignments.value = Object.fromEntries(transports.value.map((item) => [item.id, '']))
    transportNotice.value = `Đã gán nhà phân phối nhận chuyến ${trip.transport_code}.`
  } catch (e) { transportError.value = e instanceof Error ? e.message : 'Không gán được nhà phân phối cho chuyến' }
  finally { transportSaving.value = false }
}
async function saveTransport() {
  if (!transportLot.value || transportSaving.value || !transportDataLoaded.value || transportLoading.value) return
  transportError.value = ''
  const qty = Number(transportForm.quantity)
  if (!transportForm.transportDate || Number.isNaN(new Date(transportForm.transportDate).getTime())) { transportError.value = 'Thời gian vận chuyển không hợp lệ.'; return }
  if (!transportForm.fromLocation.trim() || transportForm.fromLocation.trim().length > 500) { transportError.value = 'Điểm đi là bắt buộc và tối đa 500 ký tự.'; return }
  if (!transportForm.toLocation.trim() || transportForm.toLocation.trim().length > 500) { transportError.value = 'Điểm đến là bắt buộc và tối đa 500 ký tự.'; return }
  if (transportForm.fromLocation.trim().toLocaleLowerCase('vi') === transportForm.toLocation.trim().toLocaleLowerCase('vi')) { transportError.value = 'Điểm đi và điểm đến phải khác nhau.'; return }
  if (!transportForm.recipientOrganizationId) { transportError.value = 'Chọn nhà phân phối nhận hàng.'; return }
  if (!Number.isFinite(qty) || qty <= 0 || qty > remainingTransportQuantity.value || Math.abs(qty * 100 - Math.round(qty * 100)) > 0.001) { transportError.value = 'Khối lượng phải lớn hơn 0, không vượt khối lượng còn lại và tối đa 2 chữ số thập phân.'; return }
  if (transportForm.note.trim().length > 5000) { transportError.value = 'Ghi chú không được vượt quá 5000 ký tự.'; return }
  transportSaving.value = true
  try {
    const path = base.replace('/harvests', `/lots/${transportLot.value.id}/transports`)
    const result = await api.post<{ transport: LotTransport; replayed: boolean }>(path, {
      transportDate: new Date(transportForm.transportDate).toISOString(),
      quantity: qty, fromLocation: transportForm.fromLocation.trim(), toLocation: transportForm.toLocation.trim(),
      recipientOrganizationId: transportForm.recipientOrganizationId, note: transportForm.note.trim(), requestId: transportRequestId.value,
    })
    if (!active) return
    transports.value = [result.transport, ...transports.value]
    transportNotice.value = `Đã tạo chuyến ${result.transport.transport_code}.`
    transportRequestId.value = crypto.randomUUID()
    Object.assign(transportForm, { transportDate: localDateTime(), quantity: '', fromLocation: '', toLocation: '', recipientOrganizationId: '', note: '' })
  } catch (e) { transportError.value = e instanceof Error ? e.message : 'Không lưu được chuyến vận chuyển' }
  finally { transportSaving.value = false }
}
onMounted(load)
</script>

<template>
  <va-modal :model-value="true" hide-default-actions size="large" :no-dismiss="saving || transportSaving"
    @update:model-value="(value: boolean) => { if (!value && !saving && !transportSaving) emit('close') }">
    <template #header><h2>Thu hoạch và lô hàng — {{ batch.batch_code }}</h2></template>
    <p>Mỗi lần thu hoạch tạo một lô riêng. Tổng sản lượng: {{ batch.yield_quantity ?? 0 }} kg.</p>
    <va-alert v-if="error" color="danger" class="message" role="alert">{{ error }}</va-alert>
    <va-alert v-if="notice" color="info" class="message">{{ notice }} Không cần gửi lại lần thu hoạch đã lưu.</va-alert>
    <form v-if="['GROWING', 'READY_FOR_HARVEST'].includes(batch.status)" class="harvest-form" @submit.prevent="submit">
      <va-input v-model="form.harvestDate" type="date" label="Ngày thu hoạch *" :min="batch.stocking_date.slice(0, 10)" :max="today" :disabled="saving" />
      <va-input v-model="form.quantity" type="number" label="Khối lượng (kg) *" min="0.01" step="0.01" :disabled="saving" />
      <va-select v-model="form.isFinal" :options="options" value-by="value" text-by="label" label="Loại thu hoạch" :disabled="saving" />
      <va-textarea v-model="form.note" label="Ghi chú" maxlength="5000" :disabled="saving" />
      <va-button type="submit" :loading="saving" :disabled="saving || loading">Lưu thu hoạch và tạo lô</va-button>
    </form>
    <p v-else>Vụ hiện không thể ghi thêm thu hoạch.</p>
    <va-button v-if="error && !saving" preset="secondary" size="small" @click="load">Tải lại danh sách lô</va-button>
    <h3>Các lô đã tạo</h3>
    <va-inner-loading :loading="loading">
      <div class="lot-list">
        <va-card v-for="lot in lots" :key="lot.id">
          <va-card-content>
            <strong class="hash">{{ lot.lot_code }}</strong>
            <p>{{ harvestDay(lot.harvest.harvest_date) }} · {{ lot.quantity.toLocaleString('vi-VN') }} kg · {{ lot.harvest.is_final ? 'Kết thúc thu hoạch' : 'Thu một phần' }}</p>
            <p>Nguồn: {{ lot.provenance.farm.name }} / {{ lot.provenance.pond.name }} / {{ lot.provenance.batch.batch_code }}</p>
            <p>{{ SPECIES_LABELS[lot.provenance.batch.species] }} · Giống: {{ lot.provenance.batch.seed_source || 'Chưa ghi nguồn giống' }}</p>
            <p v-if="lot.harvest.note">{{ lot.harvest.note }}</p>
            <va-badge :color="lot.blockchain?.status === 'SUCCESS' ? 'success' : 'warning'">{{ labels[lot.blockchain?.status ?? 'UNKNOWN'] }}</va-badge>
            <details class="technical-disclosure"><summary>Thông tin xác thực Blockchain</summary>
            <p class="hash">Sự kiện: {{ lot.blockchain_event_id }}</p>
            <p v-if="lot.blockchain" class="hash">Hash dữ liệu: {{ lot.blockchain.data_hash }}</p>
            <p v-if="lot.blockchain?.transaction_hash" class="hash">Giao dịch: {{ lot.blockchain.transaction_hash }}</p>
            </details>
            <va-button size="small" preset="secondary" icon="local_shipping" @click="openTransport(lot)">Vận chuyển lô</va-button>
            <details class="technical-disclosure"><summary>QR truy xuất nguồn gốc</summary>
            <LotQrPanel :api-path="`/farms/${farmId}/ponds/${pondId}/batches/${batch.id}/lots/${lot.id}/qr`" :lot-code="lot.lot_code" />
            </details>
          </va-card-content>
        </va-card>
        <p v-if="!loading && !error && !lots.length">Chưa có lô hàng từ thu hoạch.</p>
      </div>
    </va-inner-loading>
    <va-modal v-if="transportLot" :model-value="true" hide-default-actions size="large" :no-dismiss="transportSaving" @update:model-value="(v: boolean) => { if (!v) closeTransport() }">
      <template #header><h2>Vận chuyển {{ transportLot.lot_code }}</h2></template>
      <p>Khối lượng lô: {{ transportLot.quantity }} kg</p>
      <p>Chọn nhà phân phối nhận lô. Người vận chuyển cập nhật tiến độ; nhà phân phối xác nhận đã nhận hàng.</p>
      <va-alert v-if="transportDataLoaded && !recipients.length" color="warning" class="message">Chưa có nhà phân phối liên kết với tài khoản đang hoạt động.</va-alert>
      <va-alert v-if="transportError" color="danger" class="message" role="alert">{{ transportError }} <va-button v-if="!transportDataLoaded" preset="secondary" size="small" @click="openTransport(transportLot)">Thử lại</va-button></va-alert>
      <va-alert v-if="transportNotice" color="success" class="message" role="status">{{ transportNotice }}</va-alert>
      <p v-if="transportLoading" role="status">Đang tải lịch sử để tính khối lượng còn lại…</p>
      <template v-if="transportDataLoaded">
        <p>Khối lượng còn có thể vận chuyển: <strong>{{ remainingTransportQuantity.toLocaleString('vi-VN') }} kg</strong></p>
        <va-alert v-if="remainingTransportQuantity === 0" color="success" class="message" role="status">Lô này đã vận chuyển đủ {{ transportLot.quantity.toLocaleString('vi-VN') }} kg. Không thể tạo thêm chuyến.</va-alert>
        <form v-else class="harvest-form" @submit.prevent="saveTransport">
          <p class="generated-code-hint wide">Mã chuyến sẽ được tạo tự động khi lưu.</p>
          <va-input :disabled="transportSaving" v-model="transportForm.transportDate" type="datetime-local" label="Thời gian vận chuyển *" />
          <va-input :disabled="transportSaving" v-model="transportForm.quantity" type="number" min="0.01" step="0.01" :max="remainingTransportQuantity" label="Khối lượng vận chuyển (kg) *" />
          <va-input :disabled="transportSaving" v-model="transportForm.fromLocation" label="Điểm đi *" maxlength="500" />
          <va-input :disabled="transportSaving" v-model="transportForm.toLocation" label="Điểm đến *" maxlength="500" />
          <va-select :disabled="transportSaving" :model-value="transportForm.recipientOrganizationId" :options="recipients" value-by="id" text-by="name" label="Nhà phân phối nhận hàng *" @update:model-value="chooseRecipient(String($event ?? ''))" />
          <va-textarea :disabled="transportSaving" v-model="transportForm.note" label="Ghi chú" maxlength="5000" class="wide" />
          <va-button type="submit" :loading="transportSaving" :disabled="!recipients.length || transportSaving || !transportDataLoaded">Tạo chuyến</va-button>
        </form>
      </template>
      <h3>Lịch sử vận chuyển</h3>
      <va-card v-for="trip in transports" :key="trip.id" class="trip-card"><va-card-content>
        <strong>{{ trip.transport_code }}</strong> · {{ trip.quantity }} kg · {{ trip.delivery_reported_at && trip.status === 'IN_TRANSIT' ? 'Chờ nhà phân phối nhận hàng xác nhận' : trip.status }}
        <p>{{ trip.from_location }} → {{ trip.to_location }} · {{ trip.vehicle || 'Chưa có phương tiện' }} · {{ trip.temperature ?? '—' }} °C</p>
        <p v-if="trip.recipient_organization_id">Nhà phân phối nhận: {{ recipientName(trip) }}</p>
        <div v-else-if="!['DELIVERED', 'CANCELLED'].includes(trip.status)" class="recipient-assignment">
          <va-select v-model="recipientAssignments[trip.id]" :options="recipients" value-by="id" text-by="name" label="Gán nhà phân phối nhận chuyến cũ *" />
          <va-button size="small" preset="secondary" :loading="transportSaving" :disabled="!recipientAssignments[trip.id] || transportSaving" @click="assignTripRecipient(trip)">Gán nhà phân phối</va-button>
        </div>
        <div class="trip-actions">
          <span>{{ trip.delivery_reported_at && trip.status === 'IN_TRANSIT' ? 'Đã báo giao · chờ bên nhận xác nhận' : transportLabels[trip.status] || trip.status }}</span>
          <va-badge v-if="trip.blockchain" :color="trip.blockchain.status === 'SUCCESS' ? 'success' : trip.blockchain.status === 'FAILED' ? 'danger' : 'warning'">{{ blockchainStatusLabels[trip.blockchain.status] || trip.blockchain.status }}</va-badge>
        </div>
        <details v-if="trip.events?.length" class="transport-event-history">
          <summary>Lịch sử xác thực · {{ trip.events.length }} mốc</summary>
          <ol>
            <li v-for="event in trip.events" :key="event.id">
              <strong>{{ transportEventLabels[event.event_type] || event.event_type }}</strong>
              <small>{{ eventTime(event.occurred_at) }} · {{ blockchainStatusLabels[event.blockchain_status] || event.blockchain_status }}</small>
              <small v-if="transportEventSummary(event)">{{ transportEventSummary(event) }}</small>
              <a v-if="transportDeliveryProof(event)" :href="transportDeliveryProof(event)" target="_blank" rel="noopener noreferrer">Xem ảnh bằng chứng giao hàng</a>
              <code v-if="event.data_hash">Hash dữ liệu: {{ event.data_hash }}</code>
              <code v-if="event.previous_hash">Hash mốc trước: {{ event.previous_hash }}</code>
              <code v-if="event.transaction_hash">Giao dịch: {{ event.transaction_hash }}</code>
              <small v-if="event.last_error && event.blockchain_status === 'FAILED'">{{ event.last_error }}</small>
            </li>
          </ol>
        </details>
        <p v-else class="legacy-event-note">Chuyến này chưa có timeline sự kiện. Các chuyến được tạo sau khi bật lịch sử blockchain sẽ hiển thị từng mốc tại đây.</p>
      </va-card-content></va-card>
      <p v-if="transportDataLoaded && !transports.length">Chưa có chuyến vận chuyển cho lô này.</p>
      <va-button preset="secondary" :disabled="transportSaving" @click="closeTransport">Đóng</va-button>
    </va-modal>
    <va-button preset="secondary" :disabled="saving || transportSaving" @click="emit('close')">Đóng</va-button>
  </va-modal>
</template>

<style scoped>
.harvest-form, .lot-list { display: grid; gap: 1rem; margin: 1rem 0; }
.hash { overflow-wrap: anywhere; }
.message { margin: 1rem 0; }
.trip-card { margin: .75rem 0; }
.recipient-assignment { flex-wrap:wrap; display: flex; align-items: end; gap: .75rem; margin: .6rem 0; }
.trip-actions { display: flex; gap: .5rem; flex-wrap: wrap; }
.transport-event-history { margin-top: .8rem; border-top: 1px solid #e8efed; color: #31565a; }
.transport-event-history summary { padding: .7rem 0 .2rem; color: var(--app-primary); font-size: .8rem; font-weight: 700; cursor: pointer; }
.transport-event-history ol { display: grid; gap: .6rem; padding-left: 1.2rem; }
.transport-event-history li { display: grid; gap: .2rem; }
.transport-event-history small { color: var(--app-muted); font-size: .72rem; }
.transport-event-history code { overflow-wrap: anywhere; color: var(--app-muted); font-size: .68rem; white-space: normal; }
.legacy-event-note { color: #7c8d8d; font-size: .75rem; }
.generated-code-hint { padding: .4rem 0; color: var(--app-muted); font-size: .8rem; }
.wide { grid-column: 1 / -1; }
.technical-disclosure { margin: 16px 0; border-top: 1px solid var(--app-line); }
.technical-disclosure summary { min-height: 44px; padding: 12px 0; cursor: pointer; color: var(--app-primary-dark); font-size: 13px; font-weight: 600; }
.lot-list > :deep(.va-card) { border: 1px solid var(--app-line); border-radius: var(--app-radius); }
.harvest-form { padding: 20px; border: 1px solid var(--app-line); border-radius: var(--app-radius); background: var(--app-canvas); }
</style>
