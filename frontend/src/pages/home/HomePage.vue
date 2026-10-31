<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { VaBadge, VaButton, VaModal, VaInnerLoading, VaAlert, VaIcon } from 'vuestic-ui'
import { useRouter } from 'vue-router'

import { useAuthStore } from '../../stores/auth.store'
import { useBatchesStore } from '../../stores/batches.store'
import { api } from '../../api/client'
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
const farmCount = ref<number | null>(null)
const transportOverview = ref<{ available: Array<{ transport_code: string; from_location: string; to_location: string; quantity: number; lot: { lot_code: string } }>; assigned: Array<{ transport_code: string; status: string; from_location: string; to_location: string; quantity: number; lot: { lot_code: string } }> }>({ available: [], assigned: [] })
const loadingTransportOverview = ref(false)
const transportOverviewError = ref('')

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

const role = computed(() => authStore.user?.role ?? 'FARMER')
const roleCopy = computed(() => ({
  FARMER: { eyebrow: 'KHÔNG GIAN NGƯỜI NUÔI', title: 'Quản lý vùng nuôi, theo dõi từng vụ mùa', description: 'Từ cơ sở, ao nuôi đến thu hoạch và vận chuyển — mọi thông tin quan trọng được tập trung tại đây.', action: 'Mở cơ sở nuôi', actionIcon: 'domain', tableTitle: 'Vụ nuôi gần đây', tableDescription: 'Theo dõi trạng thái và hồ sơ nguồn gốc của các vụ nuôi.' },
  TRANSPORTER: { eyebrow: 'KHÔNG GIAN NGƯỜI VẬN CHUYỂN', title: 'Điều phối những chuyến hàng của bạn', description: 'Nhận yêu cầu vận chuyển, cập nhật thông tin phương tiện và theo dõi lô hàng đến điểm giao.', action: 'Mở điều phối', actionIcon: 'local_shipping', tableTitle: 'Tổng quan vận chuyển', tableDescription: 'Các yêu cầu chờ nhận và chuyến đang thực hiện.' },
  DISTRIBUTOR: { eyebrow: 'KHÔNG GIAN ĐỐI TÁC PHÂN PHỐI', title: 'Tra cứu hồ sơ nguồn gốc thủy sản', description: 'Xem thông tin lô hàng được chia sẻ với tổ chức của bạn và đối chiếu lịch sử truy xuất.', action: 'Xem hồ sơ lô', actionIcon: 'inventory_2', tableTitle: 'Hồ sơ lô có thể tra cứu', tableDescription: 'Thông tin truy xuất hiện có trong phạm vi tổ chức.' },
  ADMIN: { eyebrow: 'TRUNG TÂM QUẢN TRỊ', title: 'Tổng quan hoạt động hệ thống', description: 'Theo dõi hồ sơ lô, trạng thái sản xuất và hoạt động truy xuất trên toàn nền tảng.', action: 'Xem hồ sơ lô', actionIcon: 'admin_panel_settings', tableTitle: 'Hồ sơ lô mới nhất', tableDescription: 'Tình hình các vụ nuôi được ghi nhận trên nền tảng.' },
}[role.value]))

const homeStats = computed(() => {
  if (role.value === 'TRANSPORTER') return [
    { label: 'Yêu cầu mới', value: transportOverview.value.available.length, hint: 'Đang chờ người nhận', icon: 'inbox', tone: 'amber' },
    { label: 'Đang vận chuyển', value: transportOverview.value.assigned.filter((item) => item.status === 'IN_TRANSIT').length, hint: 'Chuyến đang thực hiện', icon: 'local_shipping', tone: 'blue' },
    { label: 'Chờ khởi hành', value: transportOverview.value.assigned.filter((item) => item.status === 'PLANNING').length, hint: 'Chuyến bạn đã nhận', icon: 'schedule', tone: 'teal' },
    { label: 'Đã bàn giao', value: transportOverview.value.assigned.filter((item) => item.status === 'DELIVERED').length, hint: 'Chuyến hoàn tất', icon: 'task_alt', tone: 'green' },
  ]
  if (role.value === 'FARMER') return [
    { label: 'Cơ sở nuôi', value: farmCount.value ?? '—', hint: 'Đang quản lý', icon: 'domain', tone: 'teal' },
    { label: 'Tổng vụ nuôi', value: summary.value?.total ?? 0, hint: 'Hồ sơ đã ghi nhận', icon: 'inventory_2', tone: 'blue' },
    { label: 'Đang nuôi', value: summary.value?.byStatus?.GROWING ?? 0, hint: 'Vụ đang sinh trưởng', icon: 'water', tone: 'green' },
    { label: 'Chờ thu hoạch', value: summary.value?.byStatus?.READY_FOR_HARVEST ?? 0, hint: 'Có thể ghi nhận thu hoạch', icon: 'agriculture', tone: 'amber' },
  ]
  if (role.value === 'DISTRIBUTOR') return [
    { label: 'Lô có thể tra cứu', value: summary.value?.total ?? 0, hint: 'Trong phạm vi tổ chức', icon: 'qr_code_2', tone: 'teal' },
    { label: 'Đã thu hoạch', value: summary.value?.byStatus?.HARVESTED ?? 0, hint: 'Có nguồn gốc lô hàng', icon: 'inventory_2', tone: 'green' },
    { label: 'Đang hoàn thiện', value: summary.value?.byStatus?.GROWING ?? 0, hint: 'Đang trong giai đoạn nuôi', icon: 'schedule', tone: 'blue' },
    { label: 'Đã hoàn tất', value: summary.value?.byStatus?.COMPLETED ?? 0, hint: 'Hồ sơ vụ đã hoàn thành', icon: 'task_alt', tone: 'amber' },
  ]
  return [
    { label: 'Tổng hồ sơ lô', value: summary.value?.total ?? 0, hint: 'Toàn hệ thống', icon: 'inventory_2', tone: 'teal' },
    { label: 'Đang nuôi', value: summary.value?.byStatus?.GROWING ?? 0, hint: 'Vụ đang sinh trưởng', icon: 'water', tone: 'blue' },
    { label: 'Chờ thu hoạch', value: summary.value?.byStatus?.READY_FOR_HARVEST ?? 0, hint: 'Cần theo dõi tiếp', icon: 'schedule', tone: 'amber' },
    { label: 'Đã thu hoạch', value: summary.value?.byStatus?.HARVESTED ?? 0, hint: 'Đã tạo lô thu hoạch', icon: 'task_alt', tone: 'green' },
  ]
})

