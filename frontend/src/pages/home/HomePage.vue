<script setup lang="ts">
import EmptyState from '../../components/EmptyState.vue'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { VaBadge, VaButton, VaModal, VaInnerLoading, VaAlert, VaIcon } from 'vuestic-ui'
import { useRouter } from 'vue-router'

import { useAuthStore } from '../../stores/auth.store'
import { useBatchesStore } from '../../stores/batches.store'
import CollectionToolbar from '../../components/CollectionToolbar.vue'
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
  page,
  pageSize,
  search,
  status,
  count,
  detailError,
  batchesError,
  detail,
  detailLoading,
  detailVisible,
  loadingBatches,
  selectedBatch,
  summary,
} = storeToRefs(batchesStore)
const { loadBatches, openDetail, closeDetail, setPage, applyFilters } = batchesStore
const farmCount = ref<number | null>(null)
const transportOverview = ref<{
  available: Array<{
    transport_code: string
    from_location: string
    to_location: string
    quantity: number
    lot: { lot_code: string }
  }>
  assigned: Array<{
    transport_code: string
    status: string
    from_location: string
    to_location: string
    quantity: number
    lot: { lot_code: string }
  }>
}>({ available: [], assigned: [] })
const loadingTransportOverview = ref(false)
const transportOverviewError = ref('')

const isAuthenticated = computed(() => authStore.isAuthenticated)
const roleLabel = computed(() => {
  const role = authStore.user?.role as Role | undefined
  return role ? (ROLE_LABELS[role] ?? role) : ''
})

const role = computed(() => authStore.user?.role ?? 'FARMER')
const roleCopy = computed(
  () =>
    ({
      FARMER: {
        title: 'Tổng quan vùng nuôi',
        description:
          'Từ cơ sở, ao nuôi đến thu hoạch và vận chuyển — mọi thông tin quan trọng được tập trung tại đây.',
        action: 'Mở cơ sở nuôi',
        actionIcon: 'domain',
        tableTitle: 'Vụ nuôi gần đây',
        tableDescription: 'Theo dõi trạng thái và hồ sơ nguồn gốc của các vụ nuôi.',
      },
      TRANSPORTER: {
        title: 'Tổng quan vận chuyển',
        description:
          'Nhận yêu cầu vận chuyển, cập nhật thông tin phương tiện và theo dõi lô hàng đến điểm giao.',
        action: 'Mở điều phối',
        actionIcon: 'local_shipping',
        tableTitle: 'Tổng quan vận chuyển',
        tableDescription: 'Các yêu cầu chờ nhận và chuyến đang thực hiện.',
      },
      DISTRIBUTOR: {
        title: 'Tổng quan phân phối',
        description: 'Xác nhận hàng đến và tra cứu hồ sơ nguồn gốc của các lô được chia sẻ.',
        action: 'Mở hàng nhận',
        actionIcon: 'inventory_2',
        tableTitle: 'Vụ nuôi có thể tra cứu',
        tableDescription: 'Thông tin truy xuất hiện có trong phạm vi tổ chức.',
      },
      ADMIN: {
        title: 'Tổng quan hoạt động hệ thống',
        description:
          'Theo dõi vụ nuôi, trạng thái sản xuất và hoạt động truy xuất trên toàn nền tảng.',
        action: 'Xem vụ nuôi',
        actionIcon: 'admin_panel_settings',
        tableTitle: 'Vụ nuôi mới nhất',
        tableDescription: 'Tình hình các vụ nuôi được ghi nhận trên nền tảng.',
      },
    })[role.value],
)

