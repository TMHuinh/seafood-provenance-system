<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import {
  VaButton, VaInnerLoading, VaModal, VaInput, VaSelect,
  VaAlert, VaCard, VaCardContent, VaBadge, VaIcon, VaTextarea
} from 'vuestic-ui'
import { usePondsStore } from '../../stores/ponds.store'
import { usePondBatchesStore } from '../../stores/pond-batches.store'
import { SPECIES_LABELS, STATUS_LABELS, type BatchVersion, type BatchInput, type BatchItem, type BatchStatusCode, type Species } from '../../types'

const route = useRoute(); const router = useRouter(); const store = usePondBatchesStore(); const pondsStore = usePondsStore()
const { items, loading, saving, error } = storeToRefs(store)
const farmId = computed(() => String(route.params.farmId)); const pondId = computed(() => String(route.params.pondId)); const pondName = ref('')
const showForm = ref(false); const editingId = ref<string | null>(null); const formError = ref(''); const success = ref(''); const warning = ref('')
const correctionReason = ref(''); const expectedVersion = ref(1)
const historyItems = ref<BatchVersion[]>([]); const historyTitle = ref(''); const historyLoading = ref(false)

const form = reactive({ batchCode: '', species: 'SHRIMP' as Species, seedSource: '', seedQuantity: '' as string | number, stockingDate: '', expectedHarvestDate: '', actualHarvestDate: '', yieldQuantity: '' as string | number, status: 'GROWING' as BatchStatusCode, note: '' })

// Chuyển đổi options cho Vuestic Select
const statusOptions = Object.entries(STATUS_LABELS).map(([value, label]) => ({ value: value as BatchStatusCode, label }))
const speciesOptions = Object.entries(SPECIES_LABELS).map(([value, label]) => ({ value: value as Species, label }))

// Helper màu sắc cho Badge trạng thái
const statusColors: Record<string, string> = {
  PLANNING: 'secondary',
  GROWING: 'info',
  HARVESTED: 'success',
  COMPLETED: 'success',
  CANCELED: 'danger',
  DISEASED: 'warning'
}

const canEnterHarvest = computed(() => Boolean(editingId.value) && ['HARVESTED', 'COMPLETED'].includes(form.status))
const numeric = (value: string | number) => value === '' ? null : Number(value)
const dateOnly = (value: string | null | undefined) => value ? value.slice(0, 10) : ''

function reset() { correctionReason.value = ''; expectedVersion.value = 1; editingId.value = null; Object.assign(form, { batchCode: '', species: 'SHRIMP', seedSource: '', seedQuantity: '', stockingDate: '', expectedHarvestDate: '', actualHarvestDate: '', yieldQuantity: '', status: 'GROWING', note: '' }); formError.value = '' }
function openCreate() { reset(); showForm.value = true }
function openEdit(item: BatchItem) { correctionReason.value = ''; formError.value = ''; expectedVersion.value = item.current_version; editingId.value = item.id; Object.assign(form, { batchCode: item.batch_code, species: item.species, seedSource: item.seed_source ?? '', seedQuantity: item.seed_quantity, stockingDate: dateOnly(item.stocking_date), expectedHarvestDate: dateOnly(item.expected_harvest_date), actualHarvestDate: dateOnly(item.actual_harvest_date), yieldQuantity: item.yield_quantity ?? '', status: item.status, note: item.note ?? '' }); showForm.value = true }
function close() { if (saving.value) return; showForm.value = false; reset() }