const greeting = computed(() => {
  const hour = new Date().getHours()
  return hour < 11 ? 'Chào buổi sáng' : hour < 18 ? 'Chào buổi chiều' : 'Chào buổi tối'
})

function openRoleWorkspace() {
  if (role.value === 'TRANSPORTER') router.push({ name: 'transports' })
  else if (role.value === 'FARMER') router.push({ name: 'farms' })
  else document.getElementById('lot-directory')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

async function loadTransportOverview() {
  loadingTransportOverview.value = true
  transportOverviewError.value = ''
  try {
    transportOverview.value = await api.get<typeof transportOverview.value>('/transports')
  } catch (error) {
    transportOverviewError.value = error instanceof Error ? error.message : 'Không tải được dữ liệu vận chuyển.'
    transportOverview.value = { available: [], assigned: [] }
  } finally {
    loadingTransportOverview.value = false
  }
}

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
    if (role.value === 'TRANSPORTER') {
      await loadTransportOverview()
    } else {
      await loadBatches()
      if (role.value === 'FARMER') {
        try {
          const result = await api.get<{ count: number }>('/farms')
          farmCount.value = result.count
        } catch { farmCount.value = null }
      }
    }
  }
})
</script>

<template>
  <main class="home-page-promax">
    <!-- KHU VỰC CHƯA ĐĂNG NHẬP (LANDING PAGE) -->
    <template v-if="!isAuthenticated">
      <section class="hero-promax">
        <div class="hero-glow-1"></div>
        <div class="hero-glow-2"></div>
        <div class="hero-content-wrapper">
          <div class="badge-pill-promax">
            <span class="badge-dot"></span> NỀN TẢNG TRUY XUẤT THỦY SẢN
          </div>
          <h1 class="hero-title">
            Rõ nguồn gốc<br />
            <span class="text-gradient">Vững niềm tin</span>
          </h1>
          <p class="hero-desc">
            Theo dõi thông tin thủy sản từ vùng nuôi đến khâu vận chuyển. Mỗi hồ sơ giúp các bên nắm rõ nguồn gốc,
            lịch sử chăm sóc và quá trình bàn giao sản phẩm.
          </p>
          <div class="hero-actions">
            <va-button size="large" class="btn-promax-primary" @click="router.push({ name: 'login' })">
              Đăng nhập không gian làm việc
              <svg class="icon-right" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </va-button>
            <va-button size="large" preset="secondary" class="btn-promax-outline" @click="router.push({ name: 'register' })">
              Tạo tài khoản đối tác
            </va-button>
          </div>
        </div>
      </section>

      <section class="workflow-section">
        <div class="section-header">
          <h2 class="section-title">Theo dõi trọn vẹn <span class="text-highlight">hành trình sản phẩm</span></h2>
          <p class="section-subtitle">Các mốc quan trọng được ghi nhận theo từng công đoạn trong chuỗi cung ứng</p>
        </div>
        <div class="workflow-grid">
          <div class="step-card">
            <div class="step-icon-wrap">
              <div class="step-icon">1</div>
            </div>
            <h3>Ao nuôi</h3>
            <p>Lưu thông tin cơ sở, ao nuôi, giống và nhật ký chăm sóc theo từng vụ.</p>
          </div>
          <div class="step-connector">
            <div class="line-dashed"></div>
          </div>
          <div class="step-card">
            <div class="step-icon-wrap">
              <div class="step-icon">2</div>
            </div>
            <h3>Thu hoạch</h3>
            <p>Ghi ngày thu hoạch, khối lượng và tạo mã riêng cho từng lô.</p>
          </div>
          <div class="step-connector">
            <div class="line-dashed"></div>
          </div>
          <div class="step-card">
            <div class="step-icon-wrap">
              <div class="step-icon">3</div>
            </div>
            <h3>Vận chuyển</h3>
            <p>Ghi nhận điểm đi, điểm đến, phương tiện, nhiệt độ và trạng thái bàn giao.</p>
          </div>
          <div class="step-connector">
            <div class="line-dashed"></div>
          </div>
          <div class="step-card">
            <div class="step-icon-wrap">
              <div class="step-icon">4</div>
            </div>
            <h3>Phân phối</h3>
            <p>Đối chiếu thông tin nguồn gốc và các sự kiện đã được ghi nhận trên hệ thống.</p>
          </div>
        </div>
      </section>
    </template>

    <!-- KHU VỰC ĐÃ ĐĂNG NHẬP (DASHBOARD) -->
    <template v-else>
      <div class="dashboard-wrapper">
        <header class="workspace-hero" :class="`role-${role.toLowerCase()}`">
          <div class="workspace-copy">
            <div class="workspace-eyebrow"><span></span>{{ roleCopy.eyebrow }}</div>
            <p class="workspace-greeting">{{ greeting }}, {{ authStore.fullName }}</p>
            <h1>{{ roleCopy.title }}</h1>
            <p class="workspace-description">{{ roleCopy.description }}</p>
            <div class="workspace-meta">
              <span class="workspace-role"><va-icon :name="roleCopy.actionIcon" size="small" />{{ roleLabel }}</span>
              <span v-if="authStore.organizationName" class="workspace-org"><va-icon name="domain" size="small" />{{ authStore.organizationName }}</span>
            </div>
          </div>
          <div class="workspace-action">
            <div class="workspace-date">{{ new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: '2-digit', month: 'long' }).format(new Date()) }}</div>
            <va-button class="workspace-action-button" @click="openRoleWorkspace">
              <va-icon :name="roleCopy.actionIcon" size="small" />{{ roleCopy.action }}<va-icon name="arrow_forward" size="small" />
            </va-button>
          </div>
          <div class="workspace-decoration" aria-hidden="true"></div>
        </header>

        <section class="home-stats" aria-label="Chỉ số tổng quan">
          <article v-for="stat in homeStats" :key="stat.label" class="home-stat-card">
            <span class="home-stat-icon" :class="`tone-${stat.tone}`"><va-icon :name="stat.icon" /></span>
            <div><p>{{ stat.label }}</p><strong>{{ stat.value }}</strong><small>{{ stat.hint }}</small></div>
          </article>
        </section>

        <section v-if="role === 'TRANSPORTER'" class="transport-overview-card">
          <div class="overview-card-heading">
            <div><p class="overview-kicker">ĐIỀU PHỐI</p><h2>{{ roleCopy.tableTitle }}</h2><p>{{ roleCopy.tableDescription }}</p></div>
            <va-button preset="secondary" @click="router.push({ name: 'transports' })">Mở bảng điều phối<va-icon name="arrow_forward" size="small" class="ml-1" /></va-button>
          </div>
          <va-alert v-if="transportOverviewError" color="danger" class="mb-4">{{ transportOverviewError }}</va-alert>
          <va-inner-loading :loading="loadingTransportOverview">
            <div class="transport-preview-grid">
              <div class="transport-preview-column">
                <div class="preview-column-title"><span class="preview-indicator waiting"></span><strong>Đang chờ nhận</strong><span>{{ transportOverview.available.length }}</span></div>
                <article v-for="item in transportOverview.available.slice(0, 3)" :key="item.transport_code" class="transport-preview-row">
                  <span class="preview-code">{{ item.transport_code }}</span><span>{{ item.from_location }} → {{ item.to_location }}</span><small>{{ item.lot.lot_code }} · {{ formatNumber(item.quantity) }} kg</small>
                </article>
                <div v-if="!transportOverview.available.length" class="preview-empty">Chưa có yêu cầu mới.</div>
              </div>
              <div class="transport-preview-column">
                <div class="preview-column-title"><span class="preview-indicator moving"></span><strong>Chuyến của tôi</strong><span>{{ transportOverview.assigned.length }}</span></div>
                <article v-for="item in transportOverview.assigned.slice(0, 3)" :key="item.transport_code" class="transport-preview-row">
                  <span class="preview-code">{{ item.transport_code }} <em :class="`preview-status-${item.status.toLowerCase()}`">{{ item.status === 'DELIVERED' ? 'Đã giao' : item.status === 'IN_TRANSIT' ? 'Đang đi' : item.status === 'CANCELLED' ? 'Đã hủy' : 'Chờ chạy' }}</em></span><span>{{ item.from_location }} → {{ item.to_location }}</span><small>{{ item.lot.lot_code }} · {{ formatNumber(item.quantity) }} kg</small>
                </article>
                <div v-if="!transportOverview.assigned.length" class="preview-empty">Bạn chưa nhận chuyến nào.</div>
              </div>
            </div>
          </va-inner-loading>
        </section>

        <!-- Hồ sơ lô phù hợp theo quyền của vai trò -->
        <div v-else id="lot-directory" class="table-card-promax">
          <div class="table-header-promax">
            <div>
              <p class="table-kicker">{{ roleCopy.eyebrow }}</p>
              <h3 class="th-title">{{ roleCopy.tableTitle }}</h3>
              <p class="th-subtitle">{{ roleCopy.tableDescription }}</p>
            </div>
            <va-button preset="secondary" color="secondary" @click="loadBatches" :loading="loadingBatches"
              class="btn-refresh">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"
                class="mr-1">
                <path stroke-linecap="round" stroke-linejoin="round"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
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
              <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1">
                <path stroke-linecap="round" stroke-linejoin="round"
                  d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
            </div>
            <h4>Không có dữ liệu</h4>
            <p>{{ role === 'FARMER' ? 'Tạo cơ sở và vụ nuôi để bắt đầu xây dựng hồ sơ nguồn gốc.' : role === 'DISTRIBUTOR' ? 'Hiện chưa có hồ sơ lô nào được chia sẻ với tổ chức của bạn.' : 'Chưa có hồ sơ nào được ghi nhận trên hệ thống.' }}</p>
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
                    <va-badge :color="STATUS_COLORS[batch.status] ?? 'grey'"
                      :text="STATUS_LABELS[batch.status] ?? batch.status" class="badge-status-promax" />
                  </td>
                  <td class="text-right">
                    <button class="btn-action-promax" @click="openDetail(batch)">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
                        stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path stroke-linecap="round" stroke-linejoin="round"
                          d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
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

    <!-- MODAL CHI TIẾT & BLOCKCHAIN TIMELINE (Cấu trúc V4 - Trị dứt điểm vỡ layout) -->
    <va-modal v-model="detailVisible" hide-default-actions size="large" :padding="false">
      <!-- Container chính tự giới hạn chiều cao và tự cuộn -->
      <div class="custom-modal-container">
        
        <!-- Header Cố định (Sticky Header) -->
        <div class="custom-modal-header">
          <div class="mh-left">
            <div class="mh-icon">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <h2 class="mh-title">Hồ Sơ Lô Nuôi</h2>
              <p class="mh-subtitle">Mã truy xuất: <span class="text-primary font-mono">{{ selectedBatch?.batch_code }}</span></p>
            </div>
          </div>
          <button class="btn-close-modal" @click="detailVisible = false">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- Body cuộn được (Scrollable Body) -->
        <div class="custom-modal-body">
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
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round"
                      d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
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
        </div>
      </div>
    </va-modal>

    <footer class="footer-promax">
      <p>&copy; 2026 Nền tảng Truy xuất nguồn gốc Thủy sản Blockchain.</p>
    </footer>
  </main>
