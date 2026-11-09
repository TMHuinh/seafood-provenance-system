<script setup lang="ts">
import { computed, reactive, ref, watch, onUnmounted } from 'vue'
import CollectionToolbar from '../../components/CollectionToolbar.vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import {
  VaButton, VaInnerLoading, VaModal, VaInput, VaSelect,
  VaAlert, VaCard, VaCardContent, VaBadge, VaIcon
} from 'vuestic-ui'
import { api } from '../../api/client'
import { usePondsStore } from '../../stores/ponds.store'
import type { FarmResponse, Pond, PondInput, PondStatus } from '../../types'

const route = useRoute()
const router = useRouter()
const store = usePondsStore()

const { items, loading, saving, error } = storeToRefs(store)
const farmId = computed(() => String(route.params.farmId))
const farmName = ref('')
let contextVersion = 0

const showForm = ref(false)
const editingId = ref<string | null>(null)
const formError = ref('')
const success = ref('')
const editingPond = computed(() => items.value.find((pond) => pond.id === editingId.value) ?? null)

const query = ref(''); const filterStatus = ref(''); const listPage = ref(1); const listPageSize = 9
const filteredItems = computed(() => items.value.filter((item) => (!filterStatus.value || item.status === filterStatus.value) && `${item.pond_code} ${item.pond_name ?? ''}`.toLocaleLowerCase('vi').includes(query.value.trim().toLocaleLowerCase('vi'))))
const visibleItems = computed(() => filteredItems.value.slice((listPage.value - 1) * listPageSize, listPage.value * listPageSize))
watch([query, filterStatus], () => { listPage.value = 1 })
watch(() => filteredItems.value.length, (length) => { listPage.value = Math.min(listPage.value, Math.max(1, Math.ceil(length / listPageSize))) })

const form = reactive({
  pondName: '',
  area: '' as string | number,
  depth: '' as string | number,
  waterType: '',
  status: 'ACTIVE' as PondStatus
})

// Options cho VaSelect
const statuses: { value: PondStatus; label: string }[] = [
  { value: 'ACTIVE', label: 'Đang hoạt động' },
  { value: 'INACTIVE', label: 'Ngừng hoạt động' },
  { value: 'MAINTENANCE', label: 'Bảo trì' }
]
const waterTypes = ['Nước ngọt', 'Nước lợ', 'Nước mặn']

// UI Helpers
const statusLabels: Record<PondStatus, string> = {
  ACTIVE: 'Đang hoạt động',
  INACTIVE: 'Ngừng hoạt động',
  MAINTENANCE: 'Đang bảo trì'
}
const statusColors: Record<PondStatus, string> = {
  ACTIVE: 'success',
  INACTIVE: 'secondary',
  MAINTENANCE: 'warning'
}