async function submit() {
  if (saving.value) return
  formError.value = ''; success.value = ''; warning.value = ''
  if (!form.batchCode.trim() || !form.stockingDate || numeric(form.seedQuantity) === null) { formError.value = 'Vui lòng nhập đầy đủ mã vụ, số lượng giống và ngày thả giống.'; return }

  const payload: BatchInput = { batchCode: form.batchCode.trim(), species: form.species, seedSource: form.seedSource.trim() || null, seedQuantity: Number(form.seedQuantity), stockingDate: form.stockingDate, expectedHarvestDate: form.expectedHarvestDate || null, status: form.status, note: form.note.trim() || null }

  if (editingId.value) {
    payload.actualHarvestDate = canEnterHarvest.value ? (form.actualHarvestDate || null) : null
    payload.yieldQuantity = canEnterHarvest.value ? numeric(form.yieldQuantity) : null
  }

  if (editingId.value && correctionReason.value.trim().length < 3) {
    formError.value = 'Vui lòng nhập lý do đính chính (ít nhất 3 ký tự).'
    return
  }

  try {
    const editing = Boolean(editingId.value)
    const result = editingId.value
      ? await store.update(farmId.value, pondId.value, editingId.value, {
          ...payload,
          correctionReason: correctionReason.value.trim(),
          expectedVersion: expectedVersion.value,
        })
      : await store.create(farmId.value, pondId.value, payload)
    const action = editing ? 'đính chính' : 'tạo'
    if (result.blockchain.status === 'SUCCESS') {
      success.value = `Đã ${action} vụ nuôi và ghi blockchain thành công.`
    } else {
      warning.value = result.blockchain.status === 'UNKNOWN'
        ? `Đã lưu ${action} vụ nuôi, nhưng chưa xác định được kết quả ghi blockchain. Không cần gửi lại.`
        : `Đã lưu ${action} vụ nuôi, nhưng chưa ghi blockchain thành công. Không cần gửi lại.`
    }
    close()
  } catch {
    formError.value = error.value
  }
}

async function openHistory(item: BatchItem) {
  historyTitle.value = item.batch_code
  historyItems.value = []
  historyLoading.value = true
  try {
    historyItems.value = await store.history(farmId.value, pondId.value, item.id)
  } catch {
    historyTitle.value = ''
    warning.value = 'Không thể tải lịch sử vụ nuôi. Vui lòng thử lại.'
  } finally {
    historyLoading.value = false
  }
}

function toggleHistory(value: boolean) {
  if (!value) historyTitle.value = ''
}

async function remove(item: BatchItem) {
  if (!confirm(`Bạn có chắc chắn muốn xóa vụ “${item.batch_code}”? Mọi dữ liệu nhật ký liên quan có thể bị mất.`)) return;
  try {
    await store.remove(farmId.value, pondId.value, item.id);
    success.value = 'Đã xóa vụ nuôi khỏi hệ thống.'
  } catch { }
}

onMounted(async () => {
  await pondsStore.load(farmId.value);
  pondName.value = pondsStore.items.find((x) => x.id === pondId.value)?.pond_name ?? '';
  await store.load(farmId.value, pondId.value)
})
</script>