const homeStats = computed(() => {
  if (role.value === 'TRANSPORTER')
    return [
      {
        label: 'Yêu cầu mới',
        value: transportOverview.value.available.length,
        hint: 'Đang chờ người nhận',
        icon: 'inbox',
        tone: 'amber',
      },
      {
        label: 'Đang vận chuyển',
        value: transportOverview.value.assigned.filter((item) => item.status === 'IN_TRANSIT')
          .length,
        hint: 'Chuyến đang thực hiện',
        icon: 'local_shipping',
        tone: 'blue',
      },
      {
        label: 'Chờ khởi hành',
        value: transportOverview.value.assigned.filter((item) => item.status === 'PLANNING').length,
        hint: 'Chuyến bạn đã nhận',
        icon: 'schedule',
        tone: 'teal',
      },
      {
        label: 'Đã bàn giao',
        value: transportOverview.value.assigned.filter((item) => item.status === 'DELIVERED')
          .length,
        hint: 'Chuyến hoàn tất',
        icon: 'task_alt',
        tone: 'green',
      },
    ]
  if (role.value === 'FARMER')
    return [
      {
        label: 'Cơ sở nuôi',
        value: farmCount.value ?? '—',
        hint: 'Đang quản lý',
        icon: 'domain',
        tone: 'teal',
      },
      {
        label: 'Tổng vụ nuôi',
        value: summary.value?.total ?? 0,
        hint: search.value || status.value ? 'Theo bộ lọc hiện tại' : 'Hồ sơ đã ghi nhận',
        icon: 'inventory_2',
        tone: 'blue',
      },
      {
        label: 'Đang nuôi',
        value: summary.value?.byStatus?.GROWING ?? 0,
        hint: 'Vụ đang sinh trưởng',
        icon: 'water',
        tone: 'green',
      },
      {
        label: 'Chờ thu hoạch',
        value: summary.value?.byStatus?.READY_FOR_HARVEST ?? 0,
        hint: 'Có thể ghi nhận thu hoạch',
        icon: 'agriculture',
        tone: 'amber',
      },
    ]
  if (role.value === 'DISTRIBUTOR')
    return [
      {
        label: 'Vụ nuôi có thể tra cứu',
        value: summary.value?.total ?? 0,
        hint: 'Trong phạm vi tổ chức',
        icon: 'qr_code_2',
        tone: 'teal',
      },
      {
        label: 'Đã thu hoạch',
        value: summary.value?.byStatus?.HARVESTED ?? 0,
        hint: 'Có nguồn gốc lô hàng',
        icon: 'inventory_2',
        tone: 'green',
      },
      {
        label: 'Đang hoàn thiện',
        value: summary.value?.byStatus?.GROWING ?? 0,
        hint: 'Đang trong giai đoạn nuôi',
        icon: 'schedule',
        tone: 'blue',
      },
      {
        label: 'Đã hoàn tất',
        value: summary.value?.byStatus?.COMPLETED ?? 0,
        hint: 'Hồ sơ vụ đã hoàn thành',
        icon: 'task_alt',
        tone: 'amber',
      },
    ]
  return [
    {
      label: 'Tổng vụ nuôi',
      value: summary.value?.total ?? 0,
      hint: search.value || status.value ? 'Theo bộ lọc hiện tại' : 'Toàn hệ thống',
      icon: 'inventory_2',
      tone: 'teal',
    },
    {
      label: 'Đang nuôi',
      value: summary.value?.byStatus?.GROWING ?? 0,
      hint: 'Vụ đang sinh trưởng',
      icon: 'water',
      tone: 'blue',
    },
    {
      label: 'Chờ thu hoạch',
      value: summary.value?.byStatus?.READY_FOR_HARVEST ?? 0,
      hint: 'Cần theo dõi tiếp',
      icon: 'schedule',
      tone: 'amber',
    },
    {
      label: 'Đã thu hoạch',
      value: summary.value?.byStatus?.HARVESTED ?? 0,
      hint: 'Đã tạo lô thu hoạch',
      icon: 'task_alt',
      tone: 'green',
    },
  ]
})

const greeting = computed(() => {
  const hour = new Date().getHours()
  return hour < 11 ? 'Chào buổi sáng' : hour < 18 ? 'Chào buổi chiều' : 'Chào buổi tối'
})

const workRoute = computed(
  () =>
    ({
      FARMER: 'farms',
      TRANSPORTER: 'transports',
      DISTRIBUTOR: 'receipts',
      ADMIN: null,
    })[role.value],
)
const batchQuery = ref(search.value)
let searchTimer: ReturnType<typeof setTimeout> | undefined

function filterBatches(newStatus: string) {
  clearTimeout(searchTimer)
  return applyFilters(batchQuery.value, newStatus)
}

function searchBatches(value: string) {
  batchQuery.value = value
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    if (batchQuery.value.trim() !== search.value) void filterBatches(status.value)
  }, 250)
}

function refreshBatches() {
  return batchQuery.value.trim() === search.value ? loadBatches() : filterBatches(status.value)
}

function changePage(nextPage: number) {
  return batchQuery.value.trim() === search.value ? setPage(nextPage) : filterBatches(status.value)
}

onUnmounted(() => clearTimeout(searchTimer))

async function loadTransportOverview() {
  loadingTransportOverview.value = true
  transportOverviewError.value = ''
  try {
    transportOverview.value = await api.get<typeof transportOverview.value>('/transports')
  } catch (error) {
    transportOverviewError.value =
      error instanceof Error ? error.message : 'Không tải được dữ liệu vận chuyển.'
    transportOverview.value = { available: [], assigned: [] }
  } finally {
    loadingTransportOverview.value = false
  }
}