function numberOrNull(value: string | number) {
  if (value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function reset() {
  editingId.value = null
  form.pondName = ''
  form.area = ''
  form.depth = ''
  form.waterType = ''
  form.status = 'ACTIVE'
  formError.value = ''
}

function openCreate() { if (saving.value || loading.value) return;
  reset()
  showForm.value = true
}

function openEdit(pond: Pond) {
  if (saving.value || loading.value) return
  editingId.value = pond.id
  form.pondName = pond.pond_name
  form.area = pond.area ?? ''
  form.depth = pond.depth ?? ''
  form.waterType = pond.water_type ?? ''
  form.status = pond.status
  showForm.value = true
}

function close() {
  if (saving.value) return
  showForm.value = false
  reset()
}

async function submit() {
  if (saving.value || loading.value) return
  const version = contextVersion
  formError.value = ''
  success.value = ''

  if (!form.pondName.trim()) {
    formError.value = 'Vui lòng nhập tên ao'
    return
  }

  const payload: PondInput = {
    pondName: form.pondName.trim(),
    area: numberOrNull(form.area),
    depth: numberOrNull(form.depth),
    waterType: form.waterType.trim() || null,
    status: form.status
  }

  try {
    if (editingId.value) {
      await store.update(farmId.value, editingId.value, payload)
      if (version !== contextVersion) return
      success.value = 'Đã cập nhật thông tin ao nuôi.'
    } else {
      await store.create(farmId.value, payload)
      if (version !== contextVersion) return
      success.value = 'Đã tạo ao nuôi mới thành công.'
    }
    close()
  } catch {
    if (version === contextVersion) formError.value = error.value
  }
}

async function remove(pond: Pond) {
  if (saving.value || loading.value) return
  const version = contextVersion
  if (!confirm(`Bạn có chắc chắn muốn xóa ao “${pond.pond_name}”? Dữ liệu không thể khôi phục.`)) return
  success.value = ''
  try {
    await store.remove(farmId.value, pond.id)
    if (version !== contextVersion) return
    success.value = 'Đã xóa ao nuôi khỏi hệ thống.'
  } catch { }
}

async function loadContext() {
  const version = ++contextVersion; const id = farmId.value
  showForm.value = false; reset(); success.value = ''; farmName.value = ''; query.value = ''; filterStatus.value = ''
  await store.load(id)
  if (version !== contextVersion) return
  try {
    const res = await api.get<FarmResponse>(`/farms/${id}`)
    if (version === contextVersion) farmName.value = res.farm.farm_name
  } catch (e) { if (version === contextVersion) store.error = e instanceof Error ? e.message : 'Không tải được cơ sở nuôi.' }
}
watch(farmId, loadContext, { immediate: true })

onUnmounted(() => { ++contextVersion })
</script>

<template>
  <main class="ponds-page" :aria-busy="loading">
    <va-button preset="plain" color="secondary" icon="arrow_back" class="back-btn"
      @click="router.push({ name: 'farms' })">
      Quay lại danh sách Cơ sở
    </va-button>

    <header class="page-header">
      <div class="header-content">
        <p class="eyebrow">
          <va-icon name="home_work" size="small" class="mr-1" />
          {{ farmName || 'Đang tải...' }}
        </p>
        <h1 class="page-title">Danh sách Ao nuôi</h1>
        <p class="page-description">Quản lý thông tin ao và mở từng vụ nuôi tại cơ sở này.</p>
      </div>
      <va-button icon="add" :disabled="loading || saving" gradient class="shadow-md" @click="openCreate">
        Thêm ao nuôi
      </va-button>
    </header>

    <!-- Thông báo -->
    <va-alert v-if="success" color="success" class="mb-4" icon="check_circle" outline closeable role="status">
      {{ success }}
    </va-alert>
    <va-alert v-if="error" color="danger" class="mb-4" icon="warning" outline closeable role="alert">
      {{ error }} <va-button preset="secondary" size="small" @click="loadContext()">Thử lại</va-button>
    </va-alert>

    <CollectionToolbar v-model:query="query" v-model:status="filterStatus" v-model:page="listPage" :statuses="statuses" :total="filteredItems.length" :page-size="listPageSize" :loading="loading" label="kết quả trong danh sách đã tải" />
    <p v-if="!loading && !error && items.length && !filteredItems.length" role="status">Không có kết quả phù hợp. Thử đổi từ khóa hoặc trạng thái.</p>
    <va-inner-loading :loading="loading">
      <!-- Empty State -->
      <div v-if="!loading && !error && !items.length" class="empty-state">
        <div class="empty-icon-wrapper">
          <va-icon name="water" size="3rem" color="info" />
        </div>
        <h2>Chưa có ao nuôi nào</h2>
        <p class="text-secondary">Hãy thêm ao nuôi đầu tiên để quản lý các vụ nuôi tại cơ sở này.</p>
        <va-button icon="add" class="mt-4" @click="openCreate">Tạo ao nuôi ngay</va-button>
      </div>

      <!-- Grid Layout -->
      <div v-else class="pond-grid">
        <va-card v-for="pond in visibleItems" :key="pond.id" class="pond-card hover-elevation">
          <va-card-content>
            <div class="card-top">
              <div class="pond-code-badge">
                <va-icon name="tag" size="small" class="mr-1" />
                <strong>{{ pond.pond_code }}</strong>
              </div>
              <va-badge :color="statusColors[pond.status]" :text="statusLabels[pond.status]" class="status-badge" />
            </div>

            <h2 class="pond-name">{{ pond.pond_name }}</h2>

            <div class="stats-grid">
              <div class="stat-item">
                <span class="stat-label">Diện tích</span>
                <span class="stat-value">{{ pond.area === null ? '—' : `${pond.area} ha` }}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">Độ sâu</span>
                <span class="stat-value">{{ pond.depth === null ? '—' : `${pond.depth} m` }}</span>
              </div>
              <div class="stat-item full-width mt-2">
                <span class="stat-label">Loại nước</span>
                <span class="stat-value water-type">
                  <va-icon name="waves" size="small" class="mr-1 text-info" />
                  {{ pond.water_type || 'Chưa cập nhật' }}
                </span>
              </div>
            </div>
          </va-card-content>

          <!-- Footer Actions -->
          <div class="card-actions">
            <va-button preset="primary" icon="calendar_month" class="flex-1"
              @click="router.push({ name: 'pond-batches', params: { farmId, pondId: pond.id } })">
              Quản lý Vụ
            </va-button>
            <va-button preset="secondary" icon="edit" color="info" aria-label="Chỉnh sửa" @click="openEdit(pond)" />
            <va-button preset="secondary" icon="delete" color="danger" aria-label="Xóa" @click="remove(pond)" />
          </div>
        </va-card>
      </div>
    </va-inner-loading>

    <!-- Modal Form -->
    <va-modal v-model="showForm" :no-dismiss="saving" hide-default-actions overlay-opacity="0.5">
      <template #header>
        <h2 class="modal-title">{{ editingId ? 'Cập nhật Ao nuôi' : 'Tạo Ao nuôi mới' }}</h2>
      </template>

      <form @submit.prevent="submit" class="modern-form">
        <div v-if="editingPond" class="generated-code col-span-2"><span>Mã ao</span><strong>{{ editingPond.pond_code }}</strong><small>Mã ao được hệ thống tạo tự động và không thể sửa.</small></div>
        <p v-else class="generated-code-hint col-span-2">Mã ao sẽ được tạo tự động khi lưu.</p>
        <va-input v-model="form.pondName" label="Tên ao *" placeholder="VD: Ao số 1" class="col-span-1"
          :rules="[(v) => !!v || 'Bắt buộc']" />

        <va-input v-model="form.area" label="Diện tích (ha)" type="number" placeholder="VD: 0.5" :min="0.01"
          :step="0.01" />
        <va-input v-model="form.depth" label="Độ sâu (m)" type="number" placeholder="VD: 1.2" :min="0.01"
          :step="0.01" />

        <va-select v-model="form.waterType" :options="waterTypes" label="Loại nước" placeholder="Chọn loại nước"
          clearable class="col-span-1" />

        <va-select v-model="form.status" :options="statuses" value-by="value" text-by="label" label="Trạng thái"
          class="col-span-1" />

        <va-alert v-if="formError" color="danger" outline size="small" class="col-span-2 mt-2" role="alert">
          {{ formError }}
        </va-alert>

        <div class="form-actions col-span-2">
          <va-button preset="secondary" type="button" color="secondary" @click="close">
            Hủy bỏ
          </va-button>
          <va-button type="submit" :loading="saving" color="primary">
            {{ editingId ? 'Lưu thay đổi' : 'Hoàn tất tạo' }}
          </va-button>
        </div>
      </form>
    </va-modal>
  </main>
</template>

<style scoped>
.page-description { max-width:60ch; margin:.6rem 0 0; color:#67827d; font-size:.9rem; line-height:1.55; }

.ponds-page {
  width: min(1180px, calc(100% - 2rem));
  margin: 0 auto;
  padding: 1.5rem 0 4rem;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
}

.back-btn {
  margin-bottom: 1rem;
  margin-left: -0.5rem;
}

/* Header Styles */
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 1rem;
  margin-bottom: 2rem;
}

.eyebrow {
  display: flex;
  align-items: center;
  margin: 0 0 0.5rem;
  color: var(--va-primary);
  font-size: 0.85rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.page-title {
  margin: 0;
  font-size: clamp(1.8rem, 4vw, 2.2rem);
  font-weight: 800;
  color: var(--app-ink);
}

/* Empty State */
.empty-state {
  padding: 5rem 1rem;
  text-align: center;
  background: var(--app-canvas);
  border: 2px dashed #cbd5e1;
  border-radius: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.empty-icon-wrapper {
  width: 80px;
  height: 80px;
  background: #e0f2fe;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 1.5rem;
}

.empty-state h2 {
  margin: 0 0 0.5rem;
  font-size: 1.5rem;
  color: var(--app-ink);
}

.text-secondary {
  color: var(--app-muted);
  margin: 0;
}

/* Grid Layout */
.pond-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr));
  gap: 1.5rem;
}

/* Cards */
.pond-card {
  border-radius: 16px;
  border: 1px solid var(--app-line);
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05) !important;
  transition: all 0.2s ease;
  display: flex;
  flex-direction: column;
}

