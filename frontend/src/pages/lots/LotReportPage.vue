<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { VaAlert, VaButton } from 'vuestic-ui'
import LotPackagingDetails from '../../components/LotPackagingDetails.vue'
import { api } from '../../api/client'
import LoadingState from '../../components/LoadingState.vue'
import type { LotReportResponse } from '../../types/lots'
import type { PublicTraceResponse } from '../../types/trace'
import { date, quantity, speciesLabel } from './lot-utils'
import './report-print.css'

const route = useRoute(); const router = useRouter()
const publicReport = computed(() => route.name === 'trace-report')
const report = ref<LotReportResponse | null>(null)
const loading = ref(false); const error = ref(''); const revoked = ref(false)
const previousTitle = document.title
let version = 0
const trace = computed(() => report.value?.trace)
const sourceUrl = computed(() => new URL(router.resolve({ path: route.path }).href, window.location.origin).href)
const proofLabels: Record<string, string> = { MATCH: 'Hash hồ sơ thu hoạch khớp Blockchain', MISMATCH: 'Hash hồ sơ thu hoạch không khớp Blockchain', PENDING: 'Chưa có bằng chứng thu hoạch được xác nhận để đối soát', UNAVAILABLE: 'Không thể đối soát Blockchain tại thời điểm lập báo cáo' }
const publicProofLabels = {
  MATCH: 'Đã kiểm tra. Thông tin thu hoạch khớp với hồ sơ đã lưu.',
  MISMATCH: 'Thông tin thu hoạch có sai lệch so với hồ sơ đã lưu. Vui lòng hỏi nhà phân phối.',
  PENDING: 'Thông tin thu hoạch đang chờ được kiểm tra.',
  UNAVAILABLE: 'Tạm thời chưa thể kiểm tra thông tin thu hoạch. Vui lòng thử lại sau.',
}
const chainLabels: Record<string, string> = { SUCCESS: 'Đã ghi nhận', PENDING: 'Đang chờ', FAILED: 'Ghi nhận thất bại' }
const logLabels: Record<string, string> = { FEEDING: 'Thức ăn', MEDICINE: 'Thuốc / hóa chất', WATER_QUALITY: 'Chất lượng nước', ENVIRONMENT: 'Môi trường', CARE: 'Chăm sóc', MORTALITY: 'Hao hụt', OTHER: 'Khác' }
const detailLabels: Record<string, string> = { feedType: 'Thức ăn', feedAmount: 'Lượng thức ăn (kg)', medicineName: 'Thuốc / hóa chất', dose: 'Liều lượng', temperature: 'Nhiệt độ (°C)', salinity: 'Độ mặn (‰)', ph: 'pH', dissolvedOxygen: 'Oxy hòa tan (mg/L)', mortalityCount: 'Số con chết' }
const tripLabels: Record<string, string> = { PLANNING: 'Chờ nhận chuyến', IN_TRANSIT: 'Đang vận chuyển', DELIVERED: 'Đã xác nhận nhận hàng', CANCELLED: 'Đã hủy' }
const eventLabels: Record<string, string> = { REQUESTED: 'Tạo yêu cầu', CLAIMED: 'Nhận chuyến', IN_TRANSIT: 'Khởi hành', CHECKPOINT: 'Điểm kiểm tra', RECIPIENT_ASSIGNED: 'Chọn bên nhận', TRACKING_UPDATE: 'Cập nhật hành trình', DELIVERY_REPORTED: 'Báo giao hàng', DELIVERED: 'Xác nhận nhận hàng', CANCELLED: 'Hủy chuyến' }
const trackingLabels: Record<string, string> = { PICKED_UP: 'Đã lấy hàng', IN_TRANSIT: 'Đang trên đường', AT_SORTING_FACILITY: 'Đến trung chuyển', DEPARTED_FACILITY: 'Rời trung chuyển', OUT_FOR_DELIVERY: 'Đang giao', DELIVERY_ATTEMPT_FAILED: 'Giao chưa thành công', DELIVERED_REPORTED: 'Báo giao thành công', OTHER: 'Cập nhật khác' }
function details(values: Record<string, string | number | null>) {
  return Object.entries(values).filter(([, value]) => value !== null).map(([key, value]) => `${detailLabels[key] || key}: ${value}`).join('; ') || 'Chưa có chi tiết công khai'
}
async function load() {
  const current = ++version
  loading.value = true; error.value = ''; revoked.value = false; report.value = null
  try {
    let response: LotReportResponse
    if (publicReport.value) {
      const data = await api.get<PublicTraceResponse & { generatedAt: string }>(`/public/trace/${encodeURIComponent(String(route.params.traceCode))}/report`, false)
      if (current !== version) return
      if (data.status === 'REVOKED') { revoked.value = true; return }
      response = { trace: data.trace, generatedAt: data.generatedAt, qrStatus: 'ACTIVE', history: [] }
    } else {
      response = await api.get<LotReportResponse>(`/lots/${encodeURIComponent(String(route.params.lotId))}/report`)
    }
    if (current === version) { report.value = response; document.title = `Bao-cao-truy-xuat-${response.trace.lotCode}` }
  } catch (cause) { if (current === version) error.value = cause instanceof Error ? cause.message : 'Không lập được báo cáo truy xuất' }
  finally { if (current === version) loading.value = false }
}
function printReport() { if (report.value && !loading.value) window.print() }
watch(() => route.fullPath, load, { immediate: true })
onMounted(() => { document.body.dataset.reportPrint = 'true' })
onUnmounted(() => { version++; document.title = previousTitle; delete document.body.dataset.reportPrint })
</script>