const EVENT_LABELS: Record<string, string> = {
  BATCH_CREATED: 'Khởi tạo vụ nuôi',
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
    FARMING_LOG_RECORDED:
      'M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125',
    HARVEST_RECORDED: 'M8 16.5V19m8-2.5V19M3 14h18m-9-3.5v-7',
    TRANSPORT_RECORDED:
      'M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12',
    DISTRIBUTION_RECORDED:
      'M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V15a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .415.336.75.75.75z',
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
        } catch {
          farmCount.value = null
        }
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
        <div class="hero-content-wrapper">
          <h1 class="hero-title">Theo dõi nguồn gốc thủy sản</h1>
          <p class="hero-desc">
            Theo dõi thông tin thủy sản từ vùng nuôi đến khâu vận chuyển. Mỗi hồ sơ giúp các bên nắm
            rõ nguồn gốc, lịch sử chăm sóc và quá trình bàn giao sản phẩm.
          </p>
          <div class="hero-actions">
            <router-link class="hero-link hero-link-primary" :to="{ name: 'login' }">
              Đăng nhập <va-icon name="arrow_forward" aria-hidden="true" />
            </router-link>
            <router-link class="hero-link" :to="{ name: 'register' }">
              Tạo tài khoản đối tác
            </router-link>
          </div>
        </div>
        <div class="hero-image" aria-hidden="true"></div>
      </section>

      <section class="workflow-section">
        <div class="section-header">
          <h2 class="section-title">Các công đoạn được ghi nhận</h2>
        </div>
        <div class="workflow-grid">
          <div class="step-card">
            <div class="step-icon-wrap">
              <div class="step-icon"><va-icon name="water" aria-hidden="true" /></div>
            </div>
            <h3>Ao nuôi</h3>
            <p>Lưu thông tin cơ sở, ao nuôi, giống và nhật ký chăm sóc theo từng vụ.</p>
          </div>
          <div class="step-connector">
            <div class="line-dashed"></div>
          </div>
          <div class="step-card">
            <div class="step-icon-wrap">
              <div class="step-icon"><va-icon name="inventory_2" aria-hidden="true" /></div>
            </div>
            <h3>Thu hoạch</h3>
            <p>Ghi ngày thu hoạch, khối lượng và tạo mã riêng cho từng lô.</p>
          </div>
          <div class="step-connector">
            <div class="line-dashed"></div>
          </div>
          <div class="step-card">
            <div class="step-icon-wrap">
              <div class="step-icon"><va-icon name="local_shipping" aria-hidden="true" /></div>
            </div>
            <h3>Vận chuyển</h3>
            <p>Ghi nhận điểm đi, điểm đến, phương tiện, nhiệt độ và trạng thái bàn giao.</p>
          </div>
          <div class="step-connector">
            <div class="line-dashed"></div>
          </div>
          <div class="step-card">
            <div class="step-icon-wrap">
              <div class="step-icon"><va-icon name="fact_check" aria-hidden="true" /></div>
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
            <p class="workspace-greeting">{{ greeting }}, {{ authStore.fullName }}</p>
            <h1>{{ roleCopy.title }}</h1>
            <p class="workspace-description">{{ roleCopy.description }}</p>
            <div class="workspace-meta">
              <span class="workspace-role"
                ><va-icon :name="roleCopy.actionIcon" size="small" />{{ roleLabel }}</span
              >
              <span v-if="authStore.organizationName" class="workspace-org"
                ><va-icon name="domain" size="small" aria-hidden="true" />{{
                  authStore.organizationName
                }}</span
              >
            </div>
          </div>
          <div class="workspace-action">
            <div class="workspace-date">
              {{
                new Intl.DateTimeFormat('vi-VN', {
                  weekday: 'long',
                  day: '2-digit',
                  month: 'long',
                }).format(new Date())
              }}
            </div>
            <RouterLink v-if="workRoute" class="workspace-action-button" :to="{ name: workRoute }">
              <va-icon :name="roleCopy.actionIcon" size="small" aria-hidden="true" />{{
                roleCopy.action
              }}
              <va-icon name="arrow_forward" size="small" aria-hidden="true" />
            </RouterLink>
            <a v-else class="workspace-action-button" href="#lot-directory">{{
              roleCopy.action
            }}</a>
            <a v-if="role === 'DISTRIBUTOR'" class="workspace-secondary-link" href="#lot-directory"
              >Tra cứu vụ nuôi</a
            >
          </div>
        </header>

        <section
          class="home-stats"
          aria-label="Chỉ số tổng quan"
          :aria-busy="role === 'TRANSPORTER' ? loadingTransportOverview : loadingBatches"
        >
          <article v-for="stat in homeStats" :key="stat.label" class="home-stat-card">
            <span class="home-stat-icon" :class="`tone-${stat.tone}`"
              ><va-icon :name="stat.icon"
            /></span>
            <div>
              <p>{{ stat.label }}</p>
              <strong>{{
                (
                  role === 'TRANSPORTER'
                    ? loadingTransportOverview || transportOverviewError
                    : loadingBatches || batchesError
                )
                  ? '—'
                  : stat.value
              }}</strong
              ><small>{{ stat.hint }}</small>
            </div>
          </article>
        </section>

        <section v-if="role === 'TRANSPORTER'" class="transport-overview-card">
          <div class="overview-card-heading">
            <div>
              <h2>{{ roleCopy.tableTitle }}</h2>
              <p>{{ roleCopy.tableDescription }}</p>
            </div>
            <va-button preset="secondary" @click="router.push({ name: 'transports' })"
              >Mở bảng điều phối<va-icon name="arrow_forward" size="small" class="ml-1"
            /></va-button>
          </div>
          <va-alert v-if="transportOverviewError" color="danger" class="mb-4" role="alert">{{
            transportOverviewError
          }}</va-alert>
          <va-inner-loading :loading="loadingTransportOverview">
            <div class="transport-preview-grid">
              <div class="transport-preview-column">
                <div class="preview-column-title">
                  <span class="preview-indicator waiting"></span><strong>Đang chờ nhận</strong
                  ><span>{{ transportOverview.available.length }}</span>
                </div>
                <article
                  v-for="item in transportOverview.available.slice(0, 3)"
                  :key="item.transport_code"
                  class="transport-preview-row"
                >
                  <span class="preview-code">{{ item.transport_code }}</span
                  ><span>{{ item.from_location }} → {{ item.to_location }}</span
                  ><small>{{ item.lot.lot_code }} · {{ formatNumber(item.quantity) }} kg</small>
                </article>
                <div
                  v-if="
                    !loadingTransportOverview &&
                    !transportOverviewError &&
                    !transportOverview.available.length
                  "
                  class="preview-empty"
                >
                  Chưa có yêu cầu mới.
                </div>
              </div>
              <div class="transport-preview-column">
                <div class="preview-column-title">
                  <span class="preview-indicator moving"></span><strong>Chuyến của tôi</strong
                  ><span>{{ transportOverview.assigned.length }}</span>
                </div>
                <article
                  v-for="item in transportOverview.assigned.slice(0, 3)"
                  :key="item.transport_code"
                  class="transport-preview-row"
                >
                  <span class="preview-code"
                    >{{ item.transport_code }}
                    <em :class="`preview-status-${item.status.toLowerCase()}`">{{
                      item.status === 'DELIVERED'
                        ? 'Đã giao'
                        : item.status === 'IN_TRANSIT'
                          ? 'Đang đi'
                          : item.status === 'CANCELLED'
                            ? 'Đã hủy'
                            : 'Chờ chạy'
                    }}</em></span
                  ><span>{{ item.from_location }} → {{ item.to_location }}</span
                  ><small>{{ item.lot.lot_code }} · {{ formatNumber(item.quantity) }} kg</small>
                </article>
                <div
                  v-if="
                    !loadingTransportOverview &&
                    !transportOverviewError &&
                    !transportOverview.assigned.length
                  "
                  class="preview-empty"
                >
                  Bạn chưa nhận chuyến nào.
                </div>
              </div>
            </div>
          </va-inner-loading>
        </section>

        <section
          v-if="
            role !== 'TRANSPORTER' &&
            summary &&
            summary.total > 0 &&
            !loadingBatches &&
            !batchesError
          "
          class="production-overview"
          aria-labelledby="production-title"
        >
          <div>
            <h2 id="production-title">Phân bố trạng thái vụ nuôi</h2>
            <p>
              {{ search || status ? 'Theo bộ lọc hiện tại' : 'Trong phạm vi dữ liệu bạn được xem' }}
            </p>
          </div>
          <dl class="production-bars">
            <div v-for="(value, key) in summary.byStatus" :key="key">
              <dt>{{ STATUS_LABELS[key as keyof typeof STATUS_LABELS] || key }}</dt>
              <dd>
                <meter
                  :value="value"
                  :max="summary.total"
                  :aria-label="`${STATUS_LABELS[key as keyof typeof STATUS_LABELS] || key}: ${value} trên ${summary.total} vụ nuôi`"
                >
                  {{ value }} / {{ summary.total }}</meter
                ><span>{{ formatNumber(value) }}</span>
              </dd>
            </div>
          </dl>
        </section>
        <!-- Hồ sơ lô phù hợp theo quyền của vai trò -->
        <section
          v-if="role !== 'TRANSPORTER'"
          id="lot-directory"
          class="table-card-promax"
          aria-labelledby="lot-directory-title"
          tabindex="-1"
        >
          <div class="table-header-promax">
            <div>
              <h2 id="lot-directory-title" class="th-title">{{ roleCopy.tableTitle }}</h2>
              <p class="th-subtitle">{{ roleCopy.tableDescription }}</p>
            </div>
            <va-button
              preset="secondary"
              color="secondary"
              @click="refreshBatches"
              :loading="loadingBatches"
              class="btn-refresh"
            >
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                class="mr-1"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              Làm mới
            </va-button>
          </div>

          <CollectionToolbar
            :query="batchQuery"
            :status="status"
            :statuses="Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))"
            :total="count"
            :page="page"
            :page-size="pageSize"
            :loading="loadingBatches"
            label="vụ nuôi"
            @update:query="searchBatches"
            @update:status="filterBatches"
            @update:page="changePage"
          />
          <va-alert v-if="batchesError" color="danger" class="mb-4" role="alert">
            {{ batchesError }}
          </va-alert>

          <div v-if="loadingBatches" class="empty-state-promax" role="status">
            <va-inner-loading loading :size="40" color="#0e7490" />
            <p class="mt-4 text-gray-500">Đang tải danh sách vụ nuôi…</p>
          </div>

          <EmptyState
            v-else-if="!batchesError && batches.length === 0"
            heading="h3"
            icon="inventory_2"
            :title="search || status ? 'Không có vụ nuôi phù hợp' : 'Chưa có vụ nuôi'"
            :description="
              search || status
                ? 'Thử đổi từ khóa hoặc trạng thái.'
                : role === 'FARMER'
                  ? 'Tạo cơ sở và vụ nuôi để bắt đầu xây dựng hồ sơ nguồn gốc.'
                  : role === 'DISTRIBUTOR'
                    ? 'Hiện chưa có vụ nuôi nào được chia sẻ với tổ chức của bạn.'
                    : 'Chưa có hồ sơ nào được ghi nhận trên hệ thống.'
            "
          />

          <div
            v-else-if="batches.length"
            class="table-responsive"
            role="region"
            aria-label="Danh sách vụ nuôi"
            tabindex="0"
          >
            <table class="table-promax" role="table" aria-labelledby="lot-directory-title">
              <thead role="rowgroup">
                <tr role="row">
                  <th role="columnheader" scope="col">Mã vụ nuôi</th>
                  <th role="columnheader" scope="col">Cơ sở / Vùng nuôi</th>
                  <th role="columnheader" scope="col">Chủng loại</th>
                  <th role="columnheader" scope="col">Ngày thả giống</th>
                  <th role="columnheader" scope="col">Trạng thái</th>
                  <th role="columnheader" scope="col" class="text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                <tr role="row" v-for="batch in batches" :key="batch.id">
                  <td role="cell" class="batch-cell-code">
                    <span class="badge-code">{{ batch.batch_code }}</span>
                  </td>
                  <td role="cell" class="batch-cell-origin">
                    <div class="cell-title">{{ batch.pond?.pond_name ?? '—' }}</div>
                    <div class="cell-sub">{{ batch.pond?.farm_name ?? '' }}</div>
                  </td>
                  <td role="cell">
                    <span class="badge-species">{{
                      SPECIES_LABELS[batch.species] ?? batch.species
                    }}</span>
                  </td>
                  <td role="cell" class="cell-text">
                    <span class="mobile-field-label">Ngày thả giống</span
                    >{{ formatDate(batch.stocking_date) }}
                  </td>
                  <td role="cell" class="batch-cell-status">
                    <va-badge
                      :color="STATUS_COLORS[batch.status] ?? 'grey'"
                      :text="STATUS_LABELS[batch.status] ?? batch.status"
                      class="badge-status-promax"
                    />
                  </td>
                  <td role="cell" class="text-right batch-cell-action">
                    <button
                      type="button"
                      class="btn-action-promax"
                      :aria-label="`Chi tiết vụ nuôi ${batch.batch_code}`"
                      @click="openDetail(batch)"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        width="16"
                        height="16"
                        aria-hidden="true"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                        />
                      </svg>
                      Chi tiết
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </template>

    <!-- MODAL CHI TIẾT & BLOCKCHAIN TIMELINE (Cấu trúc V4 - Trị dứt điểm vỡ layout) -->
    <va-modal
      title="batch-detail-title"
      :model-value="detailVisible"
      @update:model-value="
        (value: boolean) => {
          if (!value) closeDetail()
        }
      "
      hide-default-actions
      size="large"
      :padding="false"
    >
      <template #header><span hidden></span></template>
      <!-- Container chính tự giới hạn chiều cao và tự cuộn -->
      <div class="custom-modal-container">
        <!-- Header Cố định (Sticky Header) -->
        <div class="custom-modal-header">
          <div class="mh-left">
            <div class="mh-icon">
              <svg
                viewBox="0 0 24 24"
                width="24"
                height="24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
            <div>
              <h2 id="batch-detail-title" class="mh-title">Hồ sơ vụ nuôi</h2>
              <p class="mh-subtitle">
                Mã truy xuất:
                <span class="text-primary font-mono">{{ selectedBatch?.batch_code }}</span>
              </p>
            </div>
          </div>
          <button class="btn-close-modal" aria-label="Đóng hồ sơ vụ nuôi" @click="closeDetail">
            <svg
              viewBox="0 0 24 24"
              width="24"
              height="24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- Body cuộn được (Scrollable Body) -->
        <div class="custom-modal-body">
          <div v-if="detailLoading" class="modal-loading-promax" role="status">
            <va-inner-loading loading :size="40" color="#0e7490" />
            <p>Đang tải hồ sơ vụ nuôi…</p>
          </div>

          <va-alert v-else-if="detailError" color="danger" role="alert"
            >{{ detailError }}
            <va-button v-if="selectedBatch" preset="secondary" @click="openDetail(selectedBatch)"
              >Thử lại</va-button
            ></va-alert
          >
          <div v-else-if="detail" class="detail-grid-promax">
            <!-- Cột trái: Thông tin -->
            <div class="col-info">
              <div class="card-info-promax mb-4">
                <h3 class="card-title-promax">Thông tin vụ nuôi</h3>
                <div class="info-list-promax">
                  <div class="info-row">
                    <span class="ir-label">Trạng thái</span>
                    <va-badge
                      :color="STATUS_COLORS[detail.batch.status]"
                      :text="STATUS_LABELS[detail.batch.status]"
                      class="badge-status-promax"
                    />
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
                <h3 class="card-title-promax">Dữ liệu đã ghi nhận</h3>
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
                <h3 class="card-title-promax mb-0">Nhật ký Blockchain</h3>
              </div>

              <div v-if="detail.blockchain.length === 0" class="empty-timeline-promax">
                <p>Chưa có dữ liệu giao dịch trên chuỗi khối.</p>
              </div>

              <div v-else class="timeline-wrapper-promax">
                <div
                  class="timeline-item-promax"
                  v-for="(record, index) in detail.blockchain"
                  :key="record.id"
                >
                  <div class="tl-line" v-if="index !== detail.blockchain.length - 1"></div>

                  <div class="tl-marker" :class="`marker-${record.status.toLowerCase()}`">
                    <svg
                      viewBox="0 0 24 24"
                      width="14"
                      height="14"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.5"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        :d="getEventIcon(record.event_type)"
                      />
                    </svg>
                  </div>

                  <div class="tl-content-card">
                    <div class="tl-card-header">
                      <h5>{{ EVENT_LABELS[record.event_type] ?? record.event_type }}</h5>
                      <span class="time">{{
                        formatBlockDate(record.recorded_at ?? record.created_at)
                      }}</span>
                    </div>

                    <div class="tl-card-body terminal-style">
                      <div class="hash-line">
                        <span class="h-label">TX_HASH:</span>
                        <span class="h-value" :title="record.transaction_hash || undefined">{{
                          shortHash(record.transaction_hash)
                        }}</span>
                      </div>
                      <div class="hash-line">
                        <span class="h-label">DATA_HASH:</span>
                        <span class="h-value" :title="record.data_hash || undefined">{{
                          shortHash(record.data_hash)
                        }}</span>
                      </div>
                      <div class="hash-status mt-2">
                        <span class="status-dot" :class="`bg-${statusColor(record)}`"></span>
                        <span class="status-text">{{ statusLabel(record) }}</span>
                        <span v-if="record.block_number" class="block-badge"
                          >Block #{{ record.block_number }}</span
                        >
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