<template>
  <main class="page-container">
    <va-button preset="plain" color="secondary" icon="arrow_back" class="back-btn"
      @click="router.push({ name: 'ponds', params: { farmId } })">
      Quay lại Danh sách Ao
    </va-button>

    <header class="page-header">
      <div class="header-info">
        <p class="eyebrow">
          <va-icon name="water" size="small" class="mr-1" />
          {{ pondName || 'Đang tải...' }}
        </p>
        <h1 class="page-title">Quản lý Vụ nuôi</h1>
      </div>
      <va-button icon="add" gradient class="shadow-md" @click="openCreate">
        Tạo vụ nuôi mới
      </va-button>
    </header>

    <!-- Alerts -->
    <va-alert v-if="success" color="success" class="mb-4" icon="check_circle" outline closeable>
      {{ success }}
    </va-alert>
    <va-alert v-if="warning" color="warning" class="mb-4" icon="warning" outline closeable>
      {{ warning }}
    </va-alert>
    <va-alert v-if="error" color="danger" class="mb-4" icon="warning" outline closeable>
      {{ error }}
    </va-alert>

    <va-inner-loading :loading="loading">
      <!-- Empty State -->
      <div v-if="!loading && !items.length" class="empty-state">
        <div class="empty-icon-wrapper">
          <va-icon name="set_meal" size="3rem" color="info" />
        </div>
        <h2>Chưa có vụ nuôi nào</h2>
        <p class="text-secondary">Hãy bắt đầu bằng việc tạo vụ nuôi đầu tiên cho ao này.</p>
        <va-button icon="add" class="mt-4" @click="openCreate">Tạo vụ nuôi ngay</va-button>
      </div>

      <!-- Lưới Card -->
      <div v-else class="batch-grid">
        <va-card v-for="item in items" :key="item.id" class="batch-card hover-elevation">
          <va-card-content>
            <div class="card-top">
              <div class="batch-code-badge">
                <va-icon name="tag" size="small" class="mr-1" />
                <strong>{{ item.batch_code }}</strong>
              </div>
              <va-badge :color="statusColors[item.status] || 'primary'" class="status-badge">
                {{ STATUS_LABELS[item.status] }}
              </va-badge>
            </div>

            <h2 class="species-title">
              <va-icon name="pets" size="small" color="secondary" class="mr-1" />
              {{ SPECIES_LABELS[item.species] }}
            </h2>

            <div class="stats-grid">
              <div class="stat-item">
                <span class="stat-label">Ngày thả</span>
                <span class="stat-value">{{ dateOnly(item.stocking_date) }}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">Số lượng giống</span>
                <span class="stat-value">{{ item.seed_quantity.toLocaleString('vi-VN') }}</span>
              </div>
              <div class="stat-item full-width mt-2">
                <span class="stat-label">Dự kiến thu hoạch</span>
                <span class="stat-value highlight">
                  <va-icon name="event" size="small" class="mr-1 text-info" />
                  {{ dateOnly(item.expected_harvest_date) || 'Chưa cập nhật' }}
                </span>
              </div>
            </div>
          </va-card-content>

          <!-- Footer Actions -->
          <div class="card-actions">
            <va-button preset="primary" icon="edit_document" class="flex-1"
              @click="router.push({ name: 'farming-logs', params: { farmId, pondId, batchId: item.id } })">
              Nhật ký
            </va-button>
            <va-button preset="secondary" icon="edit" color="info" aria-label="Đính chính" @click="openEdit(item)" />
            <va-button preset="secondary" icon="history" color="secondary" aria-label="Lịch sử" @click="openHistory(item)" />
            <va-button preset="secondary" icon="delete" color="danger" @click="remove(item)" />
          </div>
        </va-card>
      </div>
    </va-inner-loading>

    <!-- Modal Form -->
    <va-modal v-model="showForm" hide-default-actions size="large" overlay-opacity="0.5">
      <template #header>
        <h2 class="modal-title">{{ editingId ? 'Đính chính Vụ nuôi' : 'Tạo Vụ nuôi mới' }}</h2>
      </template>

      <form @submit.prevent="submit" class="modern-form">
        <va-input v-model="form.batchCode" label="Mã vụ nuôi *" placeholder="VD: VU-2026-01" class="col-span-1" />

        <va-select v-model="form.species" :options="speciesOptions" value-by="value" text-by="label" label="Loài nuôi *"
          class="col-span-1" />

        <va-input v-model="form.seedSource" label="Nguồn giống" placeholder="Tên trại giống..." class="col-span-1" />

        <va-input v-model="form.seedQuantity" type="number" label="Số lượng con giống *" min="1" step="1"
          class="col-span-1" />

        <va-input v-model="form.stockingDate" type="date" label="Ngày thả giống *" class="col-span-1" />

        <va-input v-model="form.expectedHarvestDate" type="date" label="Ngày dự kiến thu hoạch" class="col-span-1" />

        <va-select v-if="editingId" v-model="form.status" :options="statusOptions" value-by="value" text-by="label"
          label="Trạng thái" class="col-span-2" />

        <template v-if="canEnterHarvest">
          <div class="harvest-section col-span-2">
            <h3 class="section-title">Thông tin thu hoạch thực tế</h3>
            <div class="harvest-grid">
              <va-input v-model="form.actualHarvestDate" type="date" label="Ngày thu hoạch thực tế" />
              <va-input v-model="form.yieldQuantity" type="number" label="Sản lượng thu hoạch (kg)" min="0"
                step="0.01" />
            </div>
          </div>
        </template>

        <va-textarea v-model="form.note" label="Ghi chú" placeholder="Thông tin thêm..." class="col-span-2" />

        <va-textarea v-if="editingId" v-model="correctionReason" label="Lý do đính chính *"
          placeholder="Ví dụ: Nhập sai số lượng con giống" minlength="3" maxlength="1000" class="col-span-2" />

        <va-alert v-if="formError" color="danger" outline size="small" class="col-span-2 mt-2">
          {{ formError }}
        </va-alert>

        <div class="form-actions col-span-2">
          <va-button preset="secondary" type="button" color="secondary" @click="close">
            Hủy bỏ
          </va-button>
          <va-button type="submit" :loading="saving" :disabled="saving" color="primary">
            {{ editingId ? 'Đính chính và ghi blockchain' : 'Tạo và ghi blockchain' }}
          </va-button>
        </div>
      </form>
    </va-modal>

    <va-modal :model-value="Boolean(historyTitle)" hide-default-actions size="large"
      @update:model-value="toggleHistory">
      <template #header>
        <h2 class="modal-title">Lịch sử vụ {{ historyTitle }}</h2>
      </template>
      <va-inner-loading :loading="historyLoading">
        <div class="version-list">
          <va-card v-for="version in historyItems" :key="version.id" class="version-card">
            <va-card-content>
              <div class="version-heading">
                <strong>Phiên bản {{ version.version_number }}</strong>
                <va-badge :color="version.blockchain?.status === 'SUCCESS' ? 'success' : 'warning'">
                  {{ version.blockchain?.status === 'SUCCESS' ? 'Đã ghi blockchain' : 'Chưa xác nhận' }}
                </va-badge>
              </div>
              <p>{{ version.correction_reason || 'Dữ liệu được lưu trước lần đính chính đầu tiên' }}</p>
              <dl class="version-details">
                <div><dt>Mã vụ / loài</dt><dd>{{ version.snapshot.batch_code }} / {{ SPECIES_LABELS[version.snapshot.species] }}</dd></div>
                <div><dt>Nguồn giống</dt><dd>{{ version.snapshot.seed_source || '—' }}</dd></div>
                <div><dt>Số lượng giống</dt><dd>{{ version.snapshot.seed_quantity.toLocaleString('vi-VN') }}</dd></div>
                <div><dt>Ngày thả / dự kiến thu</dt><dd>{{ dateOnly(version.snapshot.stocking_date) }} / {{ dateOnly(version.snapshot.expected_harvest_date) || '—' }}</dd></div>
                <div><dt>Ngày thu / sản lượng (kg)</dt><dd>{{ dateOnly(version.snapshot.actual_harvest_date) || '—' }} / {{ version.snapshot.yield_quantity ?? '—' }}</dd></div>
                <div><dt>Trạng thái</dt><dd>{{ STATUS_LABELS[version.snapshot.status] }}</dd></div>
                <div><dt>Ghi chú</dt><dd>{{ version.snapshot.note || '—' }}</dd></div>
              </dl>
              <p v-if="version.blockchain?.transaction_hash" class="transaction">
                Giao dịch: {{ version.blockchain.transaction_hash }}
              </p>
            </va-card-content>
          </va-card>
          <p v-if="!historyLoading && !historyItems.length" class="text-secondary">Chưa có dữ liệu lịch sử.</p>
        </div>
      </va-inner-loading>
      <div class="form-actions">
        <va-button preset="secondary" @click="historyTitle = ''">Đóng</va-button>
      </div>
    </va-modal>
  </main>
