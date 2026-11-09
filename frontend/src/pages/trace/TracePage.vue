<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { VaAlert, VaButton } from 'vuestic-ui'
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
const logs = computed(() => (result.value?.status === 'ACTIVE' ? result.value.trace.logs : []))
const summary = computed(() => summarizeLogs(logs.value))
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
  MATCH: 'Hash snapshot thu hoạch khớp với Blockchain',
  MISMATCH: 'Hash snapshot thu hoạch không khớp với Blockchain',
  PENDING: 'Chưa có bản ghi Blockchain để đối soát thu hoạch',
  UNAVAILABLE: 'Hiện không thể đối soát thu hoạch với Blockchain',
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
    <div class="page-intro">
      <p class="eyebrow">TỪ VÙNG NUÔI ĐẾN TAY BẠN</p>
      <h1>Mỗi lô hàng,<br /><em>một câu chuyện nguồn gốc.</em></h1>
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
          <span class="lot-label">LÔ THU HOẠCH</span><span class="lot-context">Hồ sơ theo lô</span>
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
      <nav class="section-nav" aria-label="Nội dung hồ sơ">
        <a href="#origin">Nguồn gốc</a><a href="#care">Thức ăn &amp; chăm sóc</a
        ><a href="#journal">Nhật ký</a><a href="#journey">Vận chuyển</a>
      </nav>
      <section id="origin" class="trace-card origin-card">
        <div class="section-heading">
          <div>
            <p class="eyebrow">01 / NƠI BẮT ĐẦU</p>
            <h2>Nguồn gốc nuôi</h2>
          </div>
          <span class="section-number" aria-hidden="true">01</span>
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
        <p class="eyebrow">02 / QUÁ TRÌNH NUÔI</p>
        <h2>Được chăm sóc như thế nào?</h2>
        <p>Nhìn nhanh các sản phẩm được ghi nhận trong vụ nuôi của lô hàng.</p>
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
      <details id="journal" :key="String(route.params.traceCode)" class="trace-card log-details">
        <summary>
          <span
            ><span class="eyebrow">03 / NHẬT KÝ VỤ NUÔI</span><strong>Xem nhật ký chi tiết</strong
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
            <p class="muted">
              Blockchain:
              {{ recordedLabels[log.blockchainStatus || 'UNKNOWN'] || 'Chưa xác định' }} (trạng thái
              ghi nhận)
            </p>
            <dl class="facts">
              <div v-for="detail in technicalDetails(log.details)" :key="detail.key">
                <dt>{{ detail.label }}</dt>
                <dd>{{ detail.value }}</dd>
              </div>
            </dl>
            <TraceImage v-if="log.imageUrl" :src="log.imageUrl" :alt="`Ảnh nhật ký ${labels[log.type] || log.type} ngày ${date(log.date)}`" caption="Ảnh nhật ký nuôi" />
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
      <section class="trace-card proof-card">
        <p class="eyebrow">BẰNG CHỨNG GHI NHẬN</p>
        <h2>Đối soát thu hoạch với Blockchain</h2>
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
        <p>
          Trạng thái ghi nhận:
          {{ recordedLabels[result.trace.proof.recordedStatus || 'UNKNOWN'] || 'Chưa xác định' }}.
        </p>
        <p v-if="result.trace.proof.checkedAt">
          Thời điểm kiểm tra: {{ time(result.trace.proof.checkedAt) }}
        </p>
        <p v-if="result.trace.proof.transactionHash" class="hash">
          Giao dịch: {{ result.trace.proof.transactionHash }}
        </p>
        <p class="muted">
          Kết quả này chỉ đối soát snapshot thu hoạch. Trạng thái ghi nhận nhật ký và vận chuyển
          không phải kết quả đối soát trực tiếp các mốc đó.
        </p>
      </section>
      <section id="journey" class="trace-card journey-card">
        <div class="section-heading">
          <div>
            <p class="eyebrow">04 / SAU THU HOẠCH</p>
            <h2>Hành trình vận chuyển</h2>
          </div>
          <span class="section-number" aria-hidden="true">04</span>
        </div>
        <article v-for="(trip, index) in result.trace.transports" :key="index" class="trip">
          <h3>{{ trip.code }}</h3>
          <p>{{ date(trip.date) }} · {{ Number(trip.quantity).toLocaleString('vi-VN') }} kg</p>
          <p>{{ labels[trip.status] || trip.status }}</p>
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
              <TraceImage v-if="event.imageUrl" :src="event.imageUrl" :alt="`Ảnh bằng chứng giao hàng của chuyến ${trip.code}`" caption="Ảnh bằng chứng giao hàng" />
              <p v-if="event.temperature != null">Nhiệt độ: {{ event.temperature }} °C</p>
              <p class="muted">
                Blockchain:
                {{ recordedLabels[event.blockchainStatus || 'UNKNOWN'] || 'Chưa xác định' }} (trạng
                thái ghi nhận)
              </p>
            </li>
          </ol>
          <p v-else class="muted">Chưa có mốc hành trình công khai.</p>
        </article>
        <p v-if="!result.trace.transports?.length">Chưa có thông tin vận chuyển cho lô này.</p>
      </section>
      <section class="trace-card inspection-card">
        <p class="eyebrow">THÔNG TIN BỔ SUNG</p>
        <h2>Đóng gói và kiểm định</h2>
        <p>Chưa có thông tin đóng gói và kiểm định trong hồ sơ này.</p>
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
.trace-page {
  width: min(100%, 960px);
  margin: 0 auto;
  padding: 0 28px 36px;
  display: grid;
  gap: 22px;
  color: #203e3b;
  line-height: 1.7;
  font-size: 14px;
}
.trace-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 25px 0;
  border-bottom: 1px solid #dae6e0;
}
.trace-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 17px;
  font-weight: 750;
  letter-spacing: -0.5px;
  text-decoration: none;
}
.trace-brand small {
  display: block;
  margin-top: 2px;
  font-size: 8px;
  font-weight: 650;
  letter-spacing: 1.6px;
  color: #56746a;
}
.brand-symbol {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 13px;
  color: #fff;
  background: #176e59;
}
.brand-symbol svg {
  width: 30px;
  height: 30px;
}
.public-label {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 6px 11px;
  border: 1px solid #d8e5dd;
  border-radius: 30px;
  color: #496659;
  background: #edf5ef;
  font-size: 11px;
  white-space: nowrap;
}
.public-label > span {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #43775e;
}
.page-intro {
  padding: 25px 0 9px;
}
.eyebrow {
  font-size: 10px;
  line-height: 1.6;
  letter-spacing: 1.5px;
  font-weight: 750;
  color: #46725d;
  margin: 0;
}
.page-intro h1 {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: clamp(32px, 4.5vw, 48px);
  line-height: 1.2;
  font-weight: 500;
  letter-spacing: -1.5px;
  margin: 14px 0 16px;
}
.page-intro h1 em {
  color: #197155;
  font-weight: 500;
}
.page-intro > p:last-child {
  color: #61766d;
  max-width: 510px;
  font-size: 13px;
}
.trace-card {
  background: #fff;
  border: 1px solid #dfe8e2;
  border-radius: 18px;
  padding: 28px;
  display: grid;
  gap: 14px;
  min-width: 0;
  box-shadow: 0 4px 18px #233f3503;
}
.lot-card {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  padding: 30px 32px 0;
  border: 1px solid #1d5d49;
  border-radius: 22px;
  color: #fff;
  background: radial-gradient(ellipse at 100% 0%, #397b61 0%, transparent 65%), #164c3e;
  box-shadow: 0 16px 32px #143e3314;
}
.lot-card::after {
  content: '';
  position: absolute;
  z-index: -1;
  width: 460px;
  height: 460px;
  border: 1px solid #ffffff0d;
  border-radius: 50%;
  right: -220px;
  top: -170px;
  box-shadow:
    0 0 0 44px #ffffff04,
    0 0 0 88px #ffffff03;
  pointer-events: none;
}
.lot-heading {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  position: relative;
}
.lot-label {
  font-size: 10px;
  letter-spacing: 1.8px;
  font-weight: 650;
  color: #cae0ca;
}
.lot-context {
  font-size: 10px;
  color: #e4efdf;
  border: 1px solid #b6d9bc50;
  padding: 4px 10px;
  border-radius: 24px;
}
.lot-card h2 {
  position: relative;
  max-width: 75%;
  margin: 25px 0 6px;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: clamp(30px, 4.8vw, 45px);
  line-height: 1.2;
  letter-spacing: -1px;
  color: #fff;
  font-weight: 500;
}
.lot-farm {
  position: relative;
  max-width: 75%;
  font-size: 16px;
  font-weight: 650;
  color: #eef3df;
  overflow-wrap: anywhere;
}
.lot-address {
  position: relative;
  max-width: 75%;
  font-size: 12px;
  color: #cee0d4;
  margin-top: 3px;
  overflow-wrap: anywhere;
}
.lot-illustration {
  position: absolute;
  right: 42px;
  top: 65px;
  width: 125px;
  height: 125px;
  color: #d6e7ad90;
}
.lot-illustration svg {
  width: 100%;
  height: 100%;
}
.lot-facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
  padding: 23px 0 25px;
  margin: 24px 0 0;
  border-top: 1px solid #b5d5c137;
}
.lot-facts dt {
  font-size: 11px;
  color: #c6dccd;
  margin-bottom: 5px;
}
.lot-facts dd {
  font-size: 19px;
  font-weight: 600;
  color: #fff;
}
.lot-facts dd span {
  font-size: 13px;
  font-weight: 400;
  color: #d6e6d7;
}
.lot-code {
  display: flex;
  gap: 14px;
  align-items: baseline;
  border-top: 1px solid #b5d5c12e;
  padding: 13px 0;
  color: #bcd6c6;
  font-size: 9px;
  letter-spacing: 0.8px;
}
.lot-code > span {
  flex-shrink: 0;
}
.lot-code strong {
  font:
    10px/1.6 ui-monospace,
    SFMono-Regular,
    Consolas,
    monospace;
  font-weight: 400;
  letter-spacing: 0.6px;
  overflow-wrap: anywhere;
  color: #e4efe6;
}
.section-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-bottom: 3px;
}
.section-nav a {
  padding: 8px 14px;
  border-radius: 30px;
  font-size: 12px;
  color: #446453;
  background: #e9f0eb;
  border: 1px solid transparent;
  text-decoration: none;
}
.section-nav a:hover {
  background: #dcebe0;
  border-color: #bdd5c3;
  color: #164c3e;
}
[id] {
  scroll-margin-top: 24px;
}
.section-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.section-heading h2 {
  margin-top: 5px;
}
.section-number {
  font:
    italic 42px/1 Georgia,
    serif;
  color: #b4cdb9;
}
h2 {
  font-size: 21px;
  font-weight: 700;
  line-height: 1.4;
  letter-spacing: -0.5px;
  margin: 0;
  overflow-wrap: anywhere;
}
h3,
h4 {
  font-weight: 650;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.facts {
  display: grid;
  gap: 0;
  margin: 0;
}
.facts > div {
  display: grid;
  grid-template-columns: minmax(100px, 1fr) 2fr;
  gap: 16px;
  padding: 12px 0;
  border-bottom: 1px solid #edf2ee;
}
.facts > div:last-child {
  border-bottom: 0;
}
dt,
.muted {
  color: #60756a;
}
dd {
  margin: 0;
  font-weight: 550;
  overflow-wrap: anywhere;
}
.origin-card > .facts {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 22px 24px;
  padding-top: 6px;
}
.origin-card > .facts > div {
  display: block;
  border-bottom: 0;
  padding: 0;
}
.origin-card dt {
  font-size: 11px;
  margin-bottom: 5px;
}
.origin-card dd {
  font-size: 13px;
}
.care-heading {
  padding: 14px 0 0;
}
.care-heading h2 {
  font-size: 26px;
  margin: 7px 0;
}
.care-heading > p:last-child {
  font-size: 13px;
  color: #61766d;
}
.care-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
}
.care-card {
  align-content: start;
  border-top: 3px solid #5c9270;
  padding: 24px;
  font-size: 12px;
}
.care-card.medicine {
  border-top-color: #b6975a;
}
.medicine .eyebrow {
  color: #85692f;
}
.care-card-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.record-count {
  background: #eef5ef;
  color: #4d6d56;
  border-radius: 20px;
  font-size: 10px;
  padding: 3px 8px;
  white-space: nowrap;
}
.medicine .record-count {
  background: #f7f3e9;
  color: #85692f;
}
.care-title {
  font-size: 18px;
  letter-spacing: -0.4px;
}
.care-card > p {
  color: #60756a;
  font-size: 11px;
}
.product-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 10px;
}
.product-list li {
  padding: 14px;
  border: 1px solid #e1ece2;
  border-radius: 12px;
  background: #f5f9f5;
  overflow-wrap: anywhere;
}
.medicine .product-list li {
  background: #fbf9f2;
  border-color: #ede7d6;
}
.product-heading {
  display: flex;
  gap: 12px;
  align-items: baseline;
  justify-content: space-between;
}
.product-heading h4 {
  font-size: 13px;
}
.product-heading > span {
  color: #446a4c;
  font-size: 10px;
  flex-shrink: 0;
}
.medicine .product-heading > span {
  color: #85692f;
}
.product-dates {
  font-size: 10px;
  margin-top: 6px;
  color: #60756a;
}
.product-dates span {
  padding: 0 5px;
}
.care-note {
  padding: 0 4px;
  margin-top: -8px;
  font-size: 11px;
  line-height: 1.8;
  color: #60756a;
}
.log-details {
  display: block;
}
.log-details > summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  list-style: none;
  cursor: pointer;
}
.log-details > summary::-webkit-details-marker {
  display: none;
}
.log-details summary strong,
.log-details summary small {
  display: block;
}
.log-details summary strong {
  font-size: 19px;
  margin: 6px 0 3px;
  letter-spacing: -0.5px;
}
.log-details summary small {
  font-size: 11px;
  color: #60756a;
}
.details-toggle {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border-radius: 50%;
  border: 1px solid #cbdccd;
  color: #245d42;
  font-size: 24px;
  line-height: 1;
  transition: transform 0.15s;
}
.log-details[open] .details-toggle {
  transform: rotate(45deg);
}
.log-details > p {
  margin-top: 18px;
  font-size: 12px;
}
.log-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 20px;
}
.log-filters label {
  flex: 1;
  min-width: 150px;
  display: grid;
  gap: 6px;
  font-size: 11px;
  color: #4d695a;
}
.log-filters input,
.log-filters select {
  box-sizing: border-box;
  width: 100%;
  min-height: 42px;
  padding: 8px 10px;
  border: 1px solid #cbded8;
  border-radius: 8px;
  background: white;
  color: #203e3b;
  font: inherit;
}
.timeline {
  list-style: none;
  padding: 4px 0 4px 24px;
  margin: 18px 0 0 5px;
  border-left: 1px solid #cedfd2;
  display: grid;
  gap: 24px;
}
.timeline > li {
  position: relative;
  display: grid;
  gap: 6px;
  min-width: 0;
  font-size: 12px;
}
.timeline > li::before {
  content: '';
  position: absolute;
  left: -29px;
  top: 6px;
  width: 8px;
  height: 8px;
  background: #6d9b77;
  border: 2px solid white;
  border-radius: 50%;
  box-shadow: 0 0 0 1px #b1ceb6;
}
.timeline h3,
.timeline h4 {
  font-size: 14px;
}
.timeline .facts {
  background: #f6f9f6;
  border: 1px solid #e4ece5;
  padding: 10px 14px;
  border-radius: 10px;
  margin: 5px 0 0;
}
.timeline .facts > div {
  padding: 8px 0;
}
.proof-card {
  background: #f4f8f4;
  border-color: #d9e5da;
}
.proof-card h2 {
  font-size: 18px;
}
.proof-card > p:not(.eyebrow) {
  font-size: 11px;
}
.proof-card :deep(.va-alert) {
  border-radius: 10px;
  font-size: 12px;
}
.hash {
  overflow-wrap: anywhere;
  font-family: ui-monospace, monospace;
  font-size: 10px;
}
.trip {
  display: grid;
  gap: 7px;
  border-top: 1px solid #e5eeec;
  padding-top: 18px;
  font-size: 12px;
}
.trip > h3 {
  font-size: 15px;
  color: #296447;
}
.inspection-card {
  border-style: dashed;
  background: transparent;
  box-shadow: none;
}
.inspection-card h2 {
  font-size: 17px;
}
.inspection-card > p:last-child {
  font-size: 12px;
  color: #60756a;
}
.trace-footer {
  text-align: center;
  padding: 18px 12px 8px;
  font-size: 10px;
  color: #60756a;
  border-top: 1px solid #dfe8e2;
}
.footer-brand {
  display: block;
  font-size: 14px;
  font-weight: 700;
  color: #35654b;
  margin-bottom: 8px;
}
.trace-footer p + p {
  margin-top: 5px;
}
.state {
  text-align: center;
  justify-items: center;
  gap: 12px;
  padding: 48px 28px;
}
.state p {
  color: #60756a;
  font-size: 13px;
  max-width: 420px;
}
.state-symbol {
  display: grid;
  place-items: center;
  width: 54px;
  height: 54px;
  border-radius: 50%;
  background: #e8f2e9;
  color: #346b49;
  font:
    32px Georgia,
    serif;
}
.revoked-state .state-symbol {
  background: #faf0d9;
  color: #866320;
}
a:focus-visible,
input:focus-visible,
select:focus-visible,
summary:focus-visible {
  outline: 3px solid #7caf91;
  outline-offset: 4px;
}
@media (max-width: 640px) {
  .trace-page {
    padding: 0 18px 24px;
    gap: 18px;
  }
  .trace-header {
    padding: 20px 0;
    gap: 10px;
  }
  .trace-brand {
    font-size: 15px;
    gap: 8px;
  }
  .brand-symbol {
    width: 35px;
    height: 35px;
    border-radius: 11px;
  }
  .trace-brand small {
    font-size: 7px;
    letter-spacing: 1px;
  }
  .public-label {
    font-size: 9px;
    padding: 5px 8px;
  }
  .page-intro {
    padding: 16px 0 8px;
  }
  .page-intro h1 {
    font-size: 34px;
    letter-spacing: -1px;
  }
  .page-intro > p:last-child {
    font-size: 12px;
  }
  .lot-card {
    padding: 24px 22px 0;
    border-radius: 18px;
  }
  .lot-card h2 {
    font-size: 34px;
    max-width: 100%;
    margin-top: 24px;
  }
  .lot-farm,
  .lot-address {
    max-width: 100%;
  }
  .lot-illustration {
    display: none;
  }
  .lot-facts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 18px;
    margin-top: 20px;
  }
  .lot-facts > div:first-child {
    grid-column: 1/-1;
  }
  .lot-facts > div:first-child dd {
    font-size: 28px;
  }
  .lot-facts dd {
    font-size: 15px;
  }
  .lot-code {
    align-items: flex-start;
    gap: 10px;
  }
  .section-nav {
    gap: 6px;
  }
  .section-nav a {
    padding: 7px 11px;
    font-size: 11px;
  }
  .trace-card {
    padding: 22px;
    border-radius: 16px;
  }
  .origin-card > .facts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 18px;
  }
  .care-heading h2 {
    font-size: 24px;
  }
  .care-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
  }
  .log-details summary strong {
    font-size: 18px;
  }
  .log-filters {
    flex-direction: column;
  }
  .log-filters label {
    min-width: 0;
  }
}
@media (max-width: 360px) {
  .trace-page {
    padding-inline: 14px;
  }
  .public-label {
    font-size: 8px;
    padding: 4px 6px;
    gap: 4px;
  }
  .trace-brand {
    font-size: 14px;
  }
  .trace-brand small {
    letter-spacing: 0.5px;
  }
  .page-intro h1 {
    font-size: 30px;
  }
  .trace-card {
    padding: 18px;
  }
  .lot-card {
    padding-inline: 18px;
  }
  .origin-card > .facts {
    grid-template-columns: 1fr;
  }
  .facts > div {
    grid-template-columns: 1fr;
    gap: 3px;
  }
}
</style>