<style scoped>
.home-page-promax {
  min-width: 0;
}
.hero-promax {
  display: grid;
  grid-template-columns: 1.1fr 1fr;
  width: min(calc(100% - 64px), 1344px);
  margin: 32px auto 56px;
  border-radius: 20px;
  overflow: hidden;
  background: var(--app-sidebar);
  color: white;
}
.hero-content-wrapper {
  padding: clamp(28px, 5vw, 72px);
  align-self: center;
}
.hero-title {
  margin: 0 0 24px;
  font-size: clamp(32px, 4.5vw, 60px);
  line-height: 1.15;
  letter-spacing: -0.04em;
  font-weight: 600;
}
.hero-desc {
  color: var(--app-sidebar-text);
  font-size: 15px;
  line-height: 1.8;
  margin: 0 0 32px;
}
.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.hero-link,
.workspace-action-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 44px;
  padding: 10px 16px;
  border: 1px solid var(--app-divider);
  border-radius: var(--app-control-radius);
  font-weight: 600;
}
.hero-link:hover {
  background: var(--app-divider);
}
.hero-link-primary {
  background: var(--app-accent);
  color: var(--app-sidebar);
  border-color: var(--app-accent);
}
.hero-link-primary:hover {
  background: white;
}
.hero-image {
  min-height: 320px;
  background: url('../../assets/aquaculture.webp') center / cover;
}
.workflow-section {
  width: min(calc(100% - 64px), 1344px);
  margin: 0 auto 48px;
}
.section-title {
  margin-bottom: 24px;
  font-size: 26px;
  font-weight: 600;
}
.workflow-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 24px;
}
.step-card {
  padding: 24px 0;
  border-top: 1px solid var(--app-line);
}
.step-card h3 {
  font-size: 17px;
  font-weight: 600;
  margin: 16px 0 8px;
}
.step-card p {
  color: var(--app-muted);
  line-height: 1.8;
}
.step-icon-wrap {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 10px;
  color: var(--app-primary-dark);
  background: var(--app-primary-soft);
}
.step-connector {
  display: none;
}
.workspace-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding-bottom: 28px;
  border-bottom: 1px solid var(--app-line);
}
.workspace-copy {
  min-width: 0;
  max-width: 760px;
}
.workspace-greeting {
  margin: 0 0 12px;
  color: var(--app-primary-dark);
  font-size: 13px;
  font-weight: 500;
}
.workspace-copy h1 {
  margin: 0 0 12px;
  color: var(--app-ink);
  font-size: var(--app-text-title);
  line-height: 1.3;
  font-weight: 600;
  letter-spacing: -0.035em;
}
.workspace-description {
  max-width: 65ch;
  color: var(--app-muted);
  font-size: 14px;
  line-height: 1.8;
}
.workspace-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-top: 16px;
}
.workspace-role,
.workspace-org {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--app-muted);
}
.workspace-action {
  display: grid;
  justify-items: end;
  gap: 12px;
  min-width: 0;
  max-width: 100%;
}
.workspace-date {
  font-size: 12px;
  color: var(--app-muted);
}
.workspace-action-button {
  background: var(--app-primary);
  color: white;
  border-color: var(--app-primary);
}
.workspace-action-button:hover {
  background: var(--app-primary-dark);
}
.workspace-secondary-link {
  color: var(--app-primary-dark);
  text-decoration: underline;
  text-underline-offset: 4px;
  padding: 8px;
}
.home-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin: 28px 0;
  border: 1px solid var(--app-line);
  border-radius: var(--app-radius);
  background: var(--app-surface);
}
.home-stat-card {
  min-width: 0;
  display: flex;
  flex-direction: row-reverse;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 24px;
}
.home-stat-card + .home-stat-card {
  border-left: 1px solid var(--app-line);
}
.home-stat-card p {
  color: var(--app-muted);
  font-size: 13px;
  margin: 0 0 8px;
}
.home-stat-card strong {
  display: block;
  font-size: 32px;
  font-weight: 600;
  line-height: 1.3;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.04em;
}
.home-stat-card small {
  display: block;
  color: var(--app-muted);
  font-size: 12px;
  margin-top: 8px;
  line-height: 1.7;
}
.home-stat-icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  color: var(--app-primary);
  background: var(--app-primary-soft);
}
.tone-amber {
  color: var(--app-warning);
  background: #fff5df;
}
.tone-blue {
  color: var(--app-info);
  background: #edf4fc;
}
.tone-green {
  color: var(--app-success);
  background: #eaf5ee;
}
.production-overview {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
  gap: 32px;
  padding: 24px 0 32px;
}
.production-overview h2 {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 8px;
}
.production-overview p {
  font-size: 13px;
  color: var(--app-muted);
}
.production-bars {
  display: grid;
  gap: 16px;
  margin: 0;
}
.production-bars > div {
  display: grid;
  grid-template-columns: minmax(130px, 1fr) minmax(0, 2fr);
  gap: 16px;
  align-items: center;
}
.production-bars dt {
  font-size: 13px;
  color: var(--app-muted);
}
.production-bars dd {
  display: flex;
  align-items: center;
  gap: 16px;
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.production-bars meter {
  width: 100%;
  height: 10px;
  accent-color: var(--app-primary);
}
.production-bars meter::-webkit-meter-bar {
  background: var(--app-line);
  border: 0;
  border-radius: 8px;
}
.production-bars meter::-webkit-meter-optimum-value {
  background: var(--app-primary);
  border-radius: 8px;
}
.table-card-promax,
.transport-overview-card {
  min-width: 0;
  background: var(--app-surface);
  border: 1px solid var(--app-line);
  border-radius: var(--app-radius);
  padding: 24px;
  scroll-margin-top: 88px;
}
.table-header-promax,
.overview-card-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
}
.th-title,
.overview-card-heading h2 {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 600;
}
.th-subtitle,
.overview-card-heading p {
  margin: 0;
  color: var(--app-muted);
  font-size: 13px;
}
.table-card-promax :deep(.collection-toolbar) {
  padding: 0;
  border: 0;
  border-radius: 0;
}
.table-responsive {
  overflow-x: auto;
}
.table-promax {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
}
.table-promax th {
  padding: 14px 16px;
  color: var(--app-muted);
  background: var(--app-canvas);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}
