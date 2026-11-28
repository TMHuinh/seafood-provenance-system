<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { VaAlert, VaButton } from 'vuestic-ui'
import LotPackagingDetails from '../../components/LotPackagingDetails.vue'
import { api, ApiError } from '../../api/client'
import { FARMING_LOG_TYPE_LABELS, SPECIES_LABELS } from '../../types'
import type { PublicTraceResponse } from '../../types/trace'
import TraceImage from './TraceImage.vue'
import CollectionToolbar from '../../components/CollectionToolbar.vue'
import { summarizeLogs, filterLogs } from './trace-logs'

const route = useRoute()
const result = ref<PublicTraceResponse | null>(null)
const loading = ref(false)
const error = ref('')
const filters = reactive({ type: '', query: '', from: '', to: '' })
const logPage = ref(1)
const journal = ref<HTMLDetailsElement | null>(null)
const logs = computed(() => (result.value?.status === 'ACTIVE' ? result.value.trace.logs : []))
const summary = computed(() => summarizeLogs(logs.value))
const mismatchedLogs = computed(() => logs.value.filter(log => log.verificationStatus === 'MISMATCH').length)
const productSections = computed(() => [
  {
    id: 'feeding',
    eyebrow: 'DINH DƯỠNG',
    title: 'Thức ăn đã ghi nhận',
    empty: 'Chưa có ghi nhận thức ăn trong hồ sơ công khai.',
    ...summary.value.feeding,
  },
  {
    id: 'medicine',
    eyebrow: 'CHĂM SÓC',
    title: 'Thuốc và hóa chất đã ghi nhận',
    empty:
      'Chưa có ghi nhận sử dụng thuốc hoặc hóa chất. Điều này không có nghĩa là không sử dụng.',
    ...summary.value.medicine,
  },
])
const filteredLogs = computed(() => filterLogs(logs.value, filters))
const visibleLogs = computed(() =>
  filteredLogs.value.slice((logPage.value - 1) * 20, logPage.value * 20),
)
watch(filters, () => {
  logPage.value = 1
})
let requestVersion = 0
const date = (value: string | null | undefined) => {
  if (!value) return 'Chưa có thông tin'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime())
    ? 'Chưa có thông tin'
    : new Intl.DateTimeFormat('vi-VN', {
        dateStyle: 'medium',
        timeZone: 'Asia/Ho_Chi_Minh',
      }).format(parsed)
}
const time = (value: string | null | undefined) => {
  if (!value || Number.isNaN(new Date(value).getTime())) return 'Chưa có thông tin'
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(value))
}
const labels: Record<string, string> = {
  ...FARMING_LOG_TYPE_LABELS,
  ...SPECIES_LABELS,
  PLANNING: 'Đang chờ vận chuyển',
  IN_TRANSIT: 'Đang vận chuyển',
  DELIVERED: 'Đã xác nhận nhận hàng',
  CANCELLED: 'Đã hủy',
  REJECTED: 'Đã từ chối nhận',
  REQUESTED: 'Tạo yêu cầu vận chuyển',
  CLAIMED: 'Tiếp nhận chuyến',
  CHECKPOINT: 'Điểm kiểm tra',
  DELIVERY_REPORTED: 'Báo giao hàng · chờ xác nhận nhận hàng',
  RECIPIENT_ASSIGNED: 'Gán đơn vị nhận',
  TRACKING_UPDATE: 'Cập nhật hành trình',
  PICKED_UP: 'Đã lấy hàng',
  AT_SORTING_FACILITY: 'Tại điểm trung chuyển',
  DEPARTED_FACILITY: 'Rời điểm trung chuyển',
  OUT_FOR_DELIVERY: 'Đang giao tới người nhận',
  DELIVERY_ATTEMPT_FAILED: 'Giao hàng chưa thành công',
  DELIVERED_REPORTED: 'Báo giao thành công · chờ xác nhận',
}
const recordedLabels: Record<string, string> = {
  SUCCESS: 'Đã ghi nhận',
  PENDING: 'Đang chờ ghi nhận',
  FAILED: 'Ghi nhận thất bại',
  UNKNOWN: 'Chưa xác định',
}
const proofLabels = {
  MATCH: 'Đã kiểm tra. Thông tin thu hoạch khớp với hồ sơ đã lưu.',
  MISMATCH: 'Thông tin thu hoạch có sai lệch so với hồ sơ đã lưu. Vui lòng hỏi nhà phân phối.',
  PENDING: 'Thông tin thu hoạch đang chờ được kiểm tra.',
  UNAVAILABLE: 'Tạm thời chưa thể kiểm tra thông tin thu hoạch. Vui lòng thử lại sau.',
}
const logCheckLabels = {
  MATCH: 'Đã kiểm tra. Nội dung khớp với hồ sơ đã lưu.',
  MISMATCH: 'Dữ liệu hiện tại không khớp với hồ sơ đã xác nhận.',
  PENDING: 'Nhật ký đang chờ được kiểm tra.',
  UNAVAILABLE: 'Tạm thời chưa thể kiểm tra nhật ký này.',
}
const detailLabels: Record<string, string> = {
  feedType: 'Loại thức ăn',
  feedAmount: 'Lượng thức ăn (kg)',
  medicineName: 'Tên thuốc',
  dose: 'Liều lượng',
  temperature: 'Nhiệt độ (°C)',
  salinity: 'Độ mặn (‰)',
  ph: 'pH',
  dissolvedOxygen: 'Oxy hòa tan (mg/L)',
  mortalityCount: 'Số lượng chết',
}
function technicalDetails(details: Record<string, unknown> | null | undefined) {
  return Object.entries(detailLabels).flatMap(([key, label]) => {
    const value = details?.[key]
    return (typeof value === 'string' || typeof value === 'number') && value !== ''
      ? [{ key, label, value }]
      : []
  })
}
async function load() {
  const version = ++requestVersion
  result.value = null
  Object.assign(filters, { type: '', query: '', from: '', to: '' })
  logPage.value = 1
  error.value = ''
  loading.value = true
  try {
    const response = await api.get<PublicTraceResponse>(
      `/public/trace/${encodeURIComponent(String(route.params.traceCode ?? ''))}`,
      false,
    )
    if (version === requestVersion) result.value = response
  } catch (e) {
    if (version === requestVersion)
      error.value =
        e instanceof ApiError && e.status === 404
          ? 'Không tìm thấy mã truy xuất. Vui lòng kiểm tra lại QR hoặc đường dẫn.'
          : 'Không tải được hồ sơ truy xuất. Vui lòng thử lại.'
  } finally {
    if (version === requestVersion) loading.value = false
  }
}
watch(() => route.params.traceCode, load, { immediate: true })
onBeforeUnmount(() => {
  requestVersion++
})
</script>