</template>

<style>
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
  position: absolute;
  width: 600px;
  height: 600px;
  background: radial-gradient(circle, rgba(14, 116, 144, 0.3) 0%, rgba(2, 6, 23, 0) 70%);
  top: -200px;
  left: -100px;
  border-radius: 50%;
  pointer-events: none;
}

.hero-glow-2 {
  position: absolute;
  width: 800px;
  height: 800px;
  background: radial-gradient(circle, rgba(20, 184, 166, 0.15) 0%, rgba(2, 6, 23, 0) 70%);
  bottom: -400px;
  right: -200px;
  border-radius: 50%;
  pointer-events: none;
}

.hero-content-wrapper {
  position: relative;
  z-index: 10;
  max-width: 860px;
  margin: 0 auto;
}

.badge-pill-promax {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #cbd5e1;
  padding: 6px 16px;
  border-radius: 100px;
  font-size: 0.875rem;
  font-weight: 500;
  margin-bottom: 2rem;
  backdrop-filter: blur(10px);
}

.badge-dot {
  width: 8px;
  height: 8px;
  background: #2dd4bf;
  border-radius: 50%;
  box-shadow: 0 0 10px #2dd4bf;
}

.hero-title {
  font-size: 4rem;
  font-weight: 800;
  color: #ffffff;
  line-height: 1.15;
  margin-bottom: 1.5rem;
  letter-spacing: -0.03em;
}

