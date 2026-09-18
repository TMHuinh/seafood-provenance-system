<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import {
  VaButton, VaInnerLoading, VaModal, VaInput, VaSelect,
  VaAlert, VaCard, VaCardContent, VaBadge, VaIcon
} from 'vuestic-ui'
import { api, ApiError } from '../../api/client'
import { usePondsStore } from '../../stores/ponds.store'
import type { FarmResponse, Pond, PondInput, PondStatus } from '../../types'

const route = useRoute()
const router = useRouter()
const store = usePondsStore()

const { items, loading, saving, error } = storeToRefs(store)
const farmId = computed(() => String(route.params.farmId))
const farmName = ref('')

const showForm = ref(false)
const editingId = ref<string | null>(null)
const formError = ref('')
const success = ref('')

const form = reactive({
  pondCode: '',
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
  form.pondCode = ''
  form.pondName = ''
  form.area = ''
  form.depth = ''
  form.waterType = ''
  form.status = 'ACTIVE'
  formError.value = ''
}

function openCreate() {
  reset()
  showForm.value = true
}

function openEdit(pond: Pond) {
  editingId.value = pond.id
  form.pondCode = pond.pond_code
  form.pondName = pond.pond_name
  form.area = pond.area ?? ''
  form.depth = pond.depth ?? ''
  form.waterType = pond.water_type ?? ''
  form.status = pond.status
  showForm.value = true
}

function close() {
  showForm.value = false
  reset()
}

async function submit() {
  formError.value = ''
  success.value = ''

  if (!form.pondCode.trim() || !form.pondName.trim()) {
    formError.value = 'Vui lòng nhập đầy đủ mã ao và tên ao'
    return
  }

  const payload: PondInput = {
    pondCode: form.pondCode.trim(),
    pondName: form.pondName.trim(),
    area: numberOrNull(form.area),
    depth: numberOrNull(form.depth),
    waterType: form.waterType.trim() || null,
    status: form.status
  }

  try {
    if (editingId.value) {
      await store.update(farmId.value, editingId.value, payload)
      success.value = 'Đã cập nhật thông tin ao nuôi.'
    } else {
      await store.create(farmId.value, payload)
      success.value = 'Đã tạo ao nuôi mới thành công.'
    }
    close()
  } catch {
    formError.value = error.value
  }
}

async function remove(pond: Pond) {
  if (!confirm(`Bạn có chắc chắn muốn xóa ao “${pond.pond_name}”? Dữ liệu không thể khôi phục.`)) return
  success.value = ''
  try {
    await store.remove(farmId.value, pond.id)
    success.value = 'Đã xóa ao nuôi khỏi hệ thống.'
  } catch { }
}

onMounted(async () => {
  try {
    const res = await api.get<FarmResponse>(`/farms/${farmId.value}`)
    farmName.value = res.farm.farm_name
    await store.load(farmId.value)
  } catch (e) {
    if (e instanceof ApiError) store.error = e.message
  }
})
</script>

<template>
  <main class="ponds-page">
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
      </div>
      <va-button icon="add" gradient class="shadow-md" @click="openCreate">
        Thêm ao nuôi
      </va-button>
    </header>

    <!-- Thông báo -->
    <va-alert v-if="success" color="success" class="mb-4" icon="check_circle" outline closeable>
      {{ success }}
    </va-alert>
    <va-alert v-if="error" color="danger" class="mb-4" icon="warning" outline closeable>
      {{ error }}
    </va-alert>

    <va-inner-loading :loading="loading">
      <!-- Empty State -->
      <div v-if="!loading && !items.length" class="empty-state">
        <div class="empty-icon-wrapper">
          <va-icon name="water" size="3rem" color="info" />
        </div>
        <h2>Chưa có ao nuôi nào</h2>
        <p class="text-secondary">Hãy thêm ao nuôi đầu tiên để quản lý các vụ nuôi tại cơ sở này.</p>
        <va-button icon="add" class="mt-4" @click="openCreate">Tạo ao nuôi ngay</va-button>
      </div>

      <!-- Grid Layout -->
      <div v-else class="pond-grid">
        <va-card v-for="pond in items" :key="pond.id" class="pond-card hover-elevation">
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
            <va-button preset="secondary" icon="edit" color="info" @click="openEdit(pond)" />
            <va-button preset="secondary" icon="delete" color="danger" @click="remove(pond)" />
          </div>
        </va-card>
      </div>
    </va-inner-loading>

    <!-- Modal Form -->
    <va-modal v-model="showForm" hide-default-actions overlay-opacity="0.5">
      <template #header>
        <h2 class="modal-title">{{ editingId ? 'Cập nhật Ao nuôi' : 'Tạo Ao nuôi mới' }}</h2>
      </template>

      <form @submit.prevent="submit" class="modern-form">
        <va-input v-model="form.pondCode" label="Mã ao *" placeholder="VD: AO-01" class="col-span-1"
          :rules="[(v) => !!v || 'Bắt buộc']" />
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

        <va-alert v-if="formError" color="danger" outline size="small" class="col-span-2 mt-2">
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
  color: #1e293b;
}

/* Empty State */
.empty-state {
  padding: 5rem 1rem;
  text-align: center;
  background: #f8fafc;
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
  color: #1e293b;
}

.text-secondary {
  color: #64748b;
  margin: 0;
}

/* Grid Layout */
.pond-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 1.5rem;
}

/* Cards */
.pond-card {
  border-radius: 16px;
  border: 1px solid #e2e8f0;
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
  color: #0f172a;
}

/* Card Stats */
.stats-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  padding-top: 1rem;
  border-top: 1px dashed #e2e8f0;
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
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 0.25rem;
}

.stat-value {
  font-weight: 600;
  color: #1e293b;
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
  background: #f8fafc;
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
  color: #0f172a;
  margin-bottom: 1rem;
}

.modern-form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.25rem;
  width: 100%;
  min-width: 500px;
}

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