<template>
  <main class="trace-page" :aria-busy="loading">
    <header class="trace-header">
      <RouterLink class="trace-brand" to="/" aria-label="Thủy sản Xanh — Trang chủ">
        <span class="brand-symbol" aria-hidden="true"
          ><svg viewBox="0 0 32 32" fill="none">
            <path
              d="M5 12c4-6 7 6 11 0s7 6 11 0M5 20c4-6 7 6 11 0s7 6 11 0"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
            /></svg
        ></span>
        <span>Thủy sản Xanh<small>HỒ SƠ NGUỒN GỐC</small></span>
      </RouterLink>
      <span class="public-label"><span aria-hidden="true"></span>Thông tin công khai</span>
    </header>
    <div class="page-intro" :class="{ 'has-lot': result?.status === 'ACTIVE' && result.trace }">
      <h1>Hồ sơ nguồn gốc thủy sản</h1>
      <p>Biết nơi nuôi, thức ăn và quá trình chăm sóc qua những thông tin đã được ghi nhận.</p>
    </div>
    <section v-if="loading" class="trace-card state" role="status">
      <span class="state-symbol" aria-hidden="true">≈</span>
      <h2>Đang mở hồ sơ nguồn gốc</h2>
      <p>Vui lòng chờ trong giây lát…</p>
    </section>
    <section v-else-if="error" class="trace-card state" role="alert">
      <span class="state-symbol" aria-hidden="true">!</span>
      <h2>Chưa thể mở hồ sơ</h2>
      <p>{{ error }}</p>
      <va-button @click="load">Thử lại</va-button>
    </section>
    <section
      v-else-if="result?.status === 'REVOKED'"
      class="trace-card state revoked-state"
      role="status"
    >
      <span class="state-symbol" aria-hidden="true">!</span>
      <h2>QR đã được thu hồi</h2>
      <p>
        Hồ sơ lô hàng không còn được công khai. Vui lòng liên hệ đơn vị cung cấp để biết thêm thông
        tin.
      </p>
    </section>
    <template v-else-if="result?.status === 'ACTIVE' && result.trace">
      <p><RouterLink :to="{ name: 'trace-report', params: { traceCode: route.params.traceCode } }" class="report-link">Báo cáo kết quả truy xuất · In / Lưu PDF →</RouterLink></p>
      <section class="lot-card" aria-labelledby="lot-title">
        <div class="lot-illustration" aria-hidden="true">
          <svg viewBox="0 0 120 120" fill="none">
            <circle cx="60" cy="60" r="49" stroke="currentColor" />
            <circle cx="60" cy="60" r="39" stroke="currentColor" />
            <path
              d="M29 51c11-14 20 14 31 0s20 14 31 0M29 68c11-14 20 14 31 0s20 14 31 0"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="round"
            />
          </svg>
        </div>
        <div class="lot-heading">
          <span class="lot-label">LÔ THU HOẠCH</span>
        </div>
        <h2 id="lot-title">
          {{ labels[result.trace.species] || result.trace.species || 'Chưa có thông tin loài' }}
        </h2>
        <p class="lot-farm">{{ result.trace.farm.name || 'Chưa có thông tin cơ sở' }}</p>
        <p class="lot-address">{{ result.trace.farm.address || 'Chưa có thông tin địa chỉ' }}</p>
        <dl class="lot-facts">
          <div>
            <dt>Khối lượng lô</dt>
            <dd>{{ Number(result.trace.quantity).toLocaleString('vi-VN') }} <span>kg</span></dd>
          </div>
          <div>
            <dt>Ngày thu hoạch</dt>
            <dd>{{ date(result.trace.harvestDate) }}</dd>
          </div>
          <div>
            <dt>Ngày thả giống</dt>
            <dd>{{ date(result.trace.batch.stockingDate) }}</dd>
          </div>
        </dl>
        <div class="lot-code">
          <span>MÃ LÔ</span><strong>{{ result.trace.lotCode }}</strong>
        </div>
      </section>
      <a
        class="proof-summary"
        :class="`proof-${result.trace.proof.status.toLowerCase()}`"
        href="#verification"
      >
        <span
          ><strong>Đối soát hồ sơ thu hoạch</strong
          ><span>{{ proofLabels[result.trace.proof.status] }}</span></span
        >
        <span aria-hidden="true">↗</span>
      </a>
      <nav class="section-nav" aria-label="Nội dung hồ sơ">
        <a href="#origin">Nguồn gốc</a><a href="#care">Thức ăn &amp; chăm sóc</a
        ><a href="#journal" @click="journal && (journal.open = true)">Nhật ký</a
        ><a href="#journey">Vận chuyển</a><a href="#verification">Đối soát</a>
      </nav>
      <section id="origin" class="trace-card origin-card">
        <div class="section-heading">
          <div>
            <p class="eyebrow">VÙNG NUÔI</p>
            <h2>Nguồn gốc nuôi</h2>
          </div>
        </div>
        <dl class="facts">
          <div>
            <dt>Cơ sở</dt>
            <dd>{{ result.trace.farm.name || 'Chưa có thông tin' }}</dd>
          </div>
          <div>
            <dt>Địa chỉ cơ sở</dt>
            <dd>{{ result.trace.farm.address || 'Chưa có thông tin' }}</dd>
          </div>
          <div>
            <dt>Ao nuôi</dt>
            <dd>{{ result.trace.pond.code }} · {{ result.trace.pond.name }}</dd>
          </div>
          <div>
            <dt>Vụ nuôi</dt>
            <dd>{{ result.trace.batch.code }}</dd>
          </div>
          <div>
            <dt>Nguồn giống</dt>
            <dd>{{ result.trace.batch.seedSource || 'Chưa có thông tin' }}</dd>
          </div>
          <div>
            <dt>Ngày thả</dt>
            <dd>{{ date(result.trace.batch.stockingDate) }}</dd>
          </div>
        </dl>
      </section>
      <div id="care" class="care-heading">
        <p class="eyebrow">QUÁ TRÌNH NUÔI</p>
        <h2>Được chăm sóc như thế nào?</h2>
        <p>Nhìn nhanh các sản phẩm được ghi nhận trong vụ nuôi của lô hàng.</p>
        <va-alert v-if="mismatchedLogs" color="danger">
          Có {{ mismatchedLogs }} nhật ký có sai lệch so với hồ sơ đã xác nhận. Xem chi tiết trong nhật ký vụ nuôi.
        </va-alert>
      </div>
      <div class="care-grid">
        <section
          v-for="section in productSections"
          :key="section.id"
          class="trace-card care-card"
          :class="section.id"
        >
          <div class="care-card-heading">
            <p class="eyebrow">{{ section.eyebrow }}</p>
            <span class="record-count">{{ section.recordCount }} nhật ký</span>
          </div>
          <h3 class="care-title">{{ section.title }}</h3>
          <p>
            {{ section.recordCount }} nhật ký đã xác nhận đến hết ngày thu hoạch theo giờ Việt Nam.
          </p>
          <ul v-if="section.products.length" class="product-list">
            <li v-for="product in section.products" :key="product.name">
              <div class="product-heading">
                <h4>{{ product.name }}</h4>
                <span>{{ product.count }} lần</span>
              </div>
              <p v-if="product.mismatchCount" class="product-mismatch">
                <strong>Có sai lệch</strong> · {{ product.mismatchCount }}/{{ product.count }} bản ghi
              </p>
              <p class="product-dates">
                {{ date(product.firstUsed) }} <span aria-label="đến">→</span>
                {{ date(product.lastUsed) }}
              </p>
            </li>
          </ul>
          <p v-if="section.unnamedCount" class="muted">
            Có {{ section.unnamedCount }} nhật ký chưa ghi rõ tên sản phẩm, chưa thể gom theo tên.
          </p>
          <p v-if="!section.recordCount">{{ section.empty }}</p>
          <p v-else class="muted">
            Khoảng ngày là lần đầu và lần cuối được ghi nhận, không có nghĩa là sử dụng liên tục.
            Liều lượng từng lần có trong nhật ký chi tiết.
          </p>
        </section>
      </div>
      <p class="care-note">
        Thông tin được tổng hợp từ nhật ký đã xác nhận của người nuôi, không thay thế kết quả kiểm
        nghiệm an toàn hoặc tồn dư thuốc.
      </p>
      <details
        id="journal"
        ref="journal"
        :key="String(route.params.traceCode)"
        class="trace-card log-details"
      >
        <summary>
          <span
            ><span class="eyebrow">NHẬT KÝ VỤ NUÔI</span><strong>Xem nhật ký chi tiết</strong
            ><small>{{ logs.length }} bản ghi · Lọc theo loại và thời gian</small></span
          ><span class="details-toggle" aria-hidden="true">+</span>
        </summary>
        <p class="muted">
          Các nhật ký đã xác nhận của vụ nuôi liên quan đến lô, đến hết ngày thu hoạch theo giờ Việt
          Nam.
        </p>
        <div class="log-filters">
          <label
            >Loại nhật ký<select v-model="filters.type">
              <option value="">Tất cả loại nhật ký</option>
              <option v-for="(label, value) in FARMING_LOG_TYPE_LABELS" :key="value" :value="value">
                {{ label }}
              </option>
            </select></label
          >
          <label
            >Từ ngày (giờ Việt Nam)<input
              v-model="filters.from"
              type="date"
              :max="filters.to || undefined"
          /></label>
          <label
            >Đến ngày (giờ Việt Nam)<input
              v-model="filters.to"
              type="date"
              :min="filters.from || undefined"
          /></label>
        </div>
        <CollectionToolbar
          v-model:query="filters.query"
          v-model:page="logPage"
          :total="filteredLogs.length"
          :page-size="20"
          label="nhật ký"
        />
        <ol v-if="visibleLogs.length" class="timeline">
          <li v-for="(log, index) in visibleLogs" :key="`${logPage}-${index}`">
            <h3>{{ labels[log.type] || log.type }}</h3>
            <p>{{ time(log.date) }}</p>
            <va-alert v-if="log.verificationStatus === 'MISMATCH'" color="danger">
              {{ logCheckLabels.MISMATCH }}
            </va-alert>
            <p v-else class="muted">{{ logCheckLabels[log.verificationStatus ?? 'UNAVAILABLE'] }}</p>
            <dl class="facts">
              <div v-for="detail in technicalDetails(log.details)" :key="detail.key">
                <dt>{{ detail.label }}</dt>
                <dd>{{ detail.value }}</dd>
              </div>
            </dl>
            <TraceImage
              v-if="log.imageUrl"
              :src="log.imageUrl"
              :alt="`Ảnh nhật ký ${labels[log.type] || log.type} ngày ${date(log.date)}`"
              caption="Ảnh nhật ký nuôi"
            />
            <p v-if="!technicalDetails(log.details).length" class="muted">
              Chưa có chỉ số kỹ thuật công khai.
            </p>
          </li>
        </ol>
        <p v-else>
          {{
            logs.length
              ? 'Không có nhật ký phù hợp với bộ lọc.'
              : 'Chưa có nhật ký công khai cho lô này.'
          }}
        </p>
      </details>
      <section id="verification" class="trace-card proof-card">
        <h2>Kiểm tra thông tin thu hoạch</h2>
        <va-alert
          :color="
            result.trace.proof.status === 'MATCH'
              ? 'success'
              : result.trace.proof.status === 'MISMATCH'
                ? 'danger'
                : 'warning'
          "
          >{{ proofLabels[result.trace.proof.status] }}</va-alert
        >
        <p v-if="result.trace.proof.checkedAt">
          Thời điểm kiểm tra: {{ time(result.trace.proof.checkedAt) }}
        </p>
        <p class="muted">
          Kết quả kiểm tra nhật ký hiển thị tại từng mục. Các mốc vận chuyển hiển thị trạng thái ghi nhận.
        </p>
      </section>
      <section id="journey" class="trace-card journey-card">
        <div class="section-heading">
          <div>
            <p class="eyebrow">SAU THU HOẠCH</p>
            <h2>Hành trình vận chuyển</h2>
          </div>
        </div>
        <article v-for="(trip, index) in result.trace.transports" :key="index" class="trip">
          <div class="trip-heading">
            <h3>{{ trip.code }}</h3>
            <span class="trip-status">{{ labels[trip.status] || trip.status }}</span>
          </div>
          <p>{{ date(trip.date) }}</p>
          <p v-if="trip.quantity != null">Khối lượng gửi <strong>{{ Number(trip.quantity).toLocaleString('vi-VN') }} kg</strong></p>
          <p v-if="trip.receivedQuantity != null">
            Khối lượng thực nhận <strong>{{ Number(trip.receivedQuantity).toLocaleString('vi-VN') }} kg</strong>
            <span v-if="trip.receiptOutcome === 'PARTIAL'"> · Nhận một phần</span>
          </p>
          <p v-else-if="trip.status === 'DELIVERED'" class="muted">Chưa ghi khối lượng thực nhận.</p>
          <p v-if="trip.recipientName">
            {{
              trip.status === 'DELIVERED' ? 'Đơn vị đã xác nhận nhận hàng' : 'Đơn vị nhận dự kiến'
            }}: {{ trip.recipientName }}
          </p>
          <ol v-if="trip.events?.length" class="timeline">
            <li v-for="(event, eventIndex) in trip.events" :key="eventIndex">
              <h4>{{ labels[event.type] || event.type }}</h4>
              <p>{{ time(event.date) }}</p>
              <p v-if="event.trackingStatus">
                {{ labels[event.trackingStatus] || event.trackingStatus }}
              </p>
              <TraceImage
                v-if="event.imageUrl"
                :src="event.imageUrl"
                :alt="`Ảnh bằng chứng giao hàng của chuyến ${trip.code}`"
                caption="Ảnh bằng chứng giao hàng"
              />
              <p v-if="event.temperature != null">Nhiệt độ: {{ event.temperature }} °C</p>
              <p class="muted">
                Ghi nhận hồ sơ:
                {{ recordedLabels[event.blockchainStatus || 'UNKNOWN'] || 'Chưa xác định' }}
              </p>
            </li>
          </ol>
          <p v-else class="muted">Chưa có mốc hành trình công khai.</p>
        </article>
        <p v-if="!result.trace.transports?.length">Chưa có thông tin vận chuyển cho lô này.</p>
      </section>
      <section class="trace-card" aria-labelledby="packaging-title">
        <h2 id="packaging-title">Thông tin đóng gói và kiểm định</h2>
        <LotPackagingDetails :items="result.trace.packaging ?? []" public-view />
      </section>
      <footer class="trace-footer">
        <span class="footer-brand">≈ Thủy sản Xanh</span>
        <p>Thông tin theo lô · Cập nhật từ hồ sơ đã ghi nhận</p>
        <p>QR có thể được sao chép và không chứng minh tính xác thực của từng gói sản phẩm.</p>
      </footer>
    </template>
  </main>