.text-gradient {
  background: linear-gradient(135deg, #2dd4bf, #3b82f6);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.hero-desc {
  font-size: 1.15rem;
  color: #94a3b8;
  line-height: 1.6;
  max-width: 680px;
  margin: 0 auto 3rem;
  font-weight: 400;
}

.hero-actions {
  display: flex;
  gap: 1rem;
  justify-content: center;
}

.btn-promax-primary {
  --va-button-color: #0e7490 !important;
  background: linear-gradient(135deg, #0e7490, #0891b2) !important;
  border-radius: 12px !important;
  font-weight: 600 !important;
  box-shadow: 0 8px 24px rgba(14, 116, 144, 0.3) !important;
  transition: all 0.3s ease !important;
}

.btn-promax-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 32px rgba(14, 116, 144, 0.4) !important;
}

.btn-promax-primary .icon-right {
  margin-left: 8px;
  transition: transform 0.3s ease;
}

.btn-promax-primary:hover .icon-right {
  transform: translateX(4px);
}

.btn-promax-outline {
  --va-button-color: transparent !important;
  border: 1px solid rgba(255, 255, 255, 0.2) !important;
  color: white !important;
  border-radius: 12px !important;
  font-weight: 600 !important;
}

.btn-promax-outline:hover {
  background: rgba(255, 255, 255, 0.05) !important;
}

/* Workflow */
.workflow-section {
  max-width: 1200px;
  margin: 0 auto 6rem;
  padding: 0 2rem;
}

.section-header {
  text-align: center;
  margin-bottom: 4rem;
}

.section-title {
  font-size: 2.25rem;
  font-weight: 800;
  color: #0f172a;
  letter-spacing: -0.02em;
  margin-bottom: 0.75rem;
}

.text-highlight {
  color: #0e7490;
}

.section-subtitle {
  color: #64748b;
  font-size: 1.1rem;
}

.workflow-grid {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.step-card {
  flex: 1;
  text-align: center;
  padding: 0 1rem;
}

.step-icon-wrap {
  width: 72px;
  height: 72px;
  margin: 0 auto 1.5rem;
  background: #f0fdfa;
  border-radius: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 10px 25px -5px rgba(20, 184, 166, 0.15);
}

.step-icon {
  font-size: 1.75rem;
  font-weight: 800;
  color: #0d9488;
}

.step-card h3 {
  font-size: 1.25rem;
  font-weight: 700;
  color: #0f172a;
  margin-bottom: 0.75rem;
}

.step-card p {
  font-size: 0.95rem;
  color: #64748b;
  line-height: 1.6;
}

.step-connector {
  flex: 0 0 80px;
  padding-top: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.line-dashed {
  width: 100%;
  border-top: 2px dashed #cbd5e1;
  position: relative;
}

.line-dashed::after {
  content: '';
  position: absolute;
  right: -4px;
  top: -5px;
  width: 8px;
  height: 8px;
  border-right: 2px solid #cbd5e1;
  border-top: 2px solid #cbd5e1;
  transform: rotate(45deg);
}

/* ==========================================================
   DASHBOARD (AUTHENTICATED)
   ========================================================== */
.dashboard-wrapper {
  max-width: 1240px;
  margin: 2rem auto;
  padding: 0 2rem;
  background: #f8fafc;
  min-height: 100vh;
}

.dash-header-promax {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: white;
  padding: 1.5rem 2rem;
  border-radius: 24px;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.02), 0 2px 4px -2px rgba(0, 0, 0, 0.02);
  border: 1px solid #f1f5f9;
  margin-bottom: 2rem;
}

.dash-greeting {
  display: flex;
  align-items: center;
  gap: 1.25rem;
}

.user-avatar-promax {
  width: 56px;
  height: 56px;
  border-radius: 18px;
  background: linear-gradient(135deg, #0f172a, #334155);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
  font-weight: 700;
  box-shadow: 0 8px 16px rgba(15, 23, 42, 0.15);
}

.greeting-text {
  font-size: 0.875rem;
  color: #64748b;
  margin: 0;
  font-weight: 500;
}

.user-name {
  font-size: 1.5rem;
  font-weight: 800;
  color: #0f172a;
  margin: 0.1rem 0 0.3rem;
  letter-spacing: -0.01em;
}

.user-badges {
  display: flex;
  gap: 0.75rem;
  align-items: center;
}

.role-badge-promax {
  background: #f1f5f9;
  color: #475569;
  padding: 3px 10px;
  border-radius: 8px;
  font-size: 0.75rem;
  font-weight: 600;
  border: 1px solid #e2e8f0;
}

.org-name-promax {
  display: flex;
  align-items: center;
  gap: 4px;
  color: #0e7490;
  font-size: 0.85rem;
  font-weight: 600;
}

.btn-create-batch {
  --va-button-color: #0f172a !important;
  border-radius: 12px !important;
  font-weight: 600 !important;
}

/* Stats Clean UI */
.stats-grid-promax {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1.5rem;
  margin-bottom: 2rem;
}

.stat-card-clean {
  background: white;
  padding: 1.5rem;
  border-radius: 20px;
  border: 1px solid #f1f5f9;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.02), 0 2px 4px -2px rgba(0, 0, 0, 0.02);
  display: flex;
  align-items: flex-start;
  gap: 1.25rem;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.stat-card-clean:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05);
}

.stat-icon-box {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.bg-slate {
  background: #f1f5f9;
  color: #475569;
}

.bg-blue {
  background: #eff6ff;
  color: #3b82f6;
}

.bg-teal {
  background: #f0fdfa;
  color: #14b8a6;
}

.bg-amber {
  background: #fffbeb;
  color: #d97706;
}

.stat-title {
  font-size: 0.875rem;
  color: #64748b;
  margin: 0 0 0.25rem;
  font-weight: 500;
}

.stat-number {
  font-size: 1.75rem;
  font-weight: 800;
  color: #0f172a;
  margin: 0;
  line-height: 1.2;
}

/* Table Promax */
.table-card-promax {
  background: white;
  border-radius: 24px;
  padding: 1.5rem;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.02);
  border: 1px solid #f1f5f9;
  overflow: hidden;
}

.table-header-promax {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  padding: 0 0.5rem;
}

.th-title {
  font-size: 1.25rem;
  font-weight: 800;
  color: #0f172a;
  margin: 0 0 0.25rem;
}

.th-subtitle {
  font-size: 0.9rem;
  color: #64748b;
  margin: 0;
}

.btn-refresh {
  border-radius: 10px !important;
  font-weight: 600 !important;
}

.table-responsive {
  width: 100%;
  overflow-x: auto;
  border: 1px solid #f1f5f9;
  border-radius: 16px;
}

.table-promax {
  width: 100%;
  border-collapse: collapse;
}

.table-promax th {
  text-align: left;
  padding: 1.2rem 1.25rem;
  font-size: 0.75rem;
  font-weight: 700;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid #e2e8f0;
  background: #f8fafc;
}

.table-promax td {
  padding: 1.25rem;
  border-bottom: 1px solid #f1f5f9;
  vertical-align: middle;
}

.table-promax tbody tr {
  transition: background 0.2s ease;
}

.table-promax tbody tr:hover {
  background: #f8fafc;
}

.badge-code {
  font-family: ui-monospace, SFMono-Regular, monospace;
  background: #f1f5f9;
  color: #334155;
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 0.85rem;
  font-weight: 500;
  border: 1px solid #e2e8f0;
}

.cell-title {
  font-weight: 600;
  color: #0f172a;
  font-size: 0.95rem;
}

.cell-sub {
  font-size: 0.85rem;
  color: #64748b;
  margin-top: 2px;
}

.badge-species {
  background: #f0fdfa;
  color: #0f766e;
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 0.85rem;
  font-weight: 600;
}

.cell-text {
  color: #334155;
  font-size: 0.95rem;
}

.badge-status-promax {
  border-radius: 8px !important;
  font-weight: 600 !important;
  padding: 4px 8px !important;
}

.btn-action-promax {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: white;
  border: 1px solid #e2e8f0;
  color: #0f172a;
  padding: 8px 14px;
  border-radius: 10px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.btn-action-promax:hover {
  background: #f8fafc;
  border-color: #cbd5e1;
}

.empty-state-promax {
  text-align: center;
  padding: 4rem 2rem;
}

.empty-icon {
  color: #cbd5e1;
  margin-bottom: 1rem;
  display: flex;
  justify-content: center;
}

.empty-state-promax h4 {
  font-size: 1.25rem;
  font-weight: 700;
  color: #0f172a;
  margin-bottom: 0.5rem;
}

.empty-state-promax p {
  color: #64748b;
}

/* ==========================================================
   MODAL & BLOCKCHAIN TIMELINE FIX (V4 - TRỊ DỨT ĐIỂM)
   ========================================================== */

/* 1. Container phủ kín toàn bộ Modal. Đặt giới hạn chiều cao tại đây */
.custom-modal-container {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 1100px;
  max-height: calc(100vh - 80px); /* Cách lề trên 40px, lề dưới 40px */
  background: #fff;
  border-radius: 20px;
  overflow: hidden; /* Cắt bỏ các phần tử con tràn ra ngoài góc bo tròn */
}

/* 2. Header: Cố định hoàn toàn trên đỉnh */
.custom-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 1.5rem 2rem;
  border-bottom: 1px solid #e2e8f0;
  background: #f8fafc;
  flex-shrink: 0; /* Không bao giờ bị co lại khi nội dung dài */
  z-index: 10;
}

.mh-left { display: flex; gap: 1rem; align-items: center; }
.mh-icon { width: 48px; height: 48px; background: white; border: 1px solid #e2e8f0; border-radius: 14px; display: flex; align-items: center; justify-content: center; color: #0e7490; }
.mh-title { font-size: 1.25rem; font-weight: 800; color: #0f172a; margin: 0 0 0.25rem; }
.mh-subtitle { font-size: 0.9rem; color: #64748b; margin: 0; }
.btn-close-modal { background: none; border: none; color: #94a3b8; cursor: pointer; padding: 4px; border-radius: 8px; transition: background 0.2s; }
.btn-close-modal:hover { background: #e2e8f0; color: #0f172a; }

/* 3. Body: Tự động lấp đầy phần trống và tự tạo thanh cuộn */
.custom-modal-body {
  flex: 1 1 auto; /* Chiếm hết chiều cao còn lại sau khi trừ đi Header */
  overflow-y: auto; /* Sinh ra thanh cuộn bên trong nếu nội dung quá dài */
  padding: 2rem;
  background: #fff;
  scrollbar-width: thin;
  scrollbar-color: #cbd5e1 transparent;
}

.custom-modal-body::-webkit-scrollbar { width: 6px; }
.custom-modal-body::-webkit-scrollbar-thumb { background-color: #cbd5e1; border-radius: 10px; }

.detail-grid-promax {
  display: grid;
  grid-template-columns: 1fr 1.4fr;
  gap: 2rem;
}

.card-info-promax {
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  padding: 1.5rem;
  background: white;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
}

.card-title-promax {
  font-size: 1.05rem;
  font-weight: 700;
  color: #0f172a;
  margin: 0 0 1.25rem;
}

.info-list-promax {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px dashed #e2e8f0;
  padding-bottom: 0.75rem;
}

.info-row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.ir-label {
  color: #64748b;
  font-size: 0.9rem;
}

.ir-val {
  color: #0f172a;
  font-size: 0.95rem;
  font-weight: 500;
  text-align: right;
}

.stats-mini-promax {
  display: flex;
  gap: 0.75rem;
}

.sm-box {
  flex: 1;
  background: #f8fafc;
  border: 1px solid #f1f5f9;
  padding: 1rem;
  border-radius: 12px;
  text-align: center;
}

.sm-num {
  display: block;
  font-size: 1.5rem;
  font-weight: 800;
  margin-bottom: 0.25rem;
}

.text-slate {
  color: #334155;
}

.text-teal {
  color: #0f766e;
}

.text-blue {
  color: #1d4ed8;
}

.sm-label {
  font-size: 0.8rem;
  color: #64748b;
  font-weight: 500;
}

/* Timeline Terminal Style Pro */
.col-blockchain {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  padding: 1.5rem;
}

.cb-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
}

.secure-badge-promax {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #ecfdf5;
  color: #059669;
  padding: 6px 12px;
  border-radius: 100px;
  font-size: 0.85rem;
  font-weight: 600;
  border: 1px solid #a7f3d0;
}

.timeline-wrapper-promax {
  position: relative;
}

.timeline-item-promax {
  position: relative;
  padding-left: 2.5rem;
  padding-bottom: 2rem;
}

.timeline-item-promax:last-child {
  padding-bottom: 0;
}

.tl-line {
  position: absolute;
  left: 13px;
  top: 32px;
  bottom: 0;
  width: 2px;
  background: #e2e8f0;
  z-index: 1;
}

.tl-marker {
  position: absolute;
  left: 0;
  top: 0;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
  background: white;
  box-shadow: 0 0 0 4px white;
  border: 2px solid #e2e8f0;
}

.marker-success {
  background: #10b981;
  color: white;
  border-color: #10b981;
}

.marker-pending {
  background: #f59e0b;
  color: white;
  border-color: #f59e0b;
}

.marker-failed {
  background: #ef4444;
  color: white;
  border-color: #ef4444;
}

.tl-content-card {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.02);
  transition: transform 0.2s;
}

.tl-content-card:hover {
  transform: translateX(2px);
  border-color: #cbd5e1;
}

.tl-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.8rem 1.2rem;
  border-bottom: 1px solid #e2e8f0;
  background: white;
}

.tl-card-header h5 {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
  color: #0f172a;
}

.tl-card-header .time {
  font-size: 0.8rem;
  color: #64748b;
  font-weight: 500;
}

/* Terminal Effect Sạch Hơn */
.terminal-style {
  background: #0f172a;
  padding: 1.2rem;
  color: #a5b4fc;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 0.85rem;
  line-height: 1.5;
}

.hash-line {
  margin-bottom: 8px;
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.h-label {
  color: #64748b;
  font-weight: 600;
  flex-shrink: 0;
  user-select: none;
}

.h-value {
  color: #2dd4bf;
  word-break: break-all;
  cursor: text;
}

.hash-status {
  display: flex;
  align-items: center;
  gap: 8px;
  border-top: 1px dashed #334155;
  padding-top: 12px;
  margin-top: 8px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  box-shadow: 0 0 8px currentColor;
}

.status-text {
  color: #f8fafc;
  font-weight: 600;
  font-family: 'Inter', sans-serif;
}

.block-badge {
  margin-left: auto;
  background: rgba(255, 255, 255, 0.1);
  color: #cbd5e1;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 0.75rem;
  font-family: 'Inter', sans-serif;
  font-weight: 600;
}

.footer-promax {
  text-align: center;
  padding: 2rem;
  color: #94a3b8;
  font-size: 0.9rem;
  margin-top: auto;
}

/* Responsive */
@media (max-width: 1024px) {
  .workflow-grid {
    flex-direction: column;
    gap: 1.5rem;
  }

  .step-connector {
    transform: rotate(90deg);
    padding-top: 0;
    flex: 0 0 40px;
  }

  .stats-grid-promax {
    grid-template-columns: repeat(2, 1fr);
  }

  .detail-grid-promax {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .hero-promax {
    padding: 5rem 1.5rem 6rem;
  }

  .hero-title {
    font-size: 2.5rem;
  }

  .dash-header-promax {
    flex-direction: column;
    align-items: stretch;
    gap: 1.5rem;
  }

  .btn-create-batch {
    width: 100%;
    justify-content: center;
  }

  .table-header-promax {
    flex-direction: column;
    align-items: flex-start;
    gap: 1rem;
  }

  .custom-modal-body {
    padding: 1rem;
  }
}

/* Unified role dashboard */
.dashboard-wrapper {
  width: min(1320px, calc(100% - 2.5rem));
  max-width: 1320px;
  margin: 1.7rem auto 3rem;
  padding: 0;
  background: transparent;
  min-height: calc(100vh - 110px);
}

.workspace-hero {
  min-height: 228px;
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 2rem;
  padding: 2rem 2.25rem;
  border: 1px solid #d3e8e1;
  border-radius: 22px;
  color: #f4fffa;
  background: linear-gradient(116deg, #123f42 0%, #116f67 60%, #248976 100%);
  box-shadow: 0 16px 38px rgb(15 86 72 / 10%);
}

.workspace-hero::after {
  position: absolute;
  top: -255px;
  right: 12%;
  width: 410px;
  height: 410px;
  border: 1px solid rgb(255 255 255 / 14%);
  border-radius: 50%;
  box-shadow: 0 0 0 36px rgb(255 255 255 / 5%), 0 0 0 76px rgb(255 255 255 / 4%);
  content: '';
  pointer-events: none;
}

.workspace-copy,
.workspace-action { position: relative; z-index: 1; }
.workspace-copy { max-width: 770px; }
.workspace-eyebrow { display: flex; align-items: center; gap: .55rem; color: #b9e4d7; font-size: .67rem; font-weight: 800; letter-spacing: .12em; }
.workspace-eyebrow span { width: 8px; height: 8px; border-radius: 50%; background: #7de1b2; box-shadow: 0 0 0 4px rgb(125 225 178 / 15%); }
.workspace-greeting { margin: .85rem 0 .2rem; color: #c5e3db; font-size: .84rem; font-weight: 600; }
.workspace-copy h1 { margin: .15rem 0 .45rem; color: #fff; font-size: clamp(1.75rem, 3vw, 2.45rem); font-weight: 750; line-height: 1.18; letter-spacing: -.045em; }
.workspace-description { max-width: 660px; margin: 0; color: #d2e8e1; font-size: .9rem; line-height: 1.65; }
.workspace-meta { display: flex; flex-wrap: wrap; gap: .55rem; margin-top: 1.05rem; }
.workspace-role,.workspace-org { display: inline-flex; align-items: center; gap: .38rem; padding: .35rem .65rem; border: 1px solid rgb(255 255 255 / 18%); border-radius: 99px; color: #edf9f4; background: rgb(255 255 255 / 8%); font-size: .69rem; font-weight: 650; }
.workspace-action { display: grid; justify-items: end; gap: .65rem; min-width: 190px; }
.workspace-date { color: #c8e5dc; font-size: .75rem; text-transform: capitalize; }
.workspace-action-button { display: inline-flex; gap: .45rem; min-height: 42px; padding: 0 .9rem; border: 1px solid rgb(255 255 255 / 27%); border-radius: 10px; color: #fff; background: rgb(255 255 255 / 12%); font-weight: 650; }
.workspace-action-button:hover { background: rgb(255 255 255 / 20%); }
.workspace-action-button .va-button__content { gap: .45rem; }
.role-transporter { background: linear-gradient(116deg, #193b53 0%, #215d78 56%, #328a90 100%); border-color: #d4e5e9; }
.role-distributor { background: linear-gradient(116deg, #263f5b 0%, #365d80 56%, #468898 100%); border-color: #d8e5eb; }
.role-admin { background: linear-gradient(116deg, #26384f 0%, #315c6d 56%, #318278 100%); border-color: #d7e5e4; }

.home-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1rem; margin: 1.15rem 0 1.4rem; }
.home-stat-card { display: flex; align-items: flex-start; gap: .85rem; min-width: 0; padding: 1.1rem 1.15rem; border: 1px solid #e4edeb; border-radius: 15px; background: #fff; box-shadow: 0 5px 17px rgb(24 56 53 / 4%); transition: transform .18s, box-shadow .18s; }
.home-stat-card:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgb(24 56 53 / 8%); }
.home-stat-card > div { min-width: 0; }
.home-stat-icon { display: grid; place-items: center; flex: none; width: 42px; height: 42px; border-radius: 12px; color: #14796d; background: #eaf5f1; }
.home-stat-icon .va-icon { font-size: 1.25rem; }
.tone-blue { color: #4774ba; background: #eef3fc; }.tone-green { color: #23845e; background: #eaf6ef; }.tone-amber { color: #ad7d25; background: #fff6e2; }
.home-stat-card p { overflow: hidden; margin: .05rem 0 .15rem; color: #73888a; font-size: .72rem; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.home-stat-card strong { display: block; color: #1c3d42; font-size: 1.65rem; font-weight: 750; line-height: 1.3; letter-spacing: -.04em; }
.home-stat-card small { display: block; overflow: hidden; margin-top: .12rem; color: #98a7a7; font-size: .65rem; text-overflow: ellipsis; white-space: nowrap; }

.table-card-promax,.transport-overview-card { padding: 1.45rem; border: 1px solid #e2ecea; border-radius: 18px; background: #fff; box-shadow: 0 8px 26px rgb(26 63 57 / 5%); scroll-margin-top: 100px; }
.table-header-promax { align-items: center; margin-bottom: 1rem; padding: 0; }
.table-kicker,.overview-kicker { margin: 0 0 .28rem; color: #0c8174; font-size: .65rem; font-weight: 800; letter-spacing: .11em; }
.th-title,.overview-card-heading h2 { margin: 0; color: #1c3d42; font-size: 1.22rem; font-weight: 750; letter-spacing: -.035em; }
.th-subtitle,.overview-card-heading p:not(.overview-kicker) { margin: .3rem 0 0; color: #788d8e; font-size: .78rem; }
.table-promax th { padding: .85rem .95rem; border-bottom-color: #e7efed; color: #809293; background: #f7faf9; font-size: .65rem; letter-spacing: .08em; }
.table-promax td { padding: .9rem .95rem; border-bottom-color: #edf2f1; }
.table-promax tbody tr:hover { background: #f8fbfa; }
.badge-code { color: #245d56; background: #edf6f2; border-color: #e2eee8; font-weight: 700; }
.btn-action-promax { border-color: #dce9e5; border-radius: 8px; color: #0e766b; box-shadow: none; }
.empty-state-promax { padding: 3.5rem 1rem; }
.empty-state-promax h4 { color: #24464a; }
.empty-state-promax p { color: #7b8f91; }

.transport-overview-card { margin-bottom: 1rem; }
.overview-card-heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding-bottom: 1rem; border-bottom: 1px solid #edf2f1; }
.overview-card-heading .va-button { border-radius: 9px; }
.ml-1 { margin-left: .25rem; }
.transport-preview-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; padding-top: 1.1rem; }
.transport-preview-column { min-width: 0; }
.preview-column-title { display: flex; align-items: center; gap: .5rem; margin-bottom: .6rem; color: #38595d; font-size: .76rem; }
.preview-column-title > span:last-child { margin-left: auto; display: grid; place-items: center; min-width: 24px; height: 22px; padding: 0 .35rem; border-radius: 99px; color: #34746c; background: #eaf5f1; font-size: .68rem; }
.preview-indicator { width: 7px; height: 7px; border-radius: 50%; background: #d2a545; }.preview-indicator.moving { background: #4b89c4; }
.transport-preview-row { display: grid; grid-template-columns: 1fr auto; gap: .25rem .5rem; padding: .72rem .8rem; border: 1px solid #edf2f1; border-radius: 10px; margin-top: .48rem; background: #fbfdfc; }
.preview-code { color: #275c55; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .7rem; font-weight: 750; }.transport-preview-row > span:nth-child(2) { grid-column: 1 / -1; overflow: hidden; color: #577174; font-size: .73rem; text-overflow: ellipsis; white-space: nowrap; }.transport-preview-row small { color: #8b9b9b; font-size: .66rem; }
.preview-code em { margin-left: .3rem; padding: .15rem .38rem; border-radius: 99px; color: #3871aa; background: #eef4fc; font-family: inherit; font-size: .6rem; font-style: normal; font-weight: 650; }.preview-status-delivered { color: #26835c !important; background: #eaf6ef !important; }.preview-status-cancelled { color: #a24c4c !important; background: #fff0ef !important; }.preview-status-planning { color: #9a772c !important; background: #fff6e2 !important; }
.preview-empty { padding: 1.35rem .8rem; border: 1px dashed #dce9e5; border-radius: 10px; color: #8b9b9b; font-size: .73rem; text-align: center; }
.footer-promax { color: #98a8a7; font-size: .72rem; }

.hero-promax { margin: 1rem auto 3rem; max-width: 1440px; border-radius: 0 0 28px 28px; background: linear-gradient(120deg,#123d42,#0e7168 65%,#188374); }
.hero-title { font-size: clamp(2.5rem,5vw,4rem); letter-spacing: -.045em; }
.badge-pill-promax { border-radius: 99px; }
.workflow-section { margin-bottom: 4rem; }
.step-icon-wrap { border-radius: 18px; }

@media (max-width: 900px) {
  .dashboard-wrapper { width: min(100% - 2rem, 760px); }
  .workspace-hero { align-items: flex-start; flex-direction: column; gap: 1.2rem; }
  .workspace-action { display: flex; align-items: center; justify-items: initial; min-width: 0; }
  .home-stats { grid-template-columns: repeat(2,minmax(0,1fr)); }
  .transport-preview-grid { grid-template-columns: 1fr; }
}

@media (max-width: 600px) {
  .dashboard-wrapper { width: calc(100% - 1rem); margin: .85rem auto 2rem; }
  .workspace-hero { min-height: unset; padding: 1.25rem; border-radius: 17px; }
  .workspace-copy h1 { font-size: 1.65rem; }
  .workspace-description { font-size: .8rem; }
  .workspace-action { flex-wrap: wrap; gap: .5rem; }
  .workspace-date { width: 100%; }
  .workspace-action-button { min-height: 38px; }
  .home-stats { gap: .55rem; margin: .7rem 0 1rem; }
  .home-stat-card { gap: .55rem; padding: .75rem; border-radius: 12px; }
  .home-stat-icon { width: 34px; height: 34px; border-radius: 10px; }
  .home-stat-card p { font-size: .65rem; }.home-stat-card strong { font-size: 1.35rem; }.home-stat-card small { font-size: .59rem; }
  .table-card-promax,.transport-overview-card { padding: .9rem; border-radius: 14px; }
  .table-header-promax { align-items: flex-start; }
  .transport-preview-grid { gap: .7rem; }
}
</style>
