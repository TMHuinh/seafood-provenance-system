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
import { useFarmingLogsStore } from '../../stores/farming-logs.store'
import { FARMING_LOG_TYPE_LABELS, SPECIES_LABELS, type BatchItem, type FarmingLog, type FarmingLogHistoryResponse, type FarmingLogInput, type FarmingLogType, type FarmingLogVerifyResponse } from '../../types'

const route = useRoute(); const router = useRouter(); const logStore = useFarmingLogsStore(); const pondsStore = usePondsStore(); const batchesStore = usePondBatchesStore()
const { items, loading, saving, verifying } = storeToRefs(logStore)
const farmId = computed(() => String(route.params.farmId)); const pondId = computed(() => String(route.params.pondId)); const batchId = computed(() => String(route.params.batchId))
const pondName = ref(''); const batchInfo = ref<BatchItem | null>(null); const error = ref('')
const showForm = ref(false); const formError = ref(''); const success = ref('')
const editingId = ref<string | null>(null)
const editingMode = ref<'DRAFT' | 'CORRECTION'>('DRAFT'); const historyResult = ref<FarmingLogHistoryResponse | null>(null)
const verifyResults = ref<FarmingLogVerifyResponse | null>(null); const verifyError = ref(''); const verifiedStatus = ref<Record<string, 'SYNCED' | 'DESYNCED' | 'PENDING' | 'DRAFT'>>({})

const showHistoryModal = computed({ get: () => !!historyResult.value, set: (val) => { if (!val) historyResult.value = null } })
const showVerifyModal = computed({ get: () => !!verifyResults.value, set: (val) => { if (!val) verifyResults.value = null } })

const logTypes = Object.entries(FARMING_LOG_TYPE_LABELS).map(([value, label]) => ({ value: value as FarmingLogType, label }))
const form = reactive({ logType: 'FEEDING' as FarmingLogType, logDate: '', feedType: '', feedAmount: '' as string | number, temperature: '' as string | number, salinity: '' as string | number, ph: '' as string | number, dissolvedOxygen: '' as string | number, medicineName: '', dose: '', mortalityCount: '' as string | number, cause: '', description: '', imageUrl: '', correctionReason: '' })
const DETAIL_LABELS: Record<string, string> = { feedType: 'Loại thức ăn', feedAmount: 'Số lượng (kg)', temperature: 'Nhiệt độ (°C)', salinity: 'Độ mặn (‰)', ph: 'pH', dissolvedOxygen: 'Oxy hòa tan (mg/L)', medicineName: 'Tên thuốc / hoá chất', dose: 'Liều lượng', mortalityCount: 'Số con chết', cause: 'Nguyên nhân', description: 'Mô tả', note: 'Ghi chú' }
const numeric = (value: string | number) => value === '' ? null : Number(value)

// --------------------------------------------------
// LOGIC SẮP XẾP VÀ GOM NHÓM THEO NGÀY
// --------------------------------------------------

const groupedLogs = computed(() => {
  const sorted = [...items.value].sort((a, b) => new Date(b.log_date).getTime() - new Date(a.log_date).getTime())
  const groups: { date: string, items: FarmingLog[] }[] = []
  sorted.forEach(log => {
    const dateStr = new Date(log.log_date).toLocaleDateString('vi-VN')
    let group = groups.find(g => g.date === dateStr)
    if (!group) { group = { date: dateStr, items: [] }; groups.push(group) }
    group.items.push(log)
  })
  return groups
})

const groupedHistoryItems = computed(() => {
  if (!historyResult.value) return []
  const sorted = [...historyResult.value.items].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  const groups: { date: string, items: typeof sorted }[] = []
  sorted.forEach(item => {
    const dateStr = new Date(item.created_at).toLocaleDateString('vi-VN')
    let group = groups.find(g => g.date === dateStr)
    if (!group) { group = { date: dateStr, items: [] }; groups.push(group) }
    group.items.push(item)
  })
  return groups
})

const groupedVerifyDetails = computed(() => {
  if (!verifyResults.value) return []
  const sorted = [...verifyResults.value.details].sort((a, b) => new Date(b.logDate).getTime() - new Date(a.logDate).getTime())
  const groups: { date: string, items: typeof sorted }[] = []
  sorted.forEach(item => {
    const dateStr = new Date(item.logDate).toLocaleDateString('vi-VN')
    let group = groups.find(g => g.date === dateStr)
    if (!group) { group = { date: dateStr, items: [] }; groups.push(group) }
    group.items.push(item)
  })
  return groups
})