.table-promax td {
  padding: 16px;
  border-bottom: 1px solid var(--app-line);
  font-size: 13px;
  line-height: 1.6;
}
.table-promax tr:last-child td {
  border-bottom: 0;
}
.table-promax tbody tr:is(:hover, :focus-within) {
  background: var(--app-canvas);
}
.badge-code {
  color: var(--app-primary-dark);
  font-size: 12px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.cell-title {
  font-weight: 500;
}
.cell-sub {
  color: var(--app-muted);
  font-size: 12px;
  margin-top: 4px;
}
.cell-text {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.btn-action-promax {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid var(--app-line);
  border-radius: 8px;
  background: white;
  color: var(--app-primary-dark);
  cursor: pointer;
  white-space: nowrap;
}
.btn-action-promax:hover {
  background: var(--app-primary-soft);
  border-color: var(--app-primary);
}
.mobile-field-label {
  display: none;
}
.empty-state-promax,
.modal-loading-promax {
  display: grid;
  justify-items: center;
  gap: 16px;
  padding: 48px 16px;
  color: var(--app-muted);
}
.transport-preview-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 32px;
}
.preview-column-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
  font-size: 13px;
}
.preview-column-title > span:last-child {
  margin-left: auto;
  color: var(--app-muted);
}
.preview-indicator {
  width: 6px;
  height: 6px;
  background: var(--app-warning);
  border-radius: 50%;
}
.preview-indicator.moving {
  background: var(--app-info);
}
.transport-preview-row {
  display: grid;
  gap: 6px;
  padding: 16px 0;
  border-top: 1px solid var(--app-line);
  overflow-wrap: anywhere;
}
.preview-code {
  font-size: 13px;
  font-weight: 600;
  color: var(--app-primary-dark);
}
.preview-code em {
  display: inline-block;
  margin-left: 8px;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--app-canvas);
  color: var(--app-muted);
  font-size: 12px;
  font-style: normal;
}
.transport-preview-row small,
.preview-empty {
  color: var(--app-muted);
  font-size: 13px;
}
.preview-empty {
  padding: 24px 0;
}
.custom-modal-container {
  display: flex;
  flex-direction: column;
  width: min(100%, 1100px);
  max-height: calc(100dvh - 64px);
  overflow: hidden;
}
.custom-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  padding: 24px;
  border-bottom: 1px solid var(--app-line);
  flex-shrink: 0;
}
.mh-left {
  display: flex;
  gap: 16px;
  align-items: center;
  min-width: 0;
}
.mh-icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  color: var(--app-primary);
  background: var(--app-primary-soft);
  border-radius: 8px;
}
.mh-title {
  font-size: 20px;
  margin: 0 0 4px;
}
.mh-subtitle {
  font-size: 13px;
  color: var(--app-muted);
  overflow-wrap: anywhere;
}
.btn-close-modal {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  border: 0;
  background: var(--app-canvas);
  border-radius: 8px;
  cursor: pointer;
}
.custom-modal-body {
  overflow-y: auto;
  padding: 24px;
}
.detail-grid-promax {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr);
  gap: 32px;
}
.card-title-promax {
  margin: 0 0 20px;
  font-size: 16px;
  font-weight: 600;
}
.info-list-promax {
  display: grid;
  gap: 16px;
}
.info-row {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  border-bottom: 1px solid var(--app-line);
  padding-bottom: 12px;
  font-size: 13px;
}
.ir-label {
  color: var(--app-muted);
}
.ir-val {
  text-align: right;
  overflow-wrap: anywhere;
  max-width: 65%;
}
.stats-mini-promax {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.sm-box {
  min-width: 0;
  padding: 12px 8px;
  background: var(--app-canvas);
  border-radius: 8px;
  text-align: center;
}
.sm-num {
  display: block;
  font-size: 22px;
  font-weight: 600;
}
.sm-label {
  font-size: 12px;
  color: var(--app-muted);
}
.timeline-item-promax {
  position: relative;
  padding: 0 0 24px 40px;
}
.tl-line {
  position: absolute;
  top: 28px;
  bottom: 0;
  left: 13px;
  width: 1px;
  background: var(--app-line);
}
.tl-marker {
  position: absolute;
  top: 0;
  left: 0;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--app-canvas);
  color: var(--app-muted);
}
.marker-success {
  color: var(--app-success);
  background: #eaf5ee;
}
.marker-pending {
  color: var(--app-warning);
  background: #fff5df;
}
.marker-failed {
  color: var(--app-danger);
  background: #fceeee;
}
.tl-card-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}
.tl-card-header h5 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.time {
  font-size: 12px;
  color: var(--app-muted);
}
.terminal-style {
  background: var(--app-canvas);
  padding: 12px;
  border-radius: 8px;
  font-size: 12px;
}
.hash-line {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}
.h-label {
  color: var(--app-muted);
}
.h-value {
  color: var(--app-primary-dark);
  font-family: ui-monospace, monospace;
  overflow-wrap: anywhere;
}
.hash-status {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--app-line);
}
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.block-badge {
  color: var(--app-muted);
  margin-left: auto;
}
.footer-promax {
  text-align: center;
  padding: 24px;
  color: var(--app-muted);
  font-size: 12px;
}
@media (max-width: 1200px) {
  .workspace-hero {
    flex-wrap: wrap;
  }
  .workspace-action {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
  }
  .home-stat-card {
    flex-direction: column;
  }
}
@media (max-width: 800px) {
  .home-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .home-stat-card:nth-child(3) {
    border-left: 0;
  }
  .home-stat-card:nth-child(n + 3) {
    border-top: 1px solid var(--app-line);
  }
  .production-overview,
  .transport-preview-grid,
  .detail-grid-promax {
    grid-template-columns: minmax(0, 1fr);
    gap: 24px;
  }
  .hero-promax {
    grid-template-columns: minmax(0, 1fr);
  }
  .hero-image {
    min-height: 240px;
  }
  .workflow-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .table-responsive {
    overflow: visible;
  }
  .table-promax,
  .table-promax tbody {
    display: block;
  }
  .table-promax thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  .table-promax tbody {
    display: grid;
    gap: 16px;
  }
  .table-promax tbody tr {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
    border: 1px solid var(--app-line);
    border-radius: 8px;
    padding: 16px;
  }
  .table-promax td {
    display: block;
    padding: 0;
    border: 0;
    overflow-wrap: anywhere;
  }
  .batch-cell-code,
  .batch-cell-origin {
    grid-column: 1;
  }
  .batch-cell-status {
    grid-column: 2;
    grid-row: 1;
  }
  .batch-cell-action {
    grid-column: 1 / -1;
  }
  .batch-cell-action .btn-action-promax {
    width: 100%;
  }
  .mobile-field-label {
    display: block;
    font-size: 12px;
    color: var(--app-muted);
  }
}
@media (max-width: 600px) {
  .hero-promax,
  .workflow-section {
    width: calc(100% - 32px);
    margin-block: 16px 32px;
  }
  .workspace-date {
    width: 100%;
  }
  .home-stat-card {
    padding: 20px;
  }
  .home-stat-card strong {
    font-size: 28px;
  }
  .table-card-promax,
  .transport-overview-card {
    padding: 16px;
  }
  .table-header-promax,
  .overview-card-heading {
    flex-wrap: wrap;
  }
  .custom-modal-header,
  .custom-modal-body {
    padding: 16px;
  }
  .mh-icon {
    display: none;
  }
}
</style>