</template>

<style scoped>
.page-container {
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
.batch-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 1.5rem;
}

/* Cards */
.batch-card {
  border-radius: 16px;
  border: 1px solid #e2e8f0;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05) !important;
  transition: all 0.2s ease;
  display: flex;
  flex-direction: column;
}

.batch-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1) !important;
  border-color: #cbd5e1;
}

.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.batch-code-badge {
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

.species-title {
  display: flex;
  align-items: center;
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

.stat-value.highlight {
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

.harvest-section {
  background: #f8fafc;
  border: 1px dashed #cbd5e1;
  padding: 1.25rem;
  border-radius: 12px;
}

.section-title {
  margin: 0 0 1rem;
  font-size: 1rem;
  font-weight: 700;
  color: #0f766e;
}

.harvest-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.25rem;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 1rem;
  margin-top: 0.5rem;
  padding-top: 1rem;
  border-top: 1px solid #f1f5f9;
}

.version-list {
  display: grid;
  gap: 1rem;
  min-width: 500px;
}

.version-card {
  border: 1px solid #e2e8f0;
}

.version-heading,
.version-details div {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
}

.version-details div {
  padding: 0.6rem 0;
  border-top: 1px solid #f1f5f9;
}

.version-details dd {
  max-width: 65%;
  margin: 0;
  font-weight: 600;
  text-align: right;
  overflow-wrap: anywhere;
}

.transaction {
  overflow-wrap: anywhere;
  color: #475569;
  font-size: 0.85rem;
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

  .batch-grid {
    grid-template-columns: 1fr;
  }

  .modern-form,
  .harvest-grid,
  .version-list {
    grid-template-columns: 1fr;
    min-width: 100%;
  }

  .col-span-1,
  .col-span-2 {
    grid-column: 1 / -1;
  }
}
</style>