// --------------------------------------------------

function formatDateTime(value: string) { 
  const d = new Date(value); 
  if (isNaN(d.getTime())) return value;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())} - ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function toDatetimeLocal(value: string | Date | null | undefined) {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(value)
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function shortHash(value: string) { return value.length <= 18 ? value : `${value.slice(0, 10)}…${value.slice(-6)}` }
function detailsRows(log: FarmingLog) { return Object.entries(log.details ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => ({ label: DETAIL_LABELS[k] ?? k, value: String(v) })) }
function reset() { Object.assign(form, { logType: 'FEEDING', logDate: '', feedType: '', feedAmount: '', temperature: '', salinity: '', ph: '', dissolvedOxygen: '', medicineName: '', dose: '', mortalityCount: '', cause: '', description: '', imageUrl: '', correctionReason: '' }); formError.value = '' }

function openCreate() { editingId.value = null; reset(); showForm.value = true }
function openEdit(log: FarmingLog) {
  reset()
  editingId.value = log.id
  editingMode.value = log.lifecycle_status === 'DRAFT' ? 'DRAFT' : 'CORRECTION'
  const details = log.details ?? {}
  Object.assign(form, {
    logType: log.log_type,
    logDate: toDatetimeLocal(log.log_date),
    feedType: String(details.feedType ?? ''),
    feedAmount: (details.feedAmount ?? '') as string | number,
    temperature: (details.temperature ?? '') as string | number,
    salinity: (details.salinity ?? '') as string | number,
    ph: (details.ph ?? '') as string | number,
    dissolvedOxygen: (details.dissolvedOxygen ?? '') as string | number,
    medicineName: String(details.medicineName ?? ''),
    dose: String(details.dose ?? ''),
    mortalityCount: (details.mortalityCount ?? '') as string | number,
    cause: String(details.cause ?? ''),
    description: String(details.description ?? details.note ?? ''),
    imageUrl: log.image_url ?? '',
    correctionReason: '',
  })
  showForm.value = true
}
function close() { showForm.value = false; editingId.value = null; editingMode.value = 'DRAFT'; reset() }

function buildDetails(): Record<string, unknown> {
  switch (form.logType) {
    case 'FEEDING': return { feedType: form.feedType.trim(), feedAmount: numeric(form.feedAmount), note: form.description.trim() || null }
    case 'WATER_QUALITY': return { temperature: numeric(form.temperature), salinity: numeric(form.salinity), ph: numeric(form.ph), dissolvedOxygen: numeric(form.dissolvedOxygen), note: form.description.trim() || null }
    case 'MEDICINE': return { medicineName: form.medicineName.trim(), dose: form.dose.trim() || null, note: form.description.trim() || null }
    case 'MORTALITY': return { mortalityCount: numeric(form.mortalityCount), cause: form.cause.trim() || null, note: form.description.trim() || null }
    default: return { description: form.description.trim() }
  }
}

function validate(): string {
  if (form.logType === 'FEEDING' && !form.feedType.trim()) return 'Vui lòng nhập loại thức ăn'
  if (form.logType === 'MEDICINE' && !form.medicineName.trim()) return 'Vui lòng nhập tên thuốc / hoá chất'
  if (form.logType === 'MORTALITY' && numeric(form.mortalityCount) === null) return 'Vui lòng nhập số con chết'
  if ((form.logType === 'CARE' || form.logType === 'ENVIRONMENT' || form.logType === 'OTHER') && !form.description.trim()) return 'Vui lòng nhập mô tả'
  return ''
}

async function submit() {
  formError.value = ''; success.value = ''
  if (!form.logDate) { formError.value = 'Vui lòng chọn thời gian ghi nhật ký'; return }
  const required = validate()
  if (required) { formError.value = required; return }
  if (editingId.value && editingMode.value === 'CORRECTION' && form.correctionReason.trim().length < 3) { formError.value = 'Vui lòng nhập lý do đính chính (tối thiểu 3 ký tự)'; return }

  const isoLogDate = new Date(form.logDate).toISOString()

  const input: FarmingLogInput = { 
    batchId: batchId.value, 
    logType: form.logType, 
    logDate: isoLogDate, 
    details: buildDetails(), 
    imageUrl: form.imageUrl.trim() || null, 
    correctionReason: editingId.value ? form.correctionReason.trim() : undefined 
  }
  
  try {
    if (editingId.value) {
      const current = items.value.find((item) => item.id === editingId.value)
      if (editingMode.value === 'CORRECTION' && current) await logStore.correct(editingId.value, { ...input, expectedVersion: current.current_version })
      else await logStore.update(editingId.value, input)
      verifiedStatus.value = {}
      success.value = editingMode.value === 'CORRECTION' ? 'Đã đính chính và chứng thực phiên bản mới' : 'Đã lưu thay đổi bản nháp'
    } else {
      await logStore.create(input)
      success.value = 'Đã lưu bản nháp'
    }
    close()
  } catch { formError.value = logStore.error }
}

async function confirmLog(log: FarmingLog) { try { await logStore.confirm(log.id); success.value = 'Đã xác nhận và chứng thực Blockchain' } catch { error.value = logStore.error } }
async function revokeLog(log: FarmingLog) { const reason = window.prompt('Nhập lý do thu hồi:')?.trim(); if (!reason) return; try { await logStore.revoke(log.id, reason); success.value = 'Đã thu hồi nhật ký' } catch { error.value = logStore.error } }
async function showHistory(log: FarmingLog) { try { historyResult.value = await logStore.history(log.id) } catch { error.value = logStore.error } }

async function checkSync() {
  verifyError.value = ''; verifyResults.value = null;
  try {
    verifyResults.value = await logStore.verify(batchId.value)
    const map: Record<string, 'SYNCED' | 'DESYNCED' | 'PENDING' | 'DRAFT'> = {}
    for (const item of verifyResults.value.details) {
      if (item.record?.status === 'PENDING') map[item.id] = 'PENDING'
      else map[item.id] = item.status
    }
    verifiedStatus.value = map
  } catch { verifyError.value = logStore.error }
}

onMounted(async () => {
  await pondsStore.load(farmId.value)
  pondName.value = pondsStore.items.find((x) => x.id === pondId.value)?.pond_name ?? ''
  await batchesStore.load(farmId.value, pondId.value)
  batchInfo.value = batchesStore.items.find((x) => x.id === batchId.value) ?? null
  error.value = logStore.error
  await logStore.load(batchId.value)
  error.value = logStore.error
})

// Helpers màu sắc
const lifecycleColors: Record<string, string> = { DRAFT: 'secondary', CONFIRMED: 'success', REVOKED: 'danger' }
const lifecycleLabels: Record<string, string> = { DRAFT: 'Bản nháp', CONFIRMED: '✓ Đã chứng thực', REVOKED: 'Đã thu hồi' }
const verifyColors: Record<string, string> = { SYNCED: 'success', DESYNCED: 'danger', PENDING: 'warning', DRAFT: 'secondary' }
const verifyLabels: Record<string, string> = { SYNCED: '✓ Đồng bộ', DESYNCED: '✗ Lệch dữ liệu', PENDING: '⏳ Đang chờ xác nhận', DRAFT: 'Chưa chứng thực' }

// Fix lỗi số 1 và số 2 (Undefined Index Type)
function getVerifyColor(status?: string) { return status ? verifyColors[status] : 'secondary'; }
function getVerifyLabel(status?: string) { return status ? verifyLabels[status] : ''; }
</script>

<template>
  <main class="page-container">
    <va-button preset="plain" color="secondary" icon="arrow_back" class="back-btn" @click="router.push({ name: 'pond-batches', params: { farmId, pondId } })">
      Quay lại Các vụ nuôi
    </va-button>

    <header class="page-header">
      <div class="header-info">
        <p class="eyebrow">
          <va-icon name="water" size="small" class="mr-1" />
          {{ batchInfo ? `${batchInfo.batch_code} · ${SPECIES_LABELS[batchInfo.species]}` : 'Vụ nuôi' }} · {{ pondName }}
        </p>
        <h1 class="page-title">Nhật ký nuôi</h1>
      </div>
      <div class="header-actions">
        <va-button preset="secondary" icon="sync" :loading="verifying" @click="checkSync">Kiểm tra Blockchain</va-button>
        <va-button icon="add" gradient @click="openCreate">Ghi nhật ký</va-button>
      </div>
    </header>

    <va-alert v-if="success" color="success" class="mb-4" icon="check_circle" outline closeable>{{ success }}</va-alert>
    <va-alert v-if="error" color="danger" class="mb-4" icon="warning" outline closeable>{{ error }}</va-alert>

    <va-inner-loading :loading="loading">
      <div v-if="!loading && !items.length" class="empty-state">
        <div class="empty-icon-wrapper"><va-icon name="edit_document" size="3rem" color="info" /></div>
        <h2>Chưa có nhật ký nuôi</h2>
        <p class="text-secondary">Hãy ghi lại hoạt động đầu tiên cho vụ nuôi này.</p>
        <va-button icon="add" class="mt-4" @click="openCreate">Ghi nhật ký</va-button>
      </div>

      <!-- Log Groups (Gom nhóm và sắp xếp theo ngày) -->
      <div v-else class="logs-container">
        <div v-for="group in groupedLogs" :key="group.date" class="date-group">
          
          <!-- Header của Ngày -->
          <h3 class="date-header">
            <va-icon name="calendar_today" size="small" class="mr-2" color="primary" /> 
            Ngày {{ group.date }}
          </h3>

          <div class="log-grid">
            <va-card v-for="log in group.items" :key="log.id" class="log-card">
              <va-card-content>
                <div class="card-top">
                  <strong class="log-type-title">{{ FARMING_LOG_TYPE_LABELS[log.log_type] }}</strong>
                  <va-badge :color="lifecycleColors[log.lifecycle_status]" :text="lifecycleLabels[log.lifecycle_status]" />
                </div>
                <p class="log-date"><va-icon name="schedule" size="small" class="mr-1" />{{ formatDateTime(log.log_date) }}</p>

                <div class="log-details">
                  <div v-for="row in detailsRows(log)" :key="row.label" class="detail-row">
                    <span class="detail-label">{{ row.label }}</span>
                    <span class="detail-value">{{ row.value }}</span>
                  </div>
                </div>

                <div v-if="log.data_hash" class="hash-block">
                  <div class="hash-line"><span>DATA:</span> {{ shortHash(log.data_hash) }}</div>
                  <div v-if="log.tx_hash" class="hash-line"><span>TX:</span> {{ shortHash(log.tx_hash) }}</div>
                </div>

                <div v-if="verifiedStatus[log.id]" class="mt-2">
                  <va-badge :color="getVerifyColor(verifiedStatus[log.id])" outline>
                    {{ getVerifyLabel(verifiedStatus[log.id]) }}
                  </va-badge>
                </div>
              </va-card-content>

              <div class="card-actions">
                <va-button v-if="log.lifecycle_status !== 'REVOKED'" preset="primary" size="small" @click="openEdit(log)">
                  {{ log.lifecycle_status === 'DRAFT' ? 'Chỉnh sửa' : 'Đính chính' }}
                </va-button>
                <va-button v-if="log.lifecycle_status === 'DRAFT'" color="success" size="small" :loading="saving" @click="confirmLog(log)">Xác nhận</va-button>
                <va-button v-if="log.lifecycle_status === 'CONFIRMED'" preset="plain" color="danger" size="small" @click="revokeLog(log)">Thu hồi</va-button>
                
                <!-- Fix Cảnh báo số 4 (Đổi flex-grow thành grow) -->
                <div class="grow"></div>
                
                <va-button v-if="log.current_version_id" preset="secondary" icon="history" size="small" @click="showHistory(log)">Lịch sử</va-button>
              </div>
            </va-card>
          </div>
        </div>
      </div>
    </va-inner-loading>

    <!-- Modal: Ghi Nhật Ký -->
    <va-modal v-model="showForm" hide-default-actions size="large" overlay-opacity="0.5">
      <template #header>
        <h2 class="modal-title">{{ editingId ? (editingMode === 'CORRECTION' ? 'Đính chính nhật ký' : 'Chỉnh sửa bản nháp') : 'Ghi nhật ký nuôi' }}</h2>
      </template>

      <form @submit.prevent="submit" class="modern-form">
        <va-select v-model="form.logType" :options="logTypes" value-by="value" text-by="label" label="Loại nhật ký *" class="col-span-1" />
        
        <va-input v-model="form.logDate" type="datetime-local" label="Thời gian ghi (Ngày & Giờ) *" :max="toDatetimeLocal(new Date())" class="col-span-1" />

        <template v-if="form.logType === 'FEEDING'">
          <va-input v-model="form.feedType" label="Loại thức ăn *" placeholder="VD: Thức ăn viên 40%" class="col-span-1" />
          <va-input v-model="form.feedAmount" type="number" label="Số lượng (kg)" min="0" step="0.01" class="col-span-1" />
        </template>
        <template v-else-if="form.logType === 'WATER_QUALITY'">
          <va-input v-model="form.temperature" type="number" label="Nhiệt độ (°C)" step="0.1" class="col-span-1" />
          <va-input v-model="form.salinity" type="number" label="Độ mặn (‰)" step="0.1" class="col-span-1" />
          <va-input v-model="form.ph" type="number" label="pH" min="0" max="14" step="0.1" class="col-span-1" />
          <va-input v-model="form.dissolvedOxygen" type="number" label="Oxy hòa tan (mg/L)" step="0.1" class="col-span-1" />
        </template>
        <template v-else-if="form.logType === 'MEDICINE'">
          <va-input v-model="form.medicineName" label="Tên thuốc / hoá chất *" class="col-span-1" />
          <va-input v-model="form.dose" label="Liều lượng" class="col-span-1" />
        </template>
        <template v-else-if="form.logType === 'MORTALITY'">
          <va-input v-model="form.mortalityCount" type="number" label="Số con chết *" min="0" step="1" class="col-span-1" />
          <va-input v-model="form.cause" label="Nguyên nhân" class="col-span-1" />
        </template>
        <template v-else>
          <va-textarea v-model="form.description" label="Mô tả *" placeholder="Mô tả chi tiết hoạt động..." class="col-span-2" />
        </template>

        <template v-if="['FEEDING', 'WATER_QUALITY', 'MEDICINE', 'MORTALITY'].includes(form.logType)">
          <va-textarea v-model="form.description" label="Ghi chú" class="col-span-2" />
        </template>

        <va-input v-model="form.imageUrl" label="Hình ảnh (URL)" placeholder="https://..." class="col-span-2" />
        <va-textarea v-if="editingId && editingMode === 'CORRECTION'" v-model="form.correctionReason" label="Lý do đính chính *" placeholder="Ví dụ: Nhập nhầm số lượng thức ăn" class="col-span-2" required />

        <va-alert v-if="formError" color="danger" outline size="small" class="col-span-2 mt-2">{{ formError }}</va-alert>

        <div class="form-actions col-span-2">
          <va-button preset="secondary" type="button" color="secondary" @click="close">Hủy bỏ</va-button>
          <va-button type="submit" :loading="saving" color="primary">{{ editingId ? 'Lưu thay đổi' : 'Hoàn tất ghi' }}</va-button>
        </div>
      </form>
    </va-modal>

    <!-- Modal: Lịch sử phiên bản (Có gom nhóm theo ngày) -->
    <va-modal v-model="showHistoryModal" hide-default-actions size="large" overlay-opacity="0.5">
      <template #header><h2 class="modal-title">Lịch sử phiên bản</h2></template>
      <div v-if="historyResult" class="history-list">
        <div v-for="group in groupedHistoryItems" :key="group.date" class="date-group-small mb-4">
          <h4 class="date-header-small">Ngày {{ group.date }}</h4>
          
          <va-card v-for="version in group.items" :key="version.id" outlined class="mb-3">
            <va-card-content>
              <div class="v-top">
                <strong>Phiên bản {{ version.version_number }}</strong>
                
                <!-- Fix lỗi số 3 (Đổi 'VALID' thành 'ACTIVE') -->
                <va-badge :color="version.status === 'ACTIVE' ? 'success' : 'secondary'">{{ version.status }}</va-badge>
              </div>
              <p v-if="version.correction_reason" class="correction-reason"><strong>Lý do:</strong> {{ version.correction_reason }}</p>
              <p class="log-date"><va-icon name="schedule" size="small" class="mr-1" />{{ formatDateTime(version.created_at) }}</p>
              
              <div class="hash-block mt-2">
                <div class="hash-line"><span>EVENT:</span> {{ shortHash(version.blockchain_event_id) }}</div>
                <div v-if="version.tx_hash" class="hash-line"><span>TX:</span> {{ shortHash(version.tx_hash) }}</div>
              </div>
            </va-card-content>
          </va-card>
        </div>
      </div>
    </va-modal>

    <!-- Modal: Kết quả Verify (Có gom nhóm theo ngày) -->
    <va-modal v-model="showVerifyModal" hide-default-actions size="large" overlay-opacity="0.5">
      <template #header><h2 class="modal-title">Kết quả đồng bộ Blockchain</h2></template>
      <div v-if="verifyResults">
        <va-alert v-if="verifyError" color="danger" outline class="mb-4">{{ verifyError }}</va-alert>

        <div class="summary-stats mb-4">
          <div class="stat-box"><strong>{{ verifyResults.summary.total }}</strong><span>Tổng cộng</span></div>
          <div class="stat-box ok"><strong>{{ verifyResults.summary.verified }}</strong><span>Khớp dữ liệu</span></div>
          <div class="stat-box err"><strong>{{ verifyResults.summary.desynced }}</strong><span>Bị lệch</span></div>
        </div>

        <div class="history-list">
          <div v-for="group in groupedVerifyDetails" :key="group.date" class="date-group-small mb-4">
            <h4 class="date-header-small">Ngày {{ group.date }}</h4>
            
            <va-card v-for="item in group.items" :key="item.id" outlined class="mb-3"
              :class="item.record?.status === 'PENDING' ? 'border-warning' : (item.status === 'SYNCED' ? 'border-success' : 'border-danger')">
              <va-card-content>
                <div class="v-top">
                  <strong>{{ FARMING_LOG_TYPE_LABELS[item.logType] }}</strong>
                  <va-badge :color="item.record?.status === 'PENDING' ? 'warning' : (item.status === 'SYNCED' ? 'success' : 'danger')">
                    {{ item.record?.status === 'PENDING' ? '⏳ Đang chờ' : (item.status === 'SYNCED' ? '✓ Đồng bộ' : '✗ Lệch dữ liệu') }}
                  </va-badge>
                </div>
                <p class="log-date"><va-icon name="schedule" size="small" class="mr-1" />{{ formatDateTime(item.logDate) }}</p>

                <ul v-if="item.issues.length" class="issues-list" :class="{ 'text-warning': item.record?.status === 'PENDING' }">
                  <li v-for="(issue, i) in item.issues" :key="i"><va-icon name="error_outline" size="small" class="mr-1" />{{ issue }}</li>
                </ul>

                <div v-if="item.record" class="hash-block mt-2">
                  <div class="hash-line"><span>DATA:</span> {{ shortHash(item.record.dataHash) }}</div>
                  <div v-if="item.record.txHash" class="hash-line"><span>TX:</span> {{ shortHash(item.record.txHash) }}</div>
                </div>
              </va-card-content>
            </va-card>
          </div>
        </div>
      </div>
    </va-modal>
  </main>
</template>

<style scoped>
.page-container { width: min(1180px, calc(100% - 2rem)); margin: 0 auto; padding: 1.5rem 0 4rem; font-family: 'Inter', sans-serif; }
.back-btn { margin-bottom: 1rem; margin-left: -0.5rem; }

/* Header */
.page-header { display: flex; justify-content: space-between; align-items: flex-end; gap: 1rem; margin-bottom: 2rem; flex-wrap: wrap; }
.eyebrow { display: flex; align-items: center; margin: 0 0 0.5rem; color: var(--va-primary); font-size: 0.85rem; font-weight: 700; text-transform: uppercase; }
.page-title { margin: 0; font-size: clamp(1.8rem, 4vw, 2.2rem); font-weight: 800; color: #1e293b; }
.header-actions { display: flex; gap: 0.75rem; flex-wrap: wrap; }

/* Empty State */
.empty-state { padding: 5rem 1rem; text-align: center; background: #f8fafc; border: 2px dashed #cbd5e1; border-radius: 20px; display: flex; flex-direction: column; align-items: center; }
.empty-icon-wrapper { width: 80px; height: 80px; background: #e0f2fe; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-bottom: 1.5rem; }
.empty-state h2 { margin: 0 0 0.5rem; font-size: 1.5rem; color: #1e293b; }
.text-secondary { color: #64748b; margin: 0; }

/* Gom Nhóm Ngày */
.date-group { margin-bottom: 2.5rem; }
.date-header { 
  display: flex; 
  align-items: center; 
  font-size: 1.15rem; 
  font-weight: 700; 
  color: #1e293b; 
  margin-bottom: 1.2rem; 
  padding-bottom: 0.5rem; 
  border-bottom: 2px solid #e2e8f0; 
}
.date-group-small { margin-bottom: 1.5rem; }
.date-header-small {
  font-size: 0.95rem; 
  font-weight: 700; 
  color: #475569; 
  margin: 0 0 0.75rem 0; 
  text-transform: uppercase; 
  letter-spacing: 0.05em;
  border-left: 3px solid #cbd5e1;
  padding-left: 0.5rem;
}

/* Grid & Cards */
.log-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 1.5rem; }
.log-card { border-radius: 16px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05) !important; display: flex; flex-direction: column; }
.card-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem; }
.log-type-title { font-size: 1.15rem; color: #0f172a; }
.log-date { display: flex; align-items: center; color: #64748b; font-size: 0.85rem; margin: 0 0 1rem; }

/* Detail Rows */
.log-details { border-top: 1px solid #f1f5f9; padding-top: 0.75rem; margin-bottom: 1rem; }
.detail-row { display: flex; justify-content: space-between; padding: 0.35rem 0; font-size: 0.9rem; }
.detail-label { color: #64748b; }
.detail-value { font-weight: 600; color: #1e293b; text-align: right; }

/* Hash & Code blocks */
.hash-block { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.5rem 0.75rem; font-family: ui-monospace, monospace; font-size: 0.75rem; color: #475569; word-break: break-all; }
.hash-line span { font-weight: 700; color: #94a3b8; margin-right: 0.25rem; }

/* Actions */
.card-actions { display: flex; align-items: center; gap: 0.5rem; padding: 1rem 1.25rem; background: #f8fafc; border-top: 1px solid #f1f5f9; border-radius: 0 0 16px 16px; margin-top: auto; }
.grow { flex-grow: 1; }

/* Modals & Forms */
.modal-title { font-size: 1.4rem; font-weight: 700; color: #0f172a; margin-bottom: 1rem; }
.modern-form { display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; width: 100%; min-width: 500px; }
.col-span-1 { grid-column: span 1; }
.col-span-2 { grid-column: 1 / -1; }
.form-actions { display: flex; justify-content: flex-end; gap: 1rem; padding-top: 1rem; border-top: 1px solid #f1f5f9; }

/* History & Verify UI */
.history-list { max-height: 60vh; overflow-y: auto; padding-right: 0.5rem; }
.v-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
.correction-reason { font-size: 0.9rem; color: #334155; margin-bottom: 0.5rem; background: #f1f5f9; padding: 0.5rem; border-radius: 6px; }

.summary-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; }
.stat-box { text-align: center; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1rem; }
.stat-box strong { display: block; font-size: 1.5rem; margin-bottom: 0.25rem; color: #1e293b; }
.stat-box span { font-size: 0.8rem; color: #64748b; text-transform: uppercase; font-weight: 600; }
.stat-box.ok strong { color: var(--va-success); }
.stat-box.err strong { color: var(--va-danger); }

.issues-list { list-style: none; padding: 0; margin: 0.5rem 0; color: var(--va-danger); font-size: 0.85rem; }
.issues-list li { display: flex; align-items: flex-start; margin-bottom: 0.25rem; }
.text-warning { color: var(--va-warning) !important; }

.border-success { border-color: var(--va-success) !important; }
.border-danger { border-color: var(--va-danger) !important; }
.border-warning { border-color: var(--va-warning) !important; }

/* Utilities */
.mr-1 { margin-right: 0.35rem; }
.mr-2 { margin-right: 0.75rem; }
.mb-3 { margin-bottom: 0.75rem; }
.mb-4 { margin-bottom: 1rem; }
.mt-2 { margin-top: 0.5rem; }
.mt-4 { margin-top: 1rem; }

/* Responsive */
@media (max-width: 768px) {
  .log-grid { grid-template-columns: 1fr; }
  .modern-form { grid-template-columns: 1fr; min-width: 100%; }
  .col-span-1 { grid-column: 1 / -1; }
  .summary-stats { grid-template-columns: 1fr; }
}
</style>