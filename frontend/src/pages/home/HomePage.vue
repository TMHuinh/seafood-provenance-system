<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { VaBadge, VaButton, VaModal } from 'vuestic-ui'
import { useRouter } from 'vue-router'

import { useAuthStore } from '../../stores/auth.store'
import { useBatchesStore } from '../../stores/batches.store'
import {
  SPECIES_LABELS,
  STATUS_LABELS,
  ROLE_LABELS,
  type BlockchainRecord,
  type Role,
} from '../../types'

const authStore = useAuthStore()
const batchesStore = useBatchesStore()
const router = useRouter()

const {
  batches,
  batchesError,
  detail,
  detailLoading,
  detailVisible,
  loadingBatches,
  selectedBatch,
  summary,
} = storeToRefs(batchesStore)
const { loadBatches, openDetail } = batchesStore

const isAuthenticated = computed(() => authStore.isAuthenticated)
const initials = computed(() => {
  const name = authStore.fullName !== 'Khách' ? authStore.fullName : ''
  return name
    .split(/\s+/)
    .map((word) => word[0])
    .slice(-2)
    .join('')
    .toUpperCase()
})

const roleLabel = computed(() => {
  const role = authStore.user?.role as Role | undefined
  return role ? (ROLE_LABELS[role] ?? role) : ''
})

const EVENT_LABELS: Record<string, string> = {
  BATCH_CREATED: 'Tạo lô',
  FARMING_LOG_RECORDED: 'Nhật ký nuôi',
  HARVEST_RECORDED: 'Thu hoạch',
  TRANSPORT_RECORDED: 'Vận chuyển',
  DISTRIBUTION_RECORDED: 'Phân phối',
  QUALITY_INSPECTION_RECORDED: 'Kiểm tra chất lượng',
  OTHER: 'Sự kiện khác',
}

const BLOCK_STATUS: Record<string, { label: string; color: string }> = {
  PENDING: { label: 'Chờ ghi khối', color: 'warning' },
  SUCCESS: { label: 'Đã ghi khối', color: 'success' },
  FAILED: { label: 'Thất bại', color: 'danger' },
}

const STATUS_COLORS: Record<string, string> = {
  PREPARING: 'info',
  GROWING: 'success',
  READY_FOR_HARVEST: 'warning',
  HARVESTED: 'primary',
  COMPLETED: 'success',
  CANCELLED: 'danger',
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('vi-VN')
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat('vi-VN').format(value)
}

function shortHash(hash: string | null | undefined): string {
  if (!hash) return '—'
  return `${hash.slice(0, 10)}...${hash.slice(-6)}`
}

function statusLabel(record: BlockchainRecord): string {
  return BLOCK_STATUS[record.status]?.label ?? record.status
}

function statusColor(record: BlockchainRecord): string {
  return BLOCK_STATUS[record.status]?.color ?? 'grey'
}