<template>
  <main class="page-container lot-report-page" :aria-busy="loading">
    <div class="report-toolbar no-print">
      <RouterLink v-if="publicReport" :to="{ name: 'trace', params: { traceCode: route.params.traceCode } }">← Hồ sơ công khai</RouterLink>
      <RouterLink v-else :to="{ name: 'lots' }">← Danh sách lô hàng</RouterLink>
      <div><va-button preset="secondary" :disabled="loading" @click="load">Lập lại báo cáo</va-button><va-button icon="print" :disabled="!report || loading" @click="printReport">In / Lưu PDF</va-button></div>
    </div>
    <LoadingState v-if="loading" />
    <va-alert v-else-if="error" color="danger" role="alert">{{ error }} <va-button preset="secondary" @click="load">Thử lại</va-button></va-alert>
    <va-alert v-else-if="revoked" color="warning" role="alert">QR đã được thu hồi. Không thể lập báo cáo công khai cho mã này.</va-alert>
    <article v-else-if="report && trace" class="report-document">
      <header class="document-header"><p class="brand">THỦY SẢN XANH · TRUY XUẤT NGUỒN GỐC</p><h1>Báo cáo kết quả truy xuất</h1><p class="lot-code">Lô {{ trace.lotCode }}</p><p>Lập lúc {{ date(report.generatedAt, true) }} (giờ Việt Nam) · {{ publicReport ? 'Bản công khai' : 'Bản quản lý' }}</p></header>
      <p v-if="report.qrStatus === 'REVOKED'" class="report-warning" role="alert">QR của lô này đã thu hồi. Báo cáo quản lý chỉ phục vụ tra soát hồ sơ.</p>
      <section><h2>1. Nguồn gốc và thu hoạch</h2><dl class="origin-grid">
        <div><dt>Cơ sở nuôi</dt><dd>{{ trace.farm.name || 'Chưa có thông tin' }}</dd></div><div><dt>Địa chỉ</dt><dd>{{ trace.farm.address || 'Chưa có thông tin' }}</dd></div>
        <div><dt>Ao nuôi</dt><dd>{{ trace.pond.name }} · {{ trace.pond.code }}</dd></div><div><dt>Vụ nuôi</dt><dd>{{ trace.batch.code }}</dd></div>
        <div><dt>Loài nuôi</dt><dd>{{ speciesLabel(trace.species) }}</dd></div><div><dt>Nguồn giống</dt><dd>{{ trace.batch.seedSource || 'Chưa có thông tin' }}</dd></div>
        <div><dt>Ngày thả giống</dt><dd>{{ date(trace.batch.stockingDate) }}</dd></div><div><dt>Ngày thu hoạch</dt><dd>{{ date(trace.harvestDate) }}</dd></div>
        <div><dt>Khối lượng lô</dt><dd>{{ quantity(trace.quantity) }} kg</dd></div><div><dt>Quy mô hồ sơ</dt><dd>{{ trace.logs.length }} nhật ký · {{ trace.transports.length }} chuyến vận chuyển</dd></div>
      </dl></section>
      <section><h2>2. Kiểm tra thông tin thu hoạch</h2><p class="proof-result" :class="{ mismatch: trace.proof.status === 'MISMATCH' }">{{ publicReport ? publicProofLabels[trace.proof.status] : proofLabels[trace.proof.status] }}</p>
        <p v-if="!publicReport">Trạng thái ghi nhận thu hoạch: {{ chainLabels[trace.proof.recordedStatus || ''] || 'Chưa xác định' }}.</p>
        <p v-if="trace.proof.checkedAt">Thời điểm kiểm tra: {{ date(trace.proof.checkedAt, true) }}.</p>
        <p v-if="!publicReport && trace.proof.transactionHash" class="hash">Mã giao dịch: {{ trace.proof.transactionHash }}</p>
        <p class="scope-note">Nhật ký nuôi và các mốc vận chuyển hiển thị trạng thái ghi nhận do hệ thống lưu.</p>
      </section>
      <section><h2>3. Nhật ký nuôi liên quan</h2><p>Nhật ký đã xác nhận, còn hiệu lực đến hết ngày thu hoạch theo giờ Việt Nam. Nội dung là phiên bản hiện còn hiệu lực tại thời điểm lập báo cáo.</p>
        <p v-if="!trace.logs.length">Chưa có nhật ký đã xác nhận để tổng hợp.</p>
        <div v-else class="table-scroll"><table><thead><tr><th>Ngày ghi nhận</th><th>Hoạt động</th><th>Nội dung</th><th>{{ publicReport ? 'Tr?ng th?i ghi nh?n' : 'Blockchain' }}</th></tr></thead><tbody><tr v-for="(log, index) in trace.logs" :key="index"><td>{{ date(log.date, true) }}</td><td>{{ logLabels[log.type] || log.type }}</td><td>{{ details(log.details) }}</td><td>{{ chainLabels[log.blockchainStatus || ''] || 'Chưa xác định' }}</td></tr></tbody></table></div>
      </section>
      <section><h2>4. Vận chuyển và đơn vị nhận</h2><p v-if="!trace.transports.length">Chưa có thông tin vận chuyển gắn với lô này.</p>
        <article v-for="(trip, index) in trace.transports" :key="index" class="trip-report"><h3>{{ trip.code }}</h3><p>{{ date(trip.date, true) }} · {{ quantity(trip.quantity) }} kg · {{ tripLabels[trip.status] || trip.status }}</p><p>Đơn vị nhận {{ trip.status === 'DELIVERED' ? 'đã xác nhận' : 'dự kiến' }}: {{ trip.recipientName || 'Chưa xác định' }}</p>
          <div v-if="trip.events.length" class="table-scroll"><table><thead><tr><th>Thời điểm</th><th>Mốc hành trình</th><th>Nhiệt độ</th><th>{{ publicReport ? 'Tr?ng th?i ghi nh?n' : 'Blockchain' }}</th></tr></thead><tbody><tr v-for="(event, idx) in trip.events" :key="idx"><td>{{ date(event.date, true) }}</td><td>{{ eventLabels[event.type] || event.type }}<small v-if="event.trackingStatus">{{ trackingLabels[event.trackingStatus] || event.trackingStatus }}</small></td><td>{{ event.temperature == null ? '—' : `${quantity(event.temperature)} °C` }}</td><td>{{ chainLabels[event.blockchainStatus || ''] || 'Chưa xác định' }}</td></tr></tbody></table></div><p v-else>Chưa có mốc hành trình.</p>
        </article>
      </section>
      <section v-if="report.history.length"><h2>5. Lịch sử cập nhật vụ nuôi</h2><div class="table-scroll"><table><thead><tr><th>Phiên bản</th><th>Thời điểm</th><th>Nội dung cập nhật</th></tr></thead><tbody><tr v-for="item in report.history" :key="item.version_number"><td>{{ item.version_number }}</td><td>{{ date(item.created_at, true) }}</td><td>{{ item.correction_reason || 'Khởi tạo vụ nuôi' }}</td></tr></tbody></table></div></section>
      <section><h2>Đóng gói và kiểm định</h2><LotPackagingDetails :items="trace.packaging ?? []" :public-view="publicReport" /></section>
      <footer class="document-footer"><p>Báo cáo phản ánh dữ liệu tại thời điểm lập; nhật ký có thể được đính chính hoặc thu hồi sau đó. Nội dung này không thay thế chứng nhận chất lượng sản phẩm.</p><p class="hash">Nguồn tra cứu: {{ sourceUrl }}</p><p class="no-print">Chọn “In / Lưu PDF”, sau đó chọn máy in hoặc “Lưu dưới dạng PDF” trong hộp thoại của trình duyệt.</p></footer>
    </article>
  </main>
