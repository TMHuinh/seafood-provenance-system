<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { VaBadge, VaButton, VaModal, VaInnerLoading } from 'vuestic-ui'
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
  BATCH_CREATED: 'Khởi tạo lô mới',
  FARMING_LOG_RECORDED: 'Cập nhật nhật ký nuôi',
  HARVEST_RECORDED: 'Thu hoạch',
  TRANSPORT_RECORDED: 'Vận chuyển',
  DISTRIBUTION_RECORDED: 'Phân phối/Chế biến',
  QUALITY_INSPECTION_RECORDED: 'Kiểm tra chất lượng',
  OTHER: 'Sự kiện khác',
}

const BLOCK_STATUS: Record<string, { label: string; color: string }> = {
  PENDING: { label: 'Đang xác thực', color: 'warning' },
  SUCCESS: { label: 'Đã lưu chuỗi khối', color: 'success' },
  FAILED: { label: 'Thất bại', color: 'danger' },
}

const STATUS_COLORS: Record<string, string> = {
  PREPARING: 'info',
  GROWING: 'primary',
  READY_FOR_HARVEST: 'warning',
  HARVESTED: 'success',
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
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`
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

function getEventIcon(eventType: string): string {
  const icons: Record<string, string> = {
    BATCH_CREATED: 'M12 4.5v15m7.5-7.5h-15',
    FARMING_LOG_RECORDED: 'M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125',
    HARVEST_RECORDED: 'M8 16.5V19m8-2.5V19M3 14h18m-9-3.5v-7',
    TRANSPORT_RECORDED: 'M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12',
    DISTRIBUTION_RECORDED: 'M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V15a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .415.336.75.75.75z',
  }
  return icons[eventType] || 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
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
  <main class="home-page-promax">
    <!-- KHU VỰC CHƯA ĐĂNG NHẬP (LANDING PAGE) -->
    <template v-if="!isAuthenticated">
      <!-- Hero Section -->
      <section class="hero-promax">
        <div class="hero-glow-1"></div>
        <div class="hero-glow-2"></div>
        <div class="hero-content-wrapper">
          <div class="badge-pill-promax">
            <span class="badge-dot"></span> Nền tảng Blockchain Thế Hệ Mới
          </div>
          <h1 class="hero-title">
            Minh bạch toàn chuỗi<br />
            <span class="text-gradient">Nguồn gốc thủy sản</span>
          </h1>
          <p class="hero-desc">
            Bảo vệ thương hiệu và xây dựng niềm tin. Dữ liệu từ ao nuôi đến bàn ăn được mã hóa bằng chuẩn mật mã học và lưu trữ vĩnh viễn trên mạng lưới Blockchain phân tán.
          </p>
          <div class="hero-actions">
            <va-button size="large" class="btn-promax-primary" @click="router.push({ name: 'login' })">
              Đăng nhập hệ thống
              <svg class="icon-right" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
            </va-button>
            <va-button size="large" preset="secondary" class="btn-promax-outline" @click="router.push({ name: 'register' })">
              Trở thành đối tác
            </va-button>
          </div>
        </div>
      </section>

      <!-- Workflow Section -->
      <section class="workflow-section">
        <div class="section-header">
          <h2 class="section-title">Hành trình truy xuất <span class="text-highlight">chuẩn quốc tế</span></h2>
          <p class="section-subtitle">Dữ liệu được ghi nhận và đóng khối (block) qua 4 giai đoạn quan trọng</p>
        </div>
        <div class="workflow-grid">
          <div class="step-card">
            <div class="step-icon-wrap"><div class="step-icon">1</div></div>
            <h3>Ao nuôi</h3>
            <p>Ghi nhận nhật ký ăn, thuốc thú y, môi trường nước theo chuẩn VietGAP.</p>
          </div>
          <div class="step-connector"><div class="line-dashed"></div></div>
          <div class="step-card">
            <div class="step-icon-wrap"><div class="step-icon">2</div></div>
            <h3>Thu hoạch</h3>
            <p>Kiểm định chất lượng sinh học, đóng lô, gắn mã định danh điện tử.</p>
          </div>
          <div class="step-connector"><div class="line-dashed"></div></div>
          <div class="step-card">
            <div class="step-icon-wrap"><div class="step-icon">3</div></div>
            <h3>Vận chuyển</h3>
            <p>Giám sát nhiệt độ bảo quản, thời gian và lộ trình di chuyển liên tục.</p>
          </div>
          <div class="step-connector"><div class="line-dashed"></div></div>
          <div class="step-card">
            <div class="step-icon-wrap"><div class="step-icon">4</div></div>
            <h3>Bàn ăn</h3>
            <p>Khách hàng quét mã QR để đối soát toàn bộ lịch sử trên Blockchain.</p>
          </div>
        </div>
      </section>
    </template>

    <!-- KHU VỰC ĐÃ ĐĂNG NHẬP (DASHBOARD) -->
    <template v-else>
      <div class="dashboard-wrapper">
        <!-- Header Dashboard -->
        <header class="dash-header-promax">
          <div class="dash-greeting">
            <div class="user-avatar-promax">{{ initials }}</div>
            <div class="user-info">
              <p class="greeting-text">Không gian làm việc của</p>
              <h2 class="user-name">{{ authStore.fullName }}</h2>
              <div class="user-badges">
                <span class="role-badge-promax">{{ roleLabel }}</span>
                <span v-if="authStore.organizationName" class="org-name-promax">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>
                  {{ authStore.organizationName }}
                </span>
              </div>
            </div>
          </div>
          <va-button preset="secondary" @click="router.push({ name: 'farms' })">
            Quản lý cơ sở nuôi
          </va-button>
        </header>

        <!-- Thống kê (Clean UI) -->
        <div class="stats-grid-promax">
          <div class="stat-card-clean">
            <div class="stat-icon-box bg-slate">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
            </div>
            <div class="stat-content">
              <p class="stat-title">Tổng số lô quản lý</p>
              <h3 class="stat-number">{{ summary?.total ?? '0' }}</h3>
            </div>
          </div>
          
          <div class="stat-card-clean">
            <div class="stat-icon-box bg-blue">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
            </div>
            <div class="stat-content">
              <p class="stat-title">Đang sinh trưởng</p>
              <h3 class="stat-number">{{ summary?.byStatus?.GROWING ?? 0 }}</h3>
            </div>
          </div>

          <div class="stat-card-clean">
            <div class="stat-icon-box bg-teal">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            </div>
            <div class="stat-content">
              <p class="stat-title">Đã thu hoạch</p>
              <h3 class="stat-number">{{ summary?.byStatus?.HARVESTED ?? 0 }}</h3>
            </div>
          </div>

          <div class="stat-card-clean">
            <div class="stat-icon-box bg-amber">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
            </div>
            <div class="stat-content">
              <p class="stat-title">Chờ ghi Blockchain</p>
              <h3 class="stat-number">0</h3>
            </div>
          </div>
        </div>

        <!-- Bảng danh sách lô -->
        <div class="table-card-promax">
          <div class="table-header-promax">
            <div>
              <h3 class="th-title">Hồ Sơ Lô Thủy Sản</h3>
              <p class="th-subtitle">Danh sách các lô hàng đang được ghi nhận trên hệ thống</p>
            </div>
            <va-button preset="secondary" color="secondary" @click="loadBatches" :loading="loadingBatches" class="btn-refresh">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" class="mr-1"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
              Làm mới
            </va-button>
          </div>

          <va-alert v-if="batchesError" color="danger" class="mb-4">
            {{ batchesError }}
          </va-alert>

          <div v-if="loadingBatches" class="empty-state-promax">
            <va-inner-loading loading :size="40" color="#0e7490" />
            <p class="mt-4 text-gray-500">Đang đồng bộ dữ liệu từ máy chủ...</p>
          </div>

          <div v-else-if="batches.length === 0" class="empty-state-promax">
            <div class="empty-icon">
              <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1"><path stroke-linecap="round" stroke-linejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"/></svg>
            </div>
            <h4>Không có dữ liệu</h4>
            <p>Bạn chưa có lô thủy sản nào trong hệ thống.</p>
          </div>

          <div v-else class="table-responsive">
            <table class="table-promax">
              <thead>
                <tr>
                  <th>Mã định danh (ID)</th>
                  <th>Cơ sở / Vùng nuôi</th>
                  <th>Chủng loại</th>
                  <th>Ngày thả giống</th>
                  <th>Trạng thái</th>
                  <th class="text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="batch in batches" :key="batch.id">
                  <td>
                    <span class="badge-code">{{ batch.batch_code }}</span>
                  </td>
                  <td>
                    <div class="cell-title">{{ batch.pond?.pond_name ?? '—' }}</div>
                    <div class="cell-sub">{{ batch.pond?.farm_name ?? '' }}</div>
                  </td>
                  <td>
                    <span class="badge-species">{{ SPECIES_LABELS[batch.species] ?? batch.species }}</span>
                  </td>
                  <td class="cell-text">{{ formatDate(batch.stocking_date) }}</td>
                  <td>
                    <va-badge
                      :color="STATUS_COLORS[batch.status] ?? 'grey'"
                      :text="STATUS_LABELS[batch.status] ?? batch.status"
                      class="badge-status-promax"
                    />
                  </td>
                  <td class="text-right">
                    <button class="btn-action-promax" @click="openDetail(batch)">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                      Chi tiết
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </template>

    <!-- MODAL CHI TIẾT & BLOCKCHAIN TIMELINE -->
    <va-modal v-model="detailVisible" hide-default-actions size="large" class="modal-promax">
      <template #header>
        <div class="modal-header-promax">
          <div class="mh-left">
            <div class="mh-icon">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
            </div>
            <div>
              <h2 class="mh-title">Hồ Sơ Lô Nuôi</h2>
              <p class="mh-subtitle">Mã truy xuất: <span class="text-primary font-mono">{{ selectedBatch?.batch_code }}</span></p>
            </div>
          </div>
          <button class="btn-close-modal" @click="detailVisible = false">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
      </template>

      <div v-if="detailLoading" class="modal-loading-promax">
        <va-inner-loading loading :size="40" color="#0e7490" />
        <p>Đang truy xuất mạng lưới chuỗi khối...</p>
      </div>

      <div v-else-if="detail" class="detail-grid-promax">
        <!-- Cột trái: Thông tin -->
        <div class="col-info">
          <div class="card-info-promax mb-4">
            <h4 class="card-title-promax">Thông Tin Cơ Bản</h4>
            <div class="info-list-promax">
              <div class="info-row">
                <span class="ir-label">Trạng thái</span>
                <va-badge :color="STATUS_COLORS[detail.batch.status]" :text="STATUS_LABELS[detail.batch.status]" class="badge-status-promax" />
              </div>
              <div class="info-row">
                <span class="ir-label">Chủng loại</span>
                <span class="ir-val fw-600">{{ SPECIES_LABELS[detail.batch.species] }}</span>
              </div>
              <div class="info-row">
                <span class="ir-label">Cơ sở sản xuất</span>
                <span class="ir-val">{{ detail.batch.pond?.farm?.farm_name ?? '—' }}</span>
              </div>
              <div class="info-row">
                <span class="ir-label">Khu vực / Ao bể</span>
                <span class="ir-val">{{ detail.batch.pond?.pond_name ?? '—' }}</span>
              </div>
              <div class="info-row">
                <span class="ir-label">Lượng giống thả</span>
                <span class="ir-val">{{ formatNumber(detail.batch.seed_quantity) }} con</span>
              </div>
              <div class="info-row">
                <span class="ir-label">Ngày khởi tạo</span>
                <span class="ir-val">{{ formatDate(detail.batch.stocking_date) }}</span>
              </div>
            </div>
          </div>

          <div class="card-info-promax">
            <h4 class="card-title-promax">Tổng Hợp Dữ Liệu</h4>
            <div class="stats-mini-promax">
              <div class="sm-box">
                <span class="sm-num text-slate">{{ detail.summary.farmingLogs }}</span>
                <span class="sm-label">Nhật ký</span>
              </div>
              <div class="sm-box">
                <span class="sm-num text-teal">{{ detail.harvests.length }}</span>
                <span class="sm-label">Thu hoạch</span>
              </div>
              <div class="sm-box">
                <span class="sm-num text-blue">{{ detail.transports.length }}</span>
                <span class="sm-label">Vận chuyển</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Cột phải: Blockchain Timeline -->
        <div class="col-blockchain">
          <div class="cb-header">
            <h4 class="card-title-promax mb-0">Nhật Ký Blockchain</h4>
            <div class="secure-badge-promax">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>
              Xác thực Toàn vẹn
            </div>
          </div>

          <div v-if="detail.blockchain.length === 0" class="empty-timeline-promax">
            <p>Chưa có dữ liệu giao dịch trên chuỗi khối.</p>
          </div>

          <div v-else class="timeline-wrapper-promax">
            <div class="timeline-item-promax" v-for="(record, index) in detail.blockchain" :key="record.id">
              <div class="tl-line" v-if="index !== detail.blockchain.length - 1"></div>
              
              <div class="tl-marker" :class="`marker-${record.status.toLowerCase()}`">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5">
                  <path stroke-linecap="round" stroke-linejoin="round" :d="getEventIcon(record.event_type)" />
                </svg>
              </div>

              <div class="tl-content-card">
                <div class="tl-card-header">
                  <h5>{{ EVENT_LABELS[record.event_type] ?? record.event_type }}</h5>
                  <span class="time">{{ formatBlockDate(record.recorded_at ?? record.created_at) }}</span>
                </div>
                
                <div class="tl-card-body terminal-style">
                  <div class="hash-line">
                    <span class="h-label">TX_HASH:</span>
                    <span class="h-value" :title="record.transaction_hash || undefined">{{ shortHash(record.transaction_hash) }}</span>
                  </div>
                  <div class="hash-line">
                    <span class="h-label">DATA_HASH:</span>
                    <span class="h-value" :title="record.data_hash || undefined">{{ shortHash(record.data_hash) }}</span>
                  </div>
                  <div class="hash-status mt-2">
                    <span class="status-dot" :class="`bg-${statusColor(record)}`"></span>
                    <span class="status-text">{{ statusLabel(record) }}</span>
                    <span v-if="record.block_number" class="block-badge">Block #{{ record.block_number }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </va-modal>

    <footer class="footer-promax">
      <p>&copy; 2024 Nền tảng Truy xuất nguồn gốc Thủy sản Blockchain.</p>
    </footer>
  </main>
</template>

<style>
/* ==========================================================
   GLOBAL TYPOGRAPHY OVERRIDE - Ép font Inter toàn hệ thống
   ========================================================== */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

.home-page-promax,
.home-page-promax * {
  font-family: 'Inter', system-ui, -apple-system, sans-serif !important;
}

/* Utilities */
.mb-0 { margin-bottom: 0 !important; }
.mb-4 { margin-bottom: 1.5rem !important; }
.mt-2 { margin-top: 0.5rem !important; }
.mt-4 { margin-top: 1rem !important; }
.mr-1 { margin-right: 0.25rem !important; }
.mr-2 { margin-right: 0.5rem !important; }
.text-right { text-align: right !important; }
.fw-600 { font-weight: 600 !important; }
.font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important; }
.text-primary { color: #0e7490; }

/* Colors */
.bg-success { background-color: #10b981; }
.bg-warning { background-color: #f59e0b; }
.bg-danger { background-color: #ef4444; }

/* ==========================================================
   LANDING PAGE (HERO & WORKFLOW)
   ========================================================== */
.hero-promax {
  position: relative;
  background-color: #020617;
  padding: 7rem 2rem 8rem;
  border-radius: 0 0 48px 48px;
  overflow: hidden;
  text-align: center;
  margin-bottom: 5rem;
}
.hero-glow-1 {
  position: absolute; width: 600px; height: 600px;
  background: radial-gradient(circle, rgba(14,116,144,0.3) 0%, rgba(2,6,23,0) 70%);
  top: -200px; left: -100px; border-radius: 50%; pointer-events: none;
}
.hero-glow-2 {
  position: absolute; width: 800px; height: 800px;
  background: radial-gradient(circle, rgba(20,184,166,0.15) 0%, rgba(2,6,23,0) 70%);
  bottom: -400px; right: -200px; border-radius: 50%; pointer-events: none;
}
.hero-content-wrapper {
  position: relative; z-index: 10; max-width: 860px; margin: 0 auto;
}
.badge-pill-promax {
  display: inline-flex; align-items: center; gap: 8px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #cbd5e1; padding: 6px 16px; border-radius: 100px;
  font-size: 0.875rem; font-weight: 500; margin-bottom: 2rem;
  backdrop-filter: blur(10px);
}
.badge-dot {
  width: 8px; height: 8px; background: #2dd4bf; border-radius: 50%;
  box-shadow: 0 0 10px #2dd4bf;
}
.hero-title {
  font-size: 4rem; font-weight: 800; color: #ffffff;
  line-height: 1.15; margin-bottom: 1.5rem; letter-spacing: -0.03em;
}
.text-gradient {
  background: linear-gradient(135deg, #2dd4bf, #3b82f6);
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
}
.hero-desc {
  font-size: 1.15rem; color: #94a3b8; line-height: 1.6;
  max-width: 680px; margin: 0 auto 3rem; font-weight: 400;
}
.hero-actions { display: flex; gap: 1rem; justify-content: center; }

.btn-promax-primary {
  --va-button-color: #0e7490 !important;
  background: linear-gradient(135deg, #0e7490, #0891b2) !important;
  border-radius: 12px !important; font-weight: 600 !important;
  box-shadow: 0 8px 24px rgba(14, 116, 144, 0.3) !important;
  transition: all 0.3s ease !important;
}
.btn-promax-primary:hover { transform: translateY(-2px); box-shadow: 0 12px 32px rgba(14, 116, 144, 0.4) !important; }
.btn-promax-primary .icon-right { margin-left: 8px; transition: transform 0.3s ease; }
.btn-promax-primary:hover .icon-right { transform: translateX(4px); }

.btn-promax-outline {
  --va-button-color: transparent !important;
  border: 1px solid rgba(255,255,255,0.2) !important;
  color: white !important; border-radius: 12px !important; font-weight: 600 !important;
}
.btn-promax-outline:hover { background: rgba(255,255,255,0.05) !important; }

/* Workflow */
.workflow-section { max-width: 1200px; margin: 0 auto 6rem; padding: 0 2rem; }
.section-header { text-align: center; margin-bottom: 4rem; }
.section-title { font-size: 2.25rem; font-weight: 800; color: #0f172a; letter-spacing: -0.02em; margin-bottom: 0.75rem; }
.text-highlight { color: #0e7490; }
.section-subtitle { color: #64748b; font-size: 1.1rem; }
.workflow-grid { display: flex; justify-content: space-between; align-items: flex-start; }
.step-card { flex: 1; text-align: center; padding: 0 1rem; }
.step-icon-wrap {
  width: 72px; height: 72px; margin: 0 auto 1.5rem;
  background: #f0fdfa; border-radius: 20px;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 10px 25px -5px rgba(20, 184, 166, 0.15);
}
.step-icon { font-size: 1.75rem; font-weight: 800; color: #0d9488; }
.step-card h3 { font-size: 1.25rem; font-weight: 700; color: #0f172a; margin-bottom: 0.75rem; }
.step-card p { font-size: 0.95rem; color: #64748b; line-height: 1.6; }
.step-connector { flex: 0 0 80px; padding-top: 36px; display: flex; align-items: center; justify-content: center; }
.line-dashed { width: 100%; border-top: 2px dashed #cbd5e1; position: relative; }
.line-dashed::after {
  content: ''; position: absolute; right: -4px; top: -5px;
  width: 8px; height: 8px; border-right: 2px solid #cbd5e1; border-top: 2px solid #cbd5e1;
  transform: rotate(45deg);
}

/* ==========================================================
   DASHBOARD (AUTHENTICATED)
   ========================================================== */
.dashboard-wrapper { max-width: 1240px; margin: 2rem auto; padding: 0 2rem; background: #f8fafc; min-height: 100vh;}
.dash-header-promax {
  display: flex; justify-content: space-between; align-items: center;
  background: white; padding: 1.5rem 2rem; border-radius: 24px;
  box-shadow: 0 4px 6px -1px rgba(0,0,0,0.02), 0 2px 4px -2px rgba(0,0,0,0.02);
  border: 1px solid #f1f5f9; margin-bottom: 2rem;
}
.dash-greeting { display: flex; align-items: center; gap: 1.25rem; }
.user-avatar-promax {
  width: 56px; height: 56px; border-radius: 18px;
  background: linear-gradient(135deg, #0f172a, #334155); color: white;
  display: flex; align-items: center; justify-content: center;
  font-size: 1.25rem; font-weight: 700; box-shadow: 0 8px 16px rgba(15, 23, 42, 0.15);
}
.greeting-text { font-size: 0.875rem; color: #64748b; margin: 0; font-weight: 500;}
.user-name { font-size: 1.5rem; font-weight: 800; color: #0f172a; margin: 0.1rem 0 0.3rem; letter-spacing: -0.01em;}
.user-badges { display: flex; gap: 0.75rem; align-items: center; }
.role-badge-promax {
  background: #f1f5f9; color: #475569; padding: 3px 10px; border-radius: 8px;
  font-size: 0.75rem; font-weight: 600; border: 1px solid #e2e8f0;
}
.org-name-promax {
  display: flex; align-items: center; gap: 4px; color: #0e7490;
  font-size: 0.85rem; font-weight: 600;
}
.btn-create-batch {
  --va-button-color: #0f172a !important;
  border-radius: 12px !important; font-weight: 600 !important;
}

/* Stats Clean UI */
.stats-grid-promax {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 1.5rem; margin-bottom: 2rem;
}
.stat-card-clean {
  background: white; padding: 1.5rem; border-radius: 20px;
  border: 1px solid #f1f5f9;
  box-shadow: 0 4px 6px -1px rgba(0,0,0,0.02), 0 2px 4px -2px rgba(0,0,0,0.02);
  display: flex; align-items: flex-start; gap: 1.25rem;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.stat-card-clean:hover {
  transform: translateY(-2px); box-shadow: 0 10px 15px -3px rgba(0,0,0,0.05);
}
.stat-icon-box {
  width: 48px; height: 48px; border-radius: 14px;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.bg-slate { background: #f1f5f9; color: #475569; }
.bg-blue { background: #eff6ff; color: #3b82f6; }
.bg-teal { background: #f0fdfa; color: #14b8a6; }
.bg-amber { background: #fffbeb; color: #d97706; }
.stat-title { font-size: 0.875rem; color: #64748b; margin: 0 0 0.25rem; font-weight: 500;}
.stat-number { font-size: 1.75rem; font-weight: 800; color: #0f172a; margin: 0; line-height: 1.2;}

/* Table Promax */
.table-card-promax {
  background: white; border-radius: 24px; padding: 1.5rem;
  box-shadow: 0 4px 6px -1px rgba(0,0,0,0.02); border: 1px solid #f1f5f9;
}
.table-header-promax {
  display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;
  padding: 0 0.5rem;
}
.th-title { font-size: 1.25rem; font-weight: 800; color: #0f172a; margin: 0 0 0.25rem; }
.th-subtitle { font-size: 0.9rem; color: #64748b; margin: 0; }
.btn-refresh { border-radius: 10px !important; font-weight: 600 !important; }

.table-promax { width: 100%; border-collapse: collapse; }
.table-promax th {
  text-align: left; padding: 1rem 1.25rem; font-size: 0.75rem; font-weight: 700;
  color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;
  border-bottom: 1px solid #e2e8f0; background: #f8fafc;
}
.table-promax th:first-child { border-top-left-radius: 12px; border-bottom-left-radius: 12px; }
.table-promax th:last-child { border-top-right-radius: 12px; border-bottom-right-radius: 12px; }
.table-promax td {
  padding: 1.25rem; border-bottom: 1px solid #f1f5f9; vertical-align: middle;
}
.table-promax tbody tr { transition: background 0.2s ease; }
.table-promax tbody tr:hover { background: #f8fafc; }

.badge-code {
  font-family: ui-monospace, SFMono-Regular, monospace;
  background: #f1f5f9; color: #334155; padding: 6px 10px; border-radius: 8px;
  font-size: 0.85rem; font-weight: 500; border: 1px solid #e2e8f0;
}
.cell-title { font-weight: 600; color: #0f172a; font-size: 0.95rem; }
.cell-sub { font-size: 0.85rem; color: #64748b; margin-top: 2px; }
.badge-species {
  background: #f0fdfa; color: #0f766e; padding: 6px 12px;
  border-radius: 20px; font-size: 0.85rem; font-weight: 600;
}
.cell-text { color: #334155; font-size: 0.95rem; }
.badge-status-promax { border-radius: 8px !important; font-weight: 600 !important; padding: 4px 8px !important;}
.btn-action-promax {
  display: inline-flex; align-items: center; gap: 6px;
  background: white; border: 1px solid #e2e8f0; color: #0f172a;
  padding: 8px 14px; border-radius: 10px; font-size: 0.85rem; font-weight: 600;
  cursor: pointer; transition: all 0.2s ease; box-shadow: 0 1px 2px rgba(0,0,0,0.05);
}
.btn-action-promax:hover { background: #f8fafc; border-color: #cbd5e1; }

.empty-state-promax { text-align: center; padding: 4rem 2rem; }
.empty-icon { color: #cbd5e1; margin-bottom: 1rem; display: flex; justify-content: center; }
.empty-state-promax h4 { font-size: 1.25rem; font-weight: 700; color: #0f172a; margin-bottom: 0.5rem; }
.empty-state-promax p { color: #64748b; }

/* ==========================================================
   MODAL & BLOCKCHAIN TIMELINE (TERMINAL STYLE)
   ========================================================== */
.modal-promax { --va-modal-padding: 0 !important; }
.modal-header-promax {
  display: flex; justify-content: space-between; align-items: flex-start;
  padding: 1.5rem 2rem; border-bottom: 1px solid #e2e8f0; background: #f8fafc;
  border-top-left-radius: 12px; border-top-right-radius: 12px;
}
.mh-left { display: flex; gap: 1rem; align-items: center; }
.mh-icon {
  width: 48px; height: 48px; background: white; border: 1px solid #e2e8f0;
  border-radius: 14px; display: flex; align-items: center; justify-content: center; color: #0e7490;
}
.mh-title { font-size: 1.25rem; font-weight: 800; color: #0f172a; margin: 0 0 0.25rem; }
.mh-subtitle { font-size: 0.9rem; color: #64748b; margin: 0; }
.btn-close-modal {
  background: none; border: none; color: #94a3b8; cursor: pointer; padding: 4px; border-radius: 8px; transition: background 0.2s;
}
.btn-close-modal:hover { background: #e2e8f0; color: #0f172a; }

.detail-grid-promax { display: grid; grid-template-columns: 1fr 1.4fr; gap: 2rem; padding: 2rem; }
.card-info-promax {
  border: 1px solid #e2e8f0; border-radius: 16px; padding: 1.5rem; background: white;
  box-shadow: 0 1px 3px rgba(0,0,0,0.02);
}
.card-title-promax { font-size: 1.05rem; font-weight: 700; color: #0f172a; margin: 0 0 1.25rem; }
.info-list-promax { display: flex; flex-direction: column; gap: 1rem; }
.info-row { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed #e2e8f0; padding-bottom: 0.75rem; }
.info-row:last-child { border-bottom: none; padding-bottom: 0; }
.ir-label { color: #64748b; font-size: 0.9rem; }
.ir-val { color: #0f172a; font-size: 0.95rem; font-weight: 500; text-align: right;}

.stats-mini-promax { display: flex; gap: 0.75rem; }
.sm-box {
  flex: 1; background: #f8fafc; border: 1px solid #f1f5f9; padding: 1rem;
  border-radius: 12px; text-align: center;
}
.sm-num { display: block; font-size: 1.5rem; font-weight: 800; margin-bottom: 0.25rem; }
.text-slate { color: #334155; }
.text-teal { color: #0f766e; }
.text-blue { color: #1d4ed8; }
.sm-label { font-size: 0.8rem; color: #64748b; font-weight: 500; }

/* Timeline Terminal Style */
.col-blockchain { background: white; border: 1px solid #e2e8f0; border-radius: 16px; padding: 1.5rem; }
.cb-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; }
.secure-badge-promax {
  display: flex; align-items: center; gap: 6px;
  background: #ecfdf5; color: #059669; padding: 6px 12px; border-radius: 100px;
  font-size: 0.85rem; font-weight: 600; border: 1px solid #a7f3d0;
}
.timeline-wrapper-promax { position: relative; }
.timeline-item-promax { position: relative; padding-left: 2.5rem; padding-bottom: 2rem; }
.timeline-item-promax:last-child { padding-bottom: 0; }
.tl-line {
  position: absolute; left: 13px; top: 32px; bottom: 0; width: 2px;
  background: #e2e8f0; z-index: 1;
}
.tl-marker {
  position: absolute; left: 0; top: 0; width: 28px; height: 28px;
  border-radius: 50%; display: flex; align-items: center; justify-content: center;
  z-index: 2; background: white; box-shadow: 0 0 0 4px white;
}
.marker-success { background: #10b981; color: white; }
.marker-pending { background: #f59e0b; color: white; }
.marker-failed { background: #ef4444; color: white; }

.tl-content-card {
  background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;
}
.tl-card-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 0.75rem 1rem; border-bottom: 1px solid #e2e8f0; background: white;
}
.tl-card-header h5 { margin: 0; font-size: 0.95rem; font-weight: 700; color: #0f172a; }
.tl-card-header .time { font-size: 0.8rem; color: #64748b; }

/* Terminal Effect */
.terminal-style {
  background: #0f172a; padding: 1rem; color: #a5b4fc; font-family: ui-monospace, monospace;
  font-size: 0.85rem;
}
.hash-line { margin-bottom: 6px; display: flex; align-items: flex-start; gap: 8px;}
.h-label { color: #64748b; font-weight: 600; flex-shrink: 0; }
.h-value { color: #2dd4bf; word-break: break-all; }
.hash-status { display: flex; align-items: center; gap: 8px; border-top: 1px dashed #334155; padding-top: 10px; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; }
.status-text { color: #f8fafc; font-weight: 500; font-family: 'Inter', sans-serif;}
.block-badge { margin-left: auto; background: rgba(255,255,255,0.1); color: #cbd5e1; padding: 2px 8px; border-radius: 6px; font-size: 0.75rem; font-family: 'Inter', sans-serif;}

.footer-promax { text-align: center; padding: 2rem; color: #94a3b8; font-size: 0.9rem; margin-top: auto; }

/* Responsive */
@media (max-width: 1024px) {
  .workflow-grid { flex-direction: column; gap: 1.5rem; }
  .step-connector { transform: rotate(90deg); padding-top: 0; flex: 0 0 40px;}
  .stats-grid-promax { grid-template-columns: repeat(2, 1fr); }
  .detail-grid-promax { grid-template-columns: 1fr; }
}
@media (max-width: 768px) {
  .hero-promax { padding: 5rem 1.5rem 6rem; }
  .hero-title { font-size: 2.5rem; }
  .dash-header-promax { flex-direction: column; align-items: stretch; gap: 1.5rem; }
  .btn-create-batch { width: 100%; justify-content: center; }
  .table-header-promax { flex-direction: column; align-items: flex-start; gap: 1rem; }
}
</style>