function formatBlockDate(value: string | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

onMounted(async () => {
  if (isAuthenticated.value) {
    if (!authStore.user) {
      await authStore.fetchMe()
    }
    await loadBatches()
  }
})
</script>

<template>
  <main class="home-page">
    <!-- Hero -->
    <section class="hero">
      <div class="hero-inner">
        <div class="hero-content">
          <h1 class="hero-title">
            Truy xuất nguồn gốc<br />
            <span class="accent">thủy sản</span> minh bạch
          </h1>
          <p class="hero-text">
            Hệ thống giúp nông hộ, nhà vận chuyển và nhà phân phối ghi lại từng chặng
            hành trình của mẻ thủy sản — từ ao nuôi, thu hoạch, vận chuyển tới bàn ăn.
            Chi tiết lưu tại cơ sở dữ liệu, tính toàn vẹn bảo đảm trên chuỗi khối.
          </p>
          <div class="hero-actions">
            <template v-if="!isAuthenticated">
              <va-button size="large" gradient class="hero-cta" @click="router.push({ name: 'login' })">
                Đăng nhập
              </va-button>
              <va-button size="large" preset="outline" class="hero-cta-secondary" @click="router.push({ name: 'register' })">
                Đăng ký tài khoản
              </va-button>
            </template>
            <template v-else>
              <va-button size="large" gradient @click="router.push({ name: 'home' })">Khám phá trang chủ</va-button>
            </template>
          </div>
        </div>
      </div>
    </section>

    <!-- Khối tính năng (landing) -->
    <section v-if="!isAuthenticated" class="features">
      <h2 class="section-title">Một hệ thống, ba thành phần</h2>
      <div class="feature-grid">
        <div class="feature-card">
          <div class="feature-icon">🗂️</div>
          <h3>Lưu trữ chi tiết</h3>
          <p>
            Lô nuôi, ao trại, nhật ký, thu hoạch, vận chuyển, phân phối được
            ghi nhận đầy đủ qua Supabase.
          </p>
        </div>
        <div class="feature-card">
          <div class="feature-icon">✦</div>
          <h3>Chuỗi khối minh bạch</h3>
          <p>
            Mọi sự kiện quan trọng được băm (hash) lưu trong
            <code>blockchain_records</code> — không thể sửa, chỉ có thể bổ sung.
          </p>
        </div>
        <div class="feature-card">
          <div class="feature-icon">📱</div>
          <h3>Tra cứu nhanh</h3>
          <p>
            Người tiêu dùng tra cứu nguồn gốc bằng mã QR của từng lô hàng,
            biết chính xác đã trải qua những chặng nào.
          </p>
        </div>
      </div>
    </section>

    <!-- Dashboard khi đăng nhập -->
    <section v-else class="dashboard">
      <div class="greeting">
        <div class="avatar">{{ initials }}</div>
        <div>
          <p class="greeting-hello">Xin chào,</p>
          <h2 class="greeting-name">{{ authStore.fullName }}</h2>
          <p v-if="authStore.organizationName" class="greeting-meta">
            {{ authStore.organizationName }} · {{ roleLabel }}
          </p>
          <p v-else class="greeting-meta">{{ roleLabel }}</p>
        </div>
      </div>

      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-value">{{ summary?.total ?? '—' }}</div>
          <div class="stat-label">Tổng số lô</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ summary?.byStatus?.GROWING ?? 0 }}</div>
          <div class="stat-label">Đang nuôi</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ summary?.byStatus?.HARVESTED ?? 0 }}</div>
          <div class="stat-label">Đã thu hoạch</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ batches.length }}</div>
          <div class="stat-label">Lô hiển thị</div>
        </div>
      </div>

      <div class="list-card">
        <div class="list-header">
          <h3>Danh sách lô hàng</h3>
          <va-button preset="primary" size="small" :loading="loadingBatches" @click="loadBatches">
            Làm mới
          </va-button>
        </div>

        <va-alert v-if="batchesError" color="danger" class="mb-3">
          {{ batchesError }}
        </va-alert>
        <va-alert v-if="!loadingBatches && batches.length === 0 && !batchesError" color="info" class="mb-3">
          Chưa có lô hàng nào trong phạm vi của bạn.
        </va-alert>

        <div v-if="loadingBatches" class="list-loading">Đang tải...</div>

        <table v-else class="batch-table">
          <thead>
            <tr>
              <th>Mã lô</th>
              <th>Vùng nuôi</th>
              <th>Loài</th>
              <th>Ngày thả</th>
              <th>Trạng thái</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="batch in batches" :key="batch.id">
              <td class="mono">{{ batch.batch_code }}</td>
              <td>
                <div v-if="batch.pond" class="cell-primary">{{ batch.pond.pond_name }}</div>
                <div v-if="batch.pond" class="cell-secondary">{{ batch.pond.farm_name }}</div>
                <span v-else class="cell-secondary">—</span>
              </td>
              <td>{{ SPECIES_LABELS[batch.species] ?? batch.species }}</td>
              <td>{{ formatDate(batch.stocking_date) }}</td>
              <td>
                <va-badge
                  :color="STATUS_COLORS[batch.status] ?? 'grey'"
                  :label="STATUS_LABELS[batch.status] ?? batch.status"
                />
              </td>
              <td>
                <va-button size="small" preset="outline" @click="openDetail(batch)">
                  Xem chi tiết
                </va-button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <footer class="home-footer">
      <p>
        HIHI
      </p>
    </footer>

    <!-- Modal chi tiết + chuỗi khối -->
    <va-modal
      v-model="detailVisible"
      :title="selectedBatch ? `Lô ${selectedBatch.batch_code}` : ''"
      ok-text="Đóng"
      :hide-cancel="true"
      size="large"
      class="detail-modal"
    >
      <div v-if="detailLoading" class="detail-loading">Đang tải dữ liệu...</div>

      <div v-else-if="detail" class="detail-body">
        <div class="detail-grid">
          <div class="detail-section">
            <h4>Thông tin lô</h4>
            <dl class="detail-dl">
              <dt>Ao nuôi</dt>
              <dd>{{ detail.batch.pond?.pond_name ?? '—' }}</dd>
              <dt>Vùng/nông trại</dt>
              <dd>{{ detail.batch.pond?.farm?.farm_name ?? '—' }}</dd>
              <dt>Loài</dt>
              <dd>{{ SPECIES_LABELS[detail.batch.species] ?? detail.batch.species }}</dd>
              <dt>Nguồn con giống</dt>
              <dd>{{ detail.batch.seed_source ?? '—' }}</dd>
              <dt>Số lượng thả</dt>
              <dd>{{ formatNumber(detail.batch.seed_quantity) }} con</dd>
              <dt>Ngày thả</dt>
              <dd>{{ formatDate(detail.batch.stocking_date) }}</dd>
              <dt>Ngày thu hoạch dự kiến</dt>
              <dd>{{ formatDate(detail.batch.expected_harvest_date) }}</dd>
              <dt>Trạng thái</dt>
              <dd>
                <va-badge
                  :color="STATUS_COLORS[detail.batch.status] ?? 'grey'"
                  :label="STATUS_LABELS[detail.batch.status] ?? detail.batch.status"
                />
              </dd>
            </dl>
          </div>

          <div class="detail-section">
            <h4>Hành trình ghi nhận</h4>
            <div class="detail-stats">
              <div class="mini-stat"><span>{{ detail.summary.farmingLogs }}</span> nhật ký</div>
              <div class="mini-stat"><span>{{ detail.harvests.length }}</span> thu hoạch</div>
              <div class="mini-stat"><span>{{ detail.transports.length }}</span> vận chuyển</div>
            </div>
          </div>

          <div class="detail-section full">
            <h4>Chuỗi khối minh bạch (blockchain)</h4>
            <div v-if="detail.blockchain.length === 0" class="empty-note">
              Lô này chưa có bản ghi trên chuỗi khối.
            </div>
            <table v-else class="chain-table">
              <thead>
                <tr>
                  <th>Sự kiện</th>
                  <th>Trạng thái</th>
                  <th>Data hash</th>
                  <th>TX hash</th>
                  <th>Khối</th>
                  <th>Thời điểm</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="record in detail.blockchain" :key="record.id">
                  <td>{{ EVENT_LABELS[record.event_type] ?? record.event_type }}</td>
                  <td>
                    <va-badge
                      :color="statusColor(record)"
                      :label="statusLabel(record)"
                    />
                  </td>
                  <td class="mono">{{ shortHash(record.data_hash) }}</td>
                  <td class="mono">{{ shortHash(record.transaction_hash) }}</td>
                  <td class="mono">{{ record.block_number ?? '—' }}</td>
                  <td>{{ formatBlockDate(record.recorded_at ?? record.created_at) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </va-modal>
  </main>
</template>

<style scoped>
.home-page {
  padding: 0 2rem 3rem;
  max-width: 1180px;
  margin: 0 auto;
}

.hero {
  padding: 4.5rem 0 3rem;
  text-align: center;
}

.hero-inner {
  max-width: 860px;
  margin: 0 auto;
}

.accent {
  background: linear-gradient(120deg, #0e7490, #0d9488 55%, #2dd4bf);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.hero-title {
  font-size: clamp(2rem, 4.5vw, 3.2rem);
  font-weight: 800;
  line-height: 1.2;
  color: #0f172a;
  margin: 0 0 1.25rem;
}

.hero-sub,
.hero-text {
  color: #475569;
  font-size: 1.05rem;
  line-height: 1.75;
  max-width: 62ch;
  margin: 0 auto 2rem;
}

.hero-actions {
  display: flex;
  justify-content: center;
  gap: 1rem;
  flex-wrap: wrap;
}

.hero-cta {
  min-width: 170px;
}

.hero-cta-secondary {
  min-width: 170px;
  color: #0e7490;
  border-color: #0e7490;
}

.features {
  padding: 2rem 0 2.5rem;
}

.section-title {
  font-size: 1.6rem;
  font-weight: 700;
  color: #0f172a;
  text-align: center;
  margin: 0 0 2rem;
}

.feature-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1.5rem;
}

.feature-card {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  padding: 1.75rem 1.5rem;
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.05);
}

.feature-icon {
  width: 46px;
  height: 46px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.35rem;
  background: linear-gradient(135deg, rgba(14, 116, 144, 0.12), rgba(20, 184, 166, 0.12));
  margin-bottom: 1rem;
}

.feature-card h3 {
  font-size: 1.05rem;
  font-weight: 700;
  color: #0f172a;
  margin: 0 0 0.5rem;
}

.feature-card p {
  color: #64748b;
  font-size: 0.92rem;
  line-height: 1.65;
  margin: 0;
}

.feature-card code {
  background: #f1f5f9;
  padding: 0.1rem 0.35rem;
  border-radius: 5px;
  font-size: 0.85em;
}

.dashboard {
  padding: 3rem 0 1rem;
  display: flex;
  flex-direction: column;
  gap: 1.75rem;
}

.greeting {
  display: flex;
  align-items: center;
  gap: 1.1rem;
}

.greeting-hello {
  margin: 0;
  color: #64748b;
  font-size: 0.95rem;
}

.greeting-name {
  margin: 0;
  font-size: 1.7rem;
  font-weight: 800;
  color: #0f172a;
}

.greeting-meta {
  margin: 0.15rem 0 0;
  color: #0e7490;
  font-size: 0.9rem;
  font-weight: 600;
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1.25rem;
}

.stat-card {
  background: linear-gradient(135deg, #0f172a, #134e4a);
  color: #fff;
  border-radius: 14px;
  padding: 1.4rem 1.5rem;
}

.stat-value {
  font-size: 2.1rem;
  font-weight: 800;
  line-height: 1;
}

.stat-label {
  margin-top: 0.5rem;
  font-size: 0.85rem;
  color: #a7c7bd;
}

.list-card {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  padding: 1.5rem;
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.05);
}

.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.25rem;
}