</template>

<style scoped>
.report-link { display: inline-flex; align-items: center; min-height: 44px; color: var(--app-primary-dark); text-decoration: underline; }
.trace-page {
  width: min(100%, 1040px);
  min-height: 100dvh;
  display: grid;
  align-content: start;
  gap: 24px;
  margin: 0 auto;
  padding: 0 40px 48px;
  color: var(--app-ink);
  line-height: 1.8;
  font-size: 14px;
}
.trace-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 24px 0;
  border-bottom: 1px solid var(--app-line);
}
.trace-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 17px;
  font-weight: 600;
}
.trace-brand small {
  display: block;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.06em;
  color: var(--app-muted);
}
.brand-symbol {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  color: white;
  background: var(--app-primary);
}
.brand-symbol svg {
  width: 28px;
  height: 28px;
}
.public-label {
  font-size: 12px;
  color: var(--app-muted);
}
.page-intro {
  padding: 8px 0;
}
.page-intro h1 {
  margin: 0 0 12px;
  font-size: var(--app-text-title);
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: -0.035em;
}
.page-intro.has-lot h1 {
  font-size: var(--app-text-title);
}
.page-intro p {
  color: var(--app-muted);
  max-width: 65ch;
}
.trace-card {
  min-width: 0;
  display: grid;
  gap: 16px;
  padding: 28px;
  border: 1px solid var(--app-line);
  border-radius: var(--app-radius);
  background: var(--app-surface);
}
.trace-card h2,
.care-heading h2 {
  font-size: var(--app-text-section);
  font-weight: 600;
  line-height: 1.5;
  letter-spacing: -0.025em;
  margin: 0;
}
.eyebrow {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--app-primary-dark);
  margin: 0 0 6px;
}
.lot-card {
  position: relative;
  overflow: hidden;
  padding: 32px 32px 0;
  border-radius: 16px;
  background: var(--app-sidebar);
  color: white;
}
.lot-label {
  color: var(--app-accent);
  font-size: 12px;
  letter-spacing: 0.08em;
}
.lot-card h2 {
  position: relative;
  max-width: 80%;
  font-size: clamp(32px, 4vw, 44px);
  line-height: 1.3;
  font-weight: 500;
  letter-spacing: -0.035em;
  margin: 16px 0 12px;
}
.lot-farm {
  position: relative;
  max-width: 80%;
  font-size: 16px;
  font-weight: 500;
  overflow-wrap: anywhere;
}
.lot-address {
  position: relative;
  max-width: 80%;
  color: var(--app-sidebar-text);
  margin-top: 6px;
  overflow-wrap: anywhere;
}
.lot-illustration {
  position: absolute;
  right: 24px;
  top: 40px;
  width: 120px;
  color: var(--app-divider);
}
.lot-facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 24px;
  margin: 28px 0 0;
  padding: 24px 0;
  border-top: 1px solid var(--app-divider);
}
.lot-facts dt {
  font-size: 12px;
  color: var(--app-sidebar-text);
}
.lot-facts dd {
  margin: 6px 0 0;
  font-size: 20px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.lot-facts dd span {
  font-size: 13px;
  font-weight: 400;
}
.lot-code {
  display: flex;
  align-items: baseline;
  gap: 16px;
  border-top: 1px solid var(--app-divider);
  padding: 16px 0;
  font-size: 12px;
}
.lot-code > span {
  flex-shrink: 0;
  color: var(--app-sidebar-text);
}
.lot-code strong {
  font-family: ui-monospace, monospace;
  font-weight: 500;
  overflow-wrap: anywhere;
}
.proof-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: -8px;
  padding: 16px 20px;
  border: 1px solid #e4d6b6;
  border-radius: var(--app-control-radius);
  background: #fff8e9;
  color: #745114;
}
.proof-summary strong,
.proof-summary > span > span {
  display: block;
}
.proof-summary strong {
  font-size: 13px;
  font-weight: 600;
}
.proof-summary > span > span {
  font-size: 13px;
  margin-top: 4px;
}
.proof-match {
  border-color: #bfdacc;
  background: #eef7f1;
  color: var(--app-success);
}
.proof-mismatch {
  border-color: #eacaca;
  background: #fceeee;
  color: var(--app-danger);
}
.proof-summary:hover {
  text-decoration: underline;
  text-underline-offset: 4px;
}
.section-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--app-line);
}
.section-nav a {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--app-primary-dark);
}
.section-nav a:hover {
  background: var(--app-primary-soft);
}
[id] {
  scroll-margin-top: 24px;
}
.facts {
  display: grid;
  margin: 0;
}
.facts > div {
  display: grid;
  grid-template-columns: minmax(90px, 1fr) minmax(0, 2fr);
  gap: 16px;
  padding: 12px 0;
  border-bottom: 1px solid var(--app-line);
}
.facts > div:last-child {
  border: 0;
}
.facts dt,
.muted {
  color: var(--app-muted);
}
.facts dd {
  margin: 0;
  overflow-wrap: anywhere;
  font-weight: 500;
}
.origin-card > .facts {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 24px;
}
.origin-card > .facts > div {
  display: block;
  border: 0;
  padding: 0;
}
.origin-card dt {
  font-size: 12px;
  margin-bottom: 6px;
}
.care-heading {
  padding-top: 8px;
}
.care-heading > p:last-child {
  margin-top: 8px;
  color: var(--app-muted);
}
.care-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 24px;
}
.care-card {
  align-content: start;
}
.care-card-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.record-count {
  padding: 3px 8px;
  font-size: 12px;
  border-radius: 6px;
  color: var(--app-primary-dark);
  background: var(--app-primary-soft);
}
.care-title {
  font-size: 18px;
  font-weight: 600;
  line-height: 1.5;
}
.care-card > p {
  color: var(--app-muted);
  font-size: 13px;
}
.product-list {
  padding: 0;
  margin: 0;
  list-style: none;
}
.product-list li {
  padding: 16px 0;
  border-top: 1px solid var(--app-line);
  overflow-wrap: anywhere;
}
.product-heading {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 16px;
}
.product-heading h4 {
  font-size: 14px;
  font-weight: 600;
}
.product-heading > span {
  font-size: 12px;
  color: var(--app-muted);
  flex-shrink: 0;
}
.product-dates {
  font-size: 12px;
  margin-top: 8px;
  color: var(--app-muted);
}
.product-mismatch {
  margin: 6px 0 0;
  color: var(--app-danger, #952d2d);
  font-size: 12px;
}
.product-dates span {
  padding-inline: 4px;
}
.care-note {
  color: var(--app-muted);
  font-size: 13px;
  margin-top: -8px;
}
.log-details {
  display: block;
}
.log-details > summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  list-style: none;
  min-height: 44px;
}
.log-details > summary::-webkit-details-marker {
  display: none;
}
.log-details summary strong,
.log-details summary small {
  display: block;
}
.log-details summary strong {
  font-size: 18px;
  font-weight: 600;
}
.log-details summary small {
  font-size: 13px;
  color: var(--app-muted);
  margin-top: 4px;
}
.details-toggle {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border: 1px solid var(--app-line);
  border-radius: 8px;
  font-size: 24px;
  color: var(--app-primary);
}
.log-details[open] .details-toggle {
  transform: rotate(45deg);
}
.log-details > p {
  margin-top: 20px;
}
.log-filters {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin: 24px 0 16px;
}
.log-filters label {
  display: grid;
  gap: 8px;
  font-size: 12px;
  color: var(--app-muted);
}
.log-filters input,
.log-filters select {
  width: 100%;
  min-width: 0;
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid var(--app-control-line);
  border-radius: 8px;
  background: white;
  color: var(--app-ink);
  font-size: 14px;
}
.timeline {
  display: grid;
  gap: 24px;
  list-style: none;
  padding: 4px 0 4px 24px;
  margin: 16px 0 0 4px;
  border-left: 1px solid var(--app-line);
}
.timeline > li {
  position: relative;
  min-width: 0;
  display: grid;
  gap: 8px;
  font-size: 13px;
}
.timeline > li::before {
  content: '';
  position: absolute;
  left: -28px;
  top: 8px;
  width: 7px;
  height: 7px;
  background: var(--app-primary);
  border-radius: 50%;
  box-shadow: 0 0 0 4px var(--app-surface);
}
.timeline h3,
.timeline h4 {
  font-size: 14px;
  font-weight: 600;
}
.timeline .facts {
  padding: 8px 16px;
  background: var(--app-canvas);
  border-radius: 8px;
}
.proof-card > p:not(.eyebrow) {
  font-size: 13px;
}
.hash {
  font-family: ui-monospace, monospace;
  overflow-wrap: anywhere;
}
.trip {
  padding-top: 20px;
  border-top: 1px solid var(--app-line);
}
.trip-heading {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.trip-heading h3 {
  font-size: 15px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.trip-status {
  font-size: var(--app-text-xs);
  padding: var(--app-space-1) var(--app-space-2);
  border-radius: var(--app-pill-radius);
  background: var(--app-canvas);
  color: var(--app-muted);
}
.trace-footer {
  padding: 24px 0 0;
  border-top: 1px solid var(--app-line);
  text-align: center;
  color: var(--app-muted);
  font-size: 12px;
}
.footer-brand {
  display: block;
  color: var(--app-primary-dark);
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 12px;
}
.trace-footer p + p {
  margin-top: 8px;
}
.state {
  justify-items: center;
  text-align: center;
  padding: 48px 24px;
}
.state p {
  color: var(--app-muted);
  max-width: 48ch;
}
.state-symbol {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  font-size: 28px;
  border-radius: 12px;
  background: var(--app-primary-soft);
  color: var(--app-primary);
}
.revoked-state .state-symbol {
  color: var(--app-warning);
  background: #fff5df;
}
@media (max-width: 640px) {
  .trace-page {
    padding: 0 16px 32px;
    gap: 20px;
  }
  .trace-header {
    padding-block: 20px;
  }
  .trace-brand {
    font-size: 15px;
  }
  .trace-brand small {
    font-size: 9px;
  }
  .public-label {
    font-size: 11px;
  }
  .trace-card {
    padding: 20px;
  }
  .trace-card h2 {
    font-size: 20px;
  }
  .lot-card {
    padding: 24px 24px 0;
  }
  .lot-card h2 {
    font-size: 32px;
  }
  .lot-card :is(h2, .lot-farm, .lot-address) {
    max-width: 100%;
  }
  .lot-illustration {
    display: none;
  }
  .lot-facts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
  }
  .lot-facts > div:first-child {
    grid-column: 1 / -1;
  }
  .lot-facts dd {
    font-size: 16px;
  }
  .lot-facts > div:first-child dd {
    font-size: 28px;
  }
  .origin-card > .facts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 20px;
  }
  .care-grid,
  .log-filters {
    grid-template-columns: minmax(0, 1fr);
  }
  .log-filters input,
  .log-filters select {
    font-size: 16px;
  }
  .facts > div {
    grid-template-columns: minmax(0, 1fr);
    gap: 4px;
  }
  .section-nav {
    gap: 4px;
  }
  .section-nav a {
    padding-inline: 8px;
    font-size: 12px;
  }
}
</style>