.pond-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1) !important;
  border-color: #cbd5e1;
}

.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.75rem;
}

.pond-code-badge {
  display: inline-flex;
  align-items: center;
  background: #f1f5f9;
  padding: 0.25rem 0.75rem;
  border-radius: 6px;
  color: #334155;
  font-size: 0.85rem;
}

.status-badge {
  font-weight: 600;
  letter-spacing: 0.3px;
}

.pond-name {
  margin: 0 0 1.25rem;
  font-size: 1.35rem;
  font-weight: 700;
  color: var(--app-ink);
}

/* Card Stats */
.stats-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  padding-top: 1rem;
  border-top: 1px dashed var(--app-line);
}

.stat-item {
  flex: 1;
  min-width: 45%;
}

.full-width {
  flex: 100%;
}

.stat-label {
  display: block;
  font-size: 0.75rem;
  color: var(--app-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 0.25rem;
}

.stat-value {
  font-weight: 600;
  color: var(--app-ink);
  font-size: 0.95rem;
}

.water-type {
  display: flex;
  align-items: center;
  color: #0284c7;
}

/* Card Actions */
.card-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 1rem 1.25rem;
  background: var(--app-canvas);
  border-top: 1px solid #f1f5f9;
  border-radius: 0 0 16px 16px;
  margin-top: auto;
}