.list-header h3 {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 700;
  color: #0f172a;
}

.list-loading,
.detail-loading {
  color: #64748b;
  padding: 1.5rem;
  text-align: center;
}

.batch-table,
.chain-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.92rem;
}

.batch-table th,
.chain-table th {
  text-align: left;
  font-size: 0.8rem;
  font-weight: 700;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.6rem 0.75rem;
  border-bottom: 1px solid #e2e8f0;
}

.batch-table td,
.chain-table td {
  padding: 0.75rem;
  border-bottom: 1px solid #f1f5f9;
  color: #334155;
  vertical-align: middle;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.86em;
}

.cell-primary {
  font-weight: 600;
  color: #0f172a;
}

.cell-secondary {
  font-size: 0.84em;
  color: #94a3b8;
}

.show-link {
  color: #0e7490;
  font-weight: 600;
}

.detail-body {
  padding: 0.5rem 0;
}

.detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.75rem;
}

.detail-section h4 {
  margin: 0 0 0.9rem;
  font-size: 0.95rem;
  font-weight: 700;
  color: #0f172a;
}

.detail-section.full {
  grid-column: 1 / -1;
}

.detail-dl {
  margin: 0;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.35rem 1.25rem;
  font-size: 0.92rem;
}

.detail-dl dt {
  color: #64748b;
  font-weight: 600;
}

.detail-dl dd {
  margin: 0;
  color: #0f172a;
}

.detail-stats {
  display: flex;
  gap: 1.25rem;
  flex-wrap: wrap;
}

.mini-stat {
  flex: 1;
  min-width: 90px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 0.9rem 1rem;
  text-align: center;
  color: #64748b;
  font-size: 0.85rem;
}

.mini-stat span {
  display: block;
  font-size: 1.35rem;
  font-weight: 800;
  color: #0f172a;
}

.empty-note {
  color: #64748b;
  padding: 1rem;
  background: #f8fafc;
  border-radius: 10px;
  font-size: 0.92rem;
}

.home-footer {
  text-align: center;
  color: #94a3b8;
  font-size: 0.85rem;
  padding-top: 3rem;
}

.mb-3 {
  margin-bottom: 1rem;
}

@media (max-width: 960px) {
  .feature-grid {
    grid-template-columns: 1fr;
  }
  .stat-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .detail-grid {
    grid-template-columns: 1fr;
  }
  .detail-section.full {
    grid-column: auto;
  }
  .batch-table {
    display: block;
    overflow-x: auto;
  }
}
</style>