</template>

<style scoped>
.lot-report-page { max-width: 1120px; margin: 0 auto; }
.report-toolbar, .report-toolbar > div { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; } .report-toolbar { justify-content: space-between; margin-bottom: 24px; }
.report-toolbar a { color: var(--app-primary-dark); text-decoration: underline; }
.report-document { background: var(--app-surface, white); padding: clamp(20px, 4vw, 48px); border: 1px solid var(--app-line); border-radius: var(--app-radius); color: var(--app-ink); overflow-wrap: anywhere; }
.document-header { border-bottom: 2px solid var(--app-primary); padding-bottom: 22px; margin-bottom: 24px; } .brand { font-weight: 650; font-size: .8rem; letter-spacing: .05em; color: var(--app-primary-dark); } h1 { font-size: clamp(1.5rem, 3vw, 2rem); margin: 12px 0; } .lot-code { font-weight: 600; }
section { margin: 28px 0; } h2 { font-size: 1.1rem; margin-bottom: 12px; } h3 { font-size: 1rem; } p { margin: 10px 0; line-height: 1.6; }
.origin-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 24px; } dt { font-size: .8rem; color: var(--app-muted); margin-bottom: 4px; } dd { margin: 0; font-weight: 550; }
.proof-result { padding: 12px; background: var(--app-primary-soft); font-weight: 600; border-left: 3px solid var(--app-primary); } .proof-result.mismatch, .report-warning { border-left: 3px solid var(--app-danger, #b64242); background: #fff2f0; color: #8b2525; padding: 12px; }
.scope-note, .document-footer { font-size: .85rem; color: var(--app-muted); } .document-footer { border-top: 1px solid var(--app-line); padding-top: 16px; } .hash { overflow-wrap: anywhere; }
.table-scroll { overflow-x: auto; } table { width: 100%; border-collapse: collapse; font-size: .85rem; text-align: left; } th, td { padding: 10px 8px; border: 1px solid var(--app-line); vertical-align: top; } th { background: var(--app-primary-soft); font-weight: 600; } td small { display: block; margin-top: 4px; }
.trip-report { margin: 18px 0 24px; } @media (max-width: 600px) { .origin-grid { grid-template-columns: 1fr; } }
@media print { .report-document { border: 0; border-radius: 0; padding: 0; color: black; } h1 { font-size: 20pt; } h2 { font-size: 13pt; break-after: avoid; } .document-header { margin-bottom: 12pt; } section { margin: 18pt 0; } .table-scroll { overflow: visible; } table { font-size: 9pt; table-layout: fixed; } th, td { border-color: #bbb; padding: 6pt; overflow-wrap: anywhere; } thead { display: table-header-group; } tr, .origin-grid > div { break-inside: avoid; } .origin-grid { grid-template-columns: 1fr 1fr; } .no-print { display: none !important; } }
</style>