.flex-1 {
  flex: 1;
}

/* Modal & Form */
.modal-title {
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--app-ink);
  margin-bottom: 1rem;
}

.modern-form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.25rem;
  width: 100%;
  min-width: 500px;
}

.generated-code { display: grid; gap: .25rem; padding: .8rem 1rem; border: 1px solid #dbe7e4; border-radius: 10px; background: #f7faf9; }
.generated-code > span { color: var(--app-muted); font-size: .75rem; }
.generated-code > strong { color: #1d5149; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.generated-code > small, .generated-code-hint { margin: 0; color: var(--app-muted); font-size: .8rem; }

.col-span-1 {
  grid-column: span 1;
}

.col-span-2 {
  grid-column: 1 / -1;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 1rem;
  margin-top: 0.5rem;
  padding-top: 1rem;
  border-top: 1px solid #f1f5f9;
}

/* Utilities */
.mr-1 {
  margin-right: 0.35rem;
}

.mb-4 {
  margin-bottom: 1rem;
}

.mt-2 {
  margin-top: 0.5rem;
}

.mt-4 {
  margin-top: 1rem;
}

.text-info {
  color: #0284c7;
}

/* Responsive */
@media (max-width: 768px) {
  .page-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .pond-grid {
    grid-template-columns: 1fr;
  }

  .modern-form {
    grid-template-columns: 1fr;
    min-width: 100%;
  }

  .col-span-1,
  .col-span-2 {
    grid-column: 1 / -1;
  }
}
</style>
