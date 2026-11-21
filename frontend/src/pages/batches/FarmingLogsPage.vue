<script setup lang="ts">
import { draftDismiss, dismissOnBackdrop } from '../../components/overlay-dismiss'
import { detailsRows } from './farming-log-details'
import LoadingState from '../../components/LoadingState.vue'
import DecimalField from '../../components/DecimalField.vue'
import PageHeader from '../../components/PageHeader.vue'
import EmptyState from '../../components/EmptyState.vue'
import { computed, reactive, ref, watch, onUnmounted, nextTick } from 'vue'
import CollectionToolbar from '../../components/CollectionToolbar.vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import {
  VaButton, VaModal, VaInput, VaSelect,
  VaAlert, VaCard, VaCardContent, VaBadge, VaIcon, VaTextarea
} from 'vuestic-ui'
import { useAuthStore } from '../../stores/auth.store'
import { usePondsStore } from '../../stores/ponds.store'
import { usePondBatchesStore } from '../../stores/pond-batches.store'
import { useFarmingLogsStore } from '../../stores/farming-logs.store'
import { api, ApiError } from '../../api/client'
import { FARMING_LOG_TYPE_LABELS, SPECIES_LABELS, type BatchItem, type FarmResponse, type FarmingLog, type FarmingLogHistoryResponse, type FarmingLogInput, type FarmingLogType, type FarmingLogVerifyResponse } from '../../types'

const auth = useAuthStore()
const farmer = computed(() => auth.user?.role === 'FARMER')
const router = useRouter()
const route = useRoute(); const logStore = useFarmingLogsStore(); const pondsStore = usePondsStore(); const batchesStore = usePondBatchesStore()
const { items, loading, saving, verifying } = storeToRefs(logStore)
const farmId = computed(() => String(route.params.farmId)); const pondId = computed(() => String(route.params.pondId)); const batchId = computed(() => String(route.params.batchId))
const farmName = ref(''); const pondName = ref(''); const batchInfo = ref<BatchItem | null>(null); const error = ref('')
let contextVersion = 0; let historyVersion = 0; let verifyVersion = 0
const showForm = ref(false); const formError = ref(''); const success = ref('')
const imageUploading = ref(false); const imageError = ref('')
const editingId = ref<string | null>(null)
const editingMode = ref<'DRAFT' | 'CORRECTION'>('DRAFT'); const historyResult = ref<FarmingLogHistoryResponse | null>(null)
const verifyResults = ref<FarmingLogVerifyResponse | null>(null); const verifyError = ref(''); const verifiedStatus = ref<Record<string, 'SYNCED' | 'DESYNCED' | 'PENDING' | 'DRAFT'>>({})

const showHistoryModal = computed({ get: () => !!historyResult.value, set: (val) => { if (!val) historyResult.value = null } })
const showVerifyModal = computed({ get: () => !!verifyResults.value, set: (val) => { if (!val) verifyResults.value = null } })

const logTypes = Object.entries(FARMING_LOG_TYPE_LABELS).map(([value, label]) => ({ value: value as FarmingLogType, label }))
const form = reactive({ logType: 'FEEDING' as FarmingLogType, logDate: '', feedType: '', feedAmount: '' as string | number, temperature: '' as string | number, salinity: '' as string | number, ph: '' as string | number, dissolvedOxygen: '' as string | number, medicineName: '', dose: '', mortalityCount: '' as string | number, cause: '', description: '', imageUrl: '', correctionReason: '' })
const numeric = (value: string | number) => value === '' ? null : Number(value)

const query = ref(''); const filterStatus = ref(''); const listPage = ref(1); const listPageSize = 12
const filterType = ref('')
const fromDate = ref('')
const toDate = ref('')
const logDay = new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' })
const filterOptions = [{ value: 'DRAFT', label: 'Bản nháp' }, { value: 'CONFIRMED', label: 'Đã chứng thực' }, { value: 'REVOKED', label: 'Đã thu hồi' }]
const filteredLogs = computed(() => items.value.filter((log) => {
  if (filterType.value && log.log_type !== filterType.value) return false
  if (filterStatus.value && log.lifecycle_status !== filterStatus.value) return false
  if (fromDate.value || toDate.value) {
    const date = logDay.format(new Date(log.log_date))
    if ((fromDate.value && date < fromDate.value) || (toDate.value && date > toDate.value)) return false
  }
  const text = `${FARMING_LOG_TYPE_LABELS[log.log_type]} ${Object.values(log.details ?? {}).join(' ')}`
  return text.toLocaleLowerCase('vi').includes(query.value.trim().toLocaleLowerCase('vi'))
}))
watch([query, filterStatus, filterType, fromDate, toDate], () => { listPage.value = 1 })
watch(() => filteredLogs.value.length, (length) => { listPage.value = Math.min(listPage.value, Math.max(1, Math.ceil(length / listPageSize))) })
// shortcut: the batch endpoint returns the complete collection, switch to server pagination when the API supports it.
const visibleLogs = computed(() => [...filteredLogs.value]
  .sort((a, b) => Date.parse(b.log_date) - Date.parse(a.log_date))
  .slice((listPage.value - 1) * listPageSize, listPage.value * listPageSize))
const detailDialog = ref<HTMLDialogElement | null>(null)
const selectedId = ref('')
const selectedLog = computed(() => items.value.find((log) => log.id === selectedId.value))
async function openDetail(log: FarmingLog) {
  selectedId.value = log.id
  await nextTick()
  if (selectedId.value === log.id && !detailDialog.value?.open) detailDialog.value?.showModal()
}
function closeDetail() {
  detailDialog.value?.close()
  selectedId.value = ''
}
function runAction(event: Event, action?: () => void) {
  const menu = (event.currentTarget as HTMLElement).closest('details')
  if (menu) {
    menu.open = false
    menu.querySelector('summary')?.focus()
  }
  action?.()
}
function actOnDetail(action: (log: FarmingLog) => void) {
  const log = selectedLog.value
  closeDetail()
  if (log) action(log)
}
function logSummary(log: FarmingLog) {
  return detailsRows(log).map((row) => row.value).join(' · ')
}

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

function reset() { Object.assign(form, { logType: 'FEEDING', logDate: '', feedType: '', feedAmount: '', temperature: '', salinity: '', ph: '', dissolvedOxygen: '', medicineName: '', dose: '', mortalityCount: '', cause: '', description: '', imageUrl: '', correctionReason: '' }); formError.value = ''; imageError.value = ''; imageUploading.value = false }

async function uploadImage(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  imageError.value = ''
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    imageError.value = 'Chỉ hỗ trợ ảnh JPG, PNG hoặc WebP'
    return
  }
  if (file.size > 10 * 1024 * 1024) {
    imageError.value = 'Ảnh không được lớn hơn 10 MB'
    return
  }

  const context = contextVersion
  const payload = new FormData()
  payload.append('image', file)
  imageUploading.value = true
  try {
    const result = await api.upload<{ success: boolean; imageUrl: string }>(`/farming-logs/batch/${batchId.value}/images`, payload)
    if (context === contextVersion) form.imageUrl = result.imageUrl
  } catch (error) {
    if (context === contextVersion) imageError.value = error instanceof ApiError ? error.message : 'Không thể tải ảnh lên. Vui lòng thử lại.'
  } finally {
    if (context === contextVersion) imageUploading.value = false
  }
}

function openCreate() { if (saving.value || loading.value || !batchInfo.value) return; editingId.value = null; reset(); showForm.value = true }
function openEdit(log: FarmingLog) {
  if (saving.value || loading.value) return
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
const formDismiss = draftDismiss(() => form, () => saving.value || imageUploading.value, showForm).dismiss
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
  if (saving.value || loading.value || imageUploading.value) return
  const version = contextVersion
  formError.value = ''; success.value = ''
  if (!form.logDate) { formError.value = 'Vui lòng chọn thời gian ghi nhật ký'; return }
  const required = validate()
  if (required) { formError.value = required; return }
  if (editingId.value && editingMode.value === 'CORRECTION' && form.correctionReason.trim().length < 3) { formError.value = 'Vui lòng nhập lý do đính chính (tối thiểu 3 ký tự)'; return }

  const parsedDate = new Date(form.logDate)
  if (Number.isNaN(parsedDate.getTime())) { formError.value = 'Thời gian nhật ký không hợp lệ'; return }
  const isoLogDate = parsedDate.toISOString()

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
      if (version !== contextVersion) return
      verifiedStatus.value = {}
      success.value = editingMode.value === 'CORRECTION' ? 'Đã đính chính và chứng thực phiên bản mới' : 'Đã lưu thay đổi bản nháp'
    } else {
      await logStore.create(input)
      if (version !== contextVersion) return
      success.value = 'Đã lưu bản nháp'
    }
    close()
  } catch { if (version === contextVersion) formError.value = logStore.error }
}

async function confirmLog(log: FarmingLog) {
  if (saving.value || loading.value) return
  const version = contextVersion
  try { await logStore.confirm(log.id); if (version === contextVersion) success.value = 'Đã xác nhận và chứng thực Blockchain' }
  catch { if (version === contextVersion) error.value = logStore.error }
}
const showRevoke = ref(false)
const revokeTarget = ref('')
const revokeReason = ref('')
function openRevoke(log: FarmingLog) {
  revokeTarget.value = log.id
  revokeReason.value = ''
  showRevoke.value = true
}
async function revokeLog() {
  const reason = revokeReason.value.trim()
  if (saving.value || loading.value || !reason) return
  const version = contextVersion
  try {
    await logStore.revoke(revokeTarget.value, reason)
    if (version !== contextVersion) return
    verifiedStatus.value = {}
    showRevoke.value = false
    success.value = 'Đã thu hồi nhật ký'
  } catch {
    if (version === contextVersion) {
      showRevoke.value = false
      error.value = logStore.error
    }
  }
}
async function showHistory(log: FarmingLog) {
  const context = contextVersion; const version = ++historyVersion
  try { const result = await logStore.history(log.id); if (context === contextVersion && version === historyVersion) historyResult.value = result }
  catch { if (context === contextVersion && version === historyVersion) error.value = logStore.error }
}
async function checkSync() {
  if (loading.value || !batchInfo.value) return
  const context = contextVersion; const version = ++verifyVersion
  verifyError.value = ''; verifyResults.value = null
  try {
    const result = await logStore.verify(batchId.value)
    if (context !== contextVersion || version !== verifyVersion) return
    verifyResults.value = result
    const map: Record<string, 'SYNCED' | 'DESYNCED' | 'PENDING' | 'DRAFT'> = {}
    for (const item of result.details) map[item.id] = getVerifyStatus(item)
    verifiedStatus.value = map
  } catch { if (context === contextVersion && version === verifyVersion) verifyError.value = logStore.error }
}
async function loadContext() {
  const version = ++contextVersion; ++historyVersion; ++verifyVersion
  const farm = farmId.value; const pond = pondId.value; const batch = batchId.value
  showForm.value = false; editingId.value = null; editingMode.value = 'DRAFT'; reset()
  closeDetail()
  showRevoke.value = false
  query.value = ''; filterStatus.value = ''; filterType.value = ''; fromDate.value = ''; toDate.value = ''; listPage.value = 1
  farmName.value = ''; pondName.value = ''; batchInfo.value = null; historyResult.value = null; verifyResults.value = null; verifiedStatus.value = {}; verifyError.value = ''; error.value = ''; success.value = ''
  // Hide and invalidate old logs while validating the complete parent chain.
  logStore.requestVersion++; logStore.items = []; logStore.scope = ''; logStore.loading = true
  try {
    await pondsStore.load(farm)
    if (version !== contextVersion) return
    const selectedPond = pondsStore.items.find((item) => item.id === pond)
    if (pondsStore.error || !selectedPond) throw new Error(pondsStore.error || 'Ao nuôi không thuộc cơ sở trong đường dẫn')
    pondName.value = selectedPond.pond_name
    await batchesStore.load(farm, pond)
    if (version !== contextVersion) return
    const selectedBatch = batchesStore.items.find((item) => item.id === batch)
    if (batchesStore.error || !selectedBatch) throw new Error(batchesStore.error || 'Vụ nuôi không thuộc ao trong đường dẫn')
    batchInfo.value = selectedBatch
    const [farmResult] = await Promise.allSettled([
      api.get<FarmResponse>(`/farms/${farm}`),
      logStore.load(batch),
    ])
    if (version === contextVersion && farmResult.status === 'fulfilled') farmName.value = farmResult.value.farm.farm_name
    if (version === contextVersion) error.value = logStore.error
  } catch (cause) {
    if (version === contextVersion) {
      logStore.items = []; logStore.scope = ''
      error.value = cause instanceof Error ? cause.message : 'Không tải được thông tin vụ nuôi'
    }
  } finally { if (version === contextVersion) logStore.loading = false }

}
watch(() => `${farmId.value}/${pondId.value}/${batchId.value}`, loadContext, { immediate: true })
watch([() => route.query.create, batchInfo, loading, farmer], ([create, batch, pending, isFarmer]) => {
  if (create !== 'log' || !batch || pending || !isFarmer || error.value) return
  openCreate()
  const { create: requested, ...query } = route.query
  if (requested) void router.replace({ query })
})

// Helpers màu sắc
const lifecycleColors: Record<string, string> = { DRAFT: 'secondary', CONFIRMED: 'success', REVOKED: 'danger' }
const lifecycleLabels: Record<string, string> = { DRAFT: 'Bản nháp', CONFIRMED: 'Đã chứng thực', REVOKED: 'Đã thu hồi' }
const verifyColors: Record<string, string> = { SYNCED: 'success', DESYNCED: 'danger', PENDING: 'warning', DRAFT: 'secondary' }
const verifyLabels: Record<string, string> = { SYNCED: 'Đúng', DESYNCED: 'Dữ liệu không khớp', PENDING: 'Đang chờ xác nhận', DRAFT: 'Chưa chứng thực' }

// Fix lỗi số 1 và số 2 (Undefined Index Type)
function getVerifyStatus(item: FarmingLogVerifyResponse['details'][number]) { return item.status === 'DRAFT' ? 'DRAFT' : item.record?.status === 'PENDING' ? 'PENDING' : item.status }
function getVerifyColor(status?: string) { return status ? verifyColors[status] : 'secondary'; }
function getVerifyLabel(status?: string) { return status ? verifyLabels[status] : ''; }
onUnmounted(() => { ++contextVersion; ++historyVersion; ++verifyVersion })
</script>

<template>
  <main class="page-container" :class="{ 'farmer-logs': farmer }" :aria-busy="loading">

    <nav v-if="batchInfo" class="log-breadcrumb" aria-label="Đường dẫn nhật ký">
      <RouterLink :to="{ name: 'farms' }">{{ farmName || 'Cơ sở nuôi' }}</RouterLink>
      <span aria-hidden="true">/</span>
      <RouterLink :to="{ name: 'ponds', params: { farmId } }">{{ pondName }}</RouterLink>
      <span aria-hidden="true">/</span>
      <RouterLink :to="{ name: 'pond-batches', params: { farmId, pondId } }">{{ batchInfo.batch_code }}</RouterLink>
      <span aria-hidden="true">/</span><span aria-current="page">Nhật ký nuôi</span>
    </nav>
    <PageHeader :context="batchInfo ? SPECIES_LABELS[batchInfo.species] : undefined" title="Nhật ký nuôi" description="Theo dõi và ghi nhận các hoạt động trong quá trình nuôi trồng.">
      <template #actions>
        <va-button preset="secondary" icon="sync" :loading="verifying" :disabled="loading || !batchInfo" @click="checkSync">Kiểm tra Blockchain</va-button>
        <va-button icon="add" :disabled="loading || saving || !batchInfo" @click="openCreate">Ghi nhật ký</va-button>
      </template>
    </PageHeader>

    <va-alert v-if="success" color="success" class="mb-4" icon="check_circle" outline closeable role="status">{{ success }}</va-alert>
    <va-alert v-if="error" color="danger" class="mb-4" icon="warning" outline closeable role="alert">{{ error }} <va-button size="small" preset="secondary" @click="loadContext">Thử lại</va-button></va-alert>

    <CollectionToolbar v-model:query="query" v-model:status="filterStatus" v-model:page="listPage"
      :statuses="filterOptions" search-placeholder="Loại nhật ký hoặc nội dung…" :total="filteredLogs.length"
      :page-size="listPageSize" :loading="loading" label="nhật ký"
      :extra-filters-active="Boolean(filterType || fromDate || toDate)"
      @clear="filterType = ''; fromDate = ''; toDate = ''">
      <template #filters>
        <label class="log-filter">Loại hoạt động
          <select v-model="filterType">
            <option value="">Tất cả hoạt động</option>
            <option v-for="type in logTypes" :key="type.value" :value="type.value">{{ type.label }}</option>
          </select>
        </label>
        <fieldset class="log-range">
          <legend>Khoảng ngày ghi nhận</legend>
          <div>
            <input v-model="fromDate" aria-label="Từ ngày" type="date" :max="toDate || undefined" />
            <span aria-hidden="true">–</span>
            <input v-model="toDate" aria-label="Đến ngày" type="date" :min="fromDate || undefined" />
          </div>
        </fieldset>
      </template>
    </CollectionToolbar>

    <LoadingState v-if="loading" />
    <EmptyState v-else-if="!error && !items.length" title="Chưa có nhật ký nuôi" description="Hãy ghi lại hoạt động đầu tiên cho vụ nuôi này." icon="edit_document">
      <va-button icon="add" @click="openCreate">Ghi nhật ký</va-button>
    </EmptyState>
    <EmptyState v-else-if="!error && !filteredLogs.length" title="Không có nhật ký phù hợp" description="Thử đổi từ khóa hoặc bộ lọc." />

    <div v-else-if="visibleLogs.length" class="log-table-frame">
      <table class="log-table" aria-label="Danh sách nhật ký nuôi" role="table">
        <thead>
          <tr><th scope="col">Ngày ghi nhận</th><th scope="col">Loại nhật ký</th><th scope="col">Nội dung</th><th scope="col">Hình ảnh</th><th scope="col">Trạng thái</th><th scope="col">Thao tác</th></tr>
        </thead>
        <tbody role="rowgroup">
          <tr v-for="log in visibleLogs" :key="log.id" role="row">
            <td class="record-time" role="cell"><time :datetime="log.log_date">{{ formatDateTime(log.log_date) }}</time></td>
            <td class="record-type" role="cell"><strong>{{ FARMING_LOG_TYPE_LABELS[log.log_type] }}</strong></td>
            <td class="record-content" role="cell"><span :title="logSummary(log)">{{ logSummary(log) || '—' }}</span></td>
            <td class="record-image" role="cell"><span v-if="log.image_url"><va-icon name="image" size="small" aria-hidden="true" /> 1 ảnh</span><span v-else aria-label="Không có ảnh">—</span></td>
            <td class="record-status" role="cell"><va-badge :color="lifecycleColors[log.lifecycle_status]" :text="lifecycleLabels[log.lifecycle_status]" /></td>
            <td class="record-actions" role="cell">
              <div class="log-actions">
                <va-button size="small" preset="secondary" @click="openDetail(log)">Xem</va-button>
                <details v-if="log.lifecycle_status !== 'REVOKED' || log.current_version_id"
                  class="log-actions-menu" name="log-actions" @keydown.esc.stop="runAction($event)">
                  <summary aria-label="Thao tác nhật ký" title="Thao tác nhật ký"><va-icon name="more_horiz" aria-hidden="true" /></summary>
                  <div class="log-menu-panel">
                    <template v-if="log.lifecycle_status === 'DRAFT'">
                      <button type="button" :disabled="saving" @click="runAction($event, () => openEdit(log))">Chỉnh sửa</button>
                      <button type="button" :disabled="saving" @click="runAction($event, () => confirmLog(log))">Xác nhận</button>
                    </template>
                    <template v-if="log.lifecycle_status === 'CONFIRMED'">
                      <button type="button" :disabled="saving" @click="runAction($event, () => openEdit(log))">Đính chính</button>
                      <button type="button" class="danger-action" :disabled="saving" @click="runAction($event, () => openRevoke(log))">Thu hồi</button>
                    </template>
                    <button v-if="log.current_version_id" type="button" @click="runAction($event, () => showHistory(log))">Lịch sử</button>
                  </div>
                </details>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <dialog ref="detailDialog" class="log-drawer" aria-labelledby="log-detail-title" @cancel.prevent="closeDetail" @click="dismissOnBackdrop($event, closeDetail)">
      <template v-if="selectedLog">
        <header class="log-drawer-header">
          <div>
            <p>{{ formatDateTime(selectedLog.log_date) }}</p>
            <h2 id="log-detail-title">{{ FARMING_LOG_TYPE_LABELS[selectedLog.log_type] }}</h2>
            <va-badge :color="lifecycleColors[selectedLog.lifecycle_status]" :text="lifecycleLabels[selectedLog.lifecycle_status]" />
          </div>
          <va-button preset="secondary" icon="close" @click="closeDetail">Đóng</va-button>
        </header>
        <div class="log-drawer-body">
          <section>
            <h3>Thông tin ghi nhận</h3>
            <dl class="drawer-facts">
              <div><dt>Cơ sở nuôi</dt><dd>{{ farmName || '—' }}</dd></div>
              <div><dt>Ao nuôi</dt><dd>{{ pondName }}</dd></div>
              <div><dt>Ngày ghi nhận</dt><dd>{{ formatDateTime(selectedLog.log_date) }}</dd></div>
            </dl>
          </section>
          <section>
            <h3>Nội dung nhật ký</h3>
            <dl class="drawer-facts">
              <div v-for="row in detailsRows(selectedLog)" :key="row.label"><dt>{{ row.label }}</dt><dd>{{ row.value }}</dd></div>
            </dl>
          </section>
          <section v-if="selectedLog.image_url">
            <h3>Hình ảnh</h3>
            <a class="log-image-link" :href="selectedLog.image_url" target="_blank" rel="noopener noreferrer">
              <img class="log-image" :src="selectedLog.image_url" alt="Ảnh minh họa nhật ký nuôi" />
              <span>Mở ảnh kích thước đầy đủ</span>
            </a>
          </section>
          <section>
            <h3>Đối soát Blockchain</h3>
            <va-badge
              :color="getVerifyColor(verifiedStatus[selectedLog.id])"
              :text="getVerifyLabel(verifiedStatus[selectedLog.id]) || 'Chưa đối soát'"
            />
          </section>
        </div>
        <footer class="log-drawer-actions">
          <va-button v-if="selectedLog.lifecycle_status !== 'REVOKED'" :disabled="saving" @click="actOnDetail(openEdit)">{{ selectedLog.lifecycle_status === 'DRAFT' ? 'Chỉnh sửa' : 'Đính chính' }}</va-button>
          <va-button v-if="selectedLog.lifecycle_status === 'DRAFT'" preset="secondary" color="success" :disabled="saving" @click="actOnDetail(confirmLog)">Xác nhận</va-button>
          <va-button v-if="selectedLog.current_version_id" preset="secondary" icon="history" @click="actOnDetail(showHistory)">Lịch sử</va-button>
          <va-button v-if="selectedLog.lifecycle_status === 'CONFIRMED'" preset="secondary" color="danger" :disabled="saving" @click="actOnDetail(openRevoke)">Thu hồi</va-button>
        </footer>
      </template>
    </dialog>

    <va-modal v-model="showRevoke" title="revoke-log-title" no-outside-dismiss no-esc-dismiss size="small" overlay-opacity="0.5" hide-default-actions :no-dismiss="saving">
      <template #header><h2 id="revoke-log-title">Thu hồi nhật ký</h2></template>
      <form class="modern-form" @submit.prevent="revokeLog">
        <p class="col-span-2">Nhập lý do để xác nhận thu hồi nhật ký này.</p>
        <va-textarea v-model="revokeReason" label="Lý do thu hồi" class="col-span-2" required />
        <div class="form-actions">
          <va-button type="button" preset="secondary" :disabled="saving" @click="showRevoke = false">Hủy</va-button>
          <va-button type="submit" color="danger" :loading="saving" :disabled="!revokeReason.trim()">Thu hồi nhật ký</va-button>
        </div>
      </form>
    </va-modal>

    <!-- Modal: Ghi Nhật Ký -->
    <va-modal title="log-form-title" :model-value="showForm" @update:model-value="(open: boolean) => { if (!open) close() }" :mobile-fullscreen="false" :before-close="formDismiss" close-button aria-close-label="Đóng biểu mẫu" :no-dismiss="saving || imageUploading" hide-default-actions overlay-opacity="0.5">
      <template #header>
        <h2 id="log-form-title" class="modal-title">{{ editingId ? (editingMode === 'CORRECTION' ? 'Đính chính nhật ký' : 'Chỉnh sửa bản nháp') : 'Ghi nhật ký nuôi' }}</h2>
      </template>

      <form @submit.prevent="submit" class="modern-form">
        <h3 class="form-section-heading">Thông tin chung</h3>
        <p v-if="batchInfo" class="form-context col-span-2">{{ [farmName, pondName, batchInfo.batch_code].filter(Boolean).join(' / ') }}</p>
        <va-select v-model="form.logType" :options="logTypes" value-by="value" text-by="label" label="Loại nhật ký *" class="col-span-1" />
        
        <va-input v-model="form.logDate" type="datetime-local" label="Thời gian ghi (Ngày & Giờ) *" :max="toDatetimeLocal(new Date())" class="col-span-1" />

        <h3 class="form-section-heading">Nội dung nhật ký</h3>
        <template v-if="form.logType === 'FEEDING'">
          <va-input v-model="form.feedType" label="Loại thức ăn *" placeholder="VD: Thức ăn viên 40%" class="col-span-1" />
          <DecimalField v-model="form.feedAmount" label="Số lượng (kg)" class="col-span-1 feeding-amount" />
        </template>
        <template v-else-if="form.logType === 'WATER_QUALITY'">
          <DecimalField v-model="form.temperature" label="Nhiệt độ (°C)" class="col-span-1" />
          <DecimalField v-model="form.salinity" label="Độ mặn (‰)" class="col-span-1" />
          <DecimalField v-model="form.ph" label="pH" class="col-span-1" />
          <DecimalField v-model="form.dissolvedOxygen" label="Oxy hòa tan (mg/L)" class="col-span-1" />
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

        <h3 class="form-section-heading">Hình ảnh và thông tin bổ sung</h3>
        <div class="image-upload-field col-span-2">
          <label for="farming-log-image">Hình ảnh (tải từ máy)</label>
          <input id="farming-log-image" type="file" accept="image/jpeg,image/png,image/webp" :disabled="imageUploading || saving" @change="uploadImage" />
          <p class="image-upload-hint">JPG, PNG hoặc WebP; tối đa 10 MB.</p>
          <p v-if="imageUploading" class="image-upload-hint" role="status">Đang tải ảnh lên…</p>
          <va-alert v-if="imageError" color="danger" outline size="small" role="alert">{{ imageError }}</va-alert>
          <div v-if="form.imageUrl" class="image-preview-wrap">
            <img class="image-preview" :src="form.imageUrl" alt="Ảnh đã tải lên cho nhật ký" />
            <va-button preset="secondary" size="small" type="button" :disabled="imageUploading || saving" @click="form.imageUrl = ''; imageError = ''">Gỡ ảnh</va-button>
          </div>
        </div>
        <va-textarea v-if="editingId && editingMode === 'CORRECTION'" v-model="form.correctionReason" label="Lý do đính chính *" placeholder="Ví dụ: Nhập nhầm số lượng thức ăn" class="col-span-2" required />

        <va-alert v-if="formError" color="danger" outline size="small" class="col-span-2 mt-2" role="alert">{{ formError }}</va-alert>

        <div class="form-actions col-span-2">
          <va-button preset="secondary" type="button" color="secondary" :disabled="saving || imageUploading" @click="formDismiss(close)">Hủy</va-button>
          <va-button type="submit" :loading="saving" :disabled="imageUploading" color="primary">{{ editingId ? 'Lưu thay đổi' : 'Lưu bản nháp' }}</va-button>
        </div>
      </form>
    </va-modal>

    <!-- Modal: Lịch sử phiên bản (Có gom nhóm theo ngày) -->
    <va-modal title="log-history-title" :mobile-fullscreen="false" v-model="showHistoryModal" close-button aria-close-label="Đóng lịch sử" hide-default-actions size="large" overlay-opacity="0.5">
      <template #header><h2 id="log-history-title" class="modal-title">Lịch sử phiên bản</h2></template>
      <div v-if="historyResult" class="history-list">
        <div v-for="group in groupedHistoryItems" :key="group.date" class="date-group-small mb-4">
          <h4 class="date-header-small">Ngày {{ group.date }}</h4>
          
          <va-card v-for="version in group.items" :key="version.id" outlined class="mb-3">
            <va-card-content>
              <div class="v-top">
                <strong>Phiên bản {{ version.version_number }}</strong>
                
                <!-- Fix lỗi số 3 (Đổi 'VALID' thành 'ACTIVE') -->
                <va-badge :color="version.status === 'ACTIVE' ? 'success' : 'secondary'" :text="version.status" />
              </div>
              <p v-if="version.correction_reason" class="correction-reason"><strong>Lý do:</strong> {{ version.correction_reason }}</p>
              <p class="log-date"><va-icon name="schedule" size="small" class="mr-1" />{{ formatDateTime(version.created_at) }}</p>
              
            </va-card-content>
          </va-card>
        </div>
      </div>
    </va-modal>

    <!-- Modal: Kết quả Verify (Có gom nhóm theo ngày) -->
    <va-modal title="log-verification-title" :mobile-fullscreen="false" v-model="showVerifyModal" close-button aria-close-label="Đóng kết quả đối soát" hide-default-actions size="large" overlay-opacity="0.5">
      <template #header><h2 id="log-verification-title" class="modal-title">Kết quả đồng bộ Blockchain</h2></template>
      <div v-if="verifyResults">
        <va-alert v-if="verifyError" color="danger" outline class="mb-4" role="alert">{{ verifyError }}</va-alert>

        <div class="summary-stats mb-4">
          <div class="stat-box"><strong>{{ verifyResults.summary.total }}</strong><span>Tổng cộng</span></div>
          <div class="stat-box ok"><strong>{{ verifyResults.summary.verified }}</strong><span>Khớp dữ liệu</span></div>
          <div class="stat-box err"><strong>{{ verifyResults.summary.desynced }}</strong><span>Dữ liệu không khớp</span></div>
          <div class="stat-box"><strong>{{ verifyResults.summary.drafts }}</strong><span>Chưa chứng thực</span></div>
        </div>

        <div class="history-list">
          <div v-for="group in groupedVerifyDetails" :key="group.date" class="date-group-small mb-4">
            <h4 class="date-header-small">Ngày {{ group.date }}</h4>
            
            <va-card v-for="item in group.items" :key="item.id" outlined class="mb-3"
              :class="{ 'border-warning': getVerifyStatus(item) === 'PENDING', 'border-success': item.status === 'SYNCED', 'border-danger': getVerifyStatus(item) === 'DESYNCED' }">
              <va-card-content>
                <div class="v-top">
                  <strong>{{ FARMING_LOG_TYPE_LABELS[item.logType] }}</strong>
                  <va-badge :color="getVerifyColor(getVerifyStatus(item))" :text="getVerifyLabel(getVerifyStatus(item))" />
                </div>
                <p class="log-date"><va-icon name="schedule" size="small" class="mr-1" />{{ formatDateTime(item.logDate) }}</p>


              </va-card-content>
            </va-card>
          </div>
        </div>
      </div>
    </va-modal>
  </main>
</template>

<style scoped>
.feeding-amount { gap: 0; }
.feeding-amount :deep(span) {
  font-size: 12px;
  line-height: 19px;
}
.feeding-amount :deep(input) { border-color: var(--app-control-line); }
.feeding-amount :deep(input:focus) { border-color: var(--va-primary); }
.log-breadcrumb { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; color: var(--app-muted); font-size: .85rem; }
.log-breadcrumb a { color: var(--app-primary-dark); text-decoration: underline; text-underline-offset: 3px; }
.log-filter, .log-range { display: grid; gap: 8px; min-width: 0; font-size: 12px; font-weight: 500; }
.log-filter { flex: 1; min-width: 150px; }
.log-range { border: 0; padding: 0; margin: 0; }
.log-range legend { padding: 0; margin-bottom: 8px; }
.log-range > div { display: flex; align-items: center; gap: 6px; }
.log-filter select, .log-range input { box-sizing: border-box; min-width: 0; min-height: 44px; padding: 6px 10px; border: 1px solid var(--app-control-line); border-radius: var(--app-control-radius); background: var(--app-surface); color: var(--app-ink); font: inherit; font-size: 14px; }

.log-table-frame { container-type: inline-size; }
.log-table { width: 100%; border-spacing: 0; border: 1px solid var(--app-line); border-radius: var(--app-radius); background: var(--app-surface); font-size: .875rem; }
.log-table th, .log-table td { padding: 10px 14px; text-align: start; }
.log-table th { color: var(--app-muted); font-size: .8rem; font-weight: 650; }
.log-table td { border-top: 1px solid var(--app-line); height: 64px; box-sizing: border-box; }
.log-table tbody tr:hover, .log-table tbody tr:focus-within { background: var(--app-primary-soft); }
.record-time, .record-image, .record-status { white-space: nowrap; }
.record-time, .record-image { color: var(--app-muted); }
.record-content { width: 36%; overflow-wrap: anywhere; }
.record-content span { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.log-actions { display: flex; align-items: center; gap: 6px; }
.log-actions-menu { position: relative; }
.log-actions-menu summary { display: grid; place-items: center; width: 36px; height: 36px; cursor: pointer; border: 1px solid var(--app-line); border-radius: var(--app-control-radius); }
.log-actions-menu summary::-webkit-details-marker { display: none; }
.log-menu-panel { position: absolute; inset: calc(100% + 4px) 0 auto auto; z-index: 4; min-width: 142px; padding: 4px; background: var(--app-surface); border: 1px solid var(--app-line); border-radius: var(--app-control-radius); box-shadow: 0 6px 18px rgb(0 0 0 / 12%); }
.log-menu-panel button { display: block; width: 100%; min-height: 44px; padding: 4px 10px; text-align: start; font: inherit; color: var(--app-ink); border: 0; background: transparent; cursor: pointer; }
.log-menu-panel button:hover, .log-actions-menu summary:hover { background: var(--app-primary-soft); }
.log-menu-panel button:disabled { opacity: .55; cursor: default; }
.log-menu-panel .danger-action { color: var(--va-danger); }

.log-drawer { position: fixed; inset: 0 0 0 auto; margin: 0; padding: 0; width: min(100%, 640px); max-width: none; height: 100dvh; max-height: none; border: 0; background: var(--app-canvas); color: var(--app-ink); }
.log-drawer[open] { display: flex; flex-direction: column; }
.log-drawer::backdrop { background: rgb(7 28 36 / 45%); }
.log-drawer-header, .log-drawer-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 14px 20px; background: var(--app-surface); }
.log-drawer-header { justify-content: space-between; border-bottom: 1px solid var(--app-line); }
.log-drawer-header h2 { margin: 4px 0 8px; font-size: 1.4rem; }
.log-drawer-header p, .drawer-facts dt { margin: 0; color: var(--app-muted); font-size: .82rem; }
.log-drawer-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 16px 20px; }
.log-drawer-body section { padding: 14px; border: 1px solid var(--app-line); border-radius: var(--app-radius); background: var(--app-surface); }
.log-drawer-body section + section { margin-top: 12px; }
.log-drawer-body h3 { margin: 0 0 10px; font-size: 1rem; }
.drawer-facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 0; }
.drawer-facts dd { margin: 4px 0 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.log-drawer-actions { border-top: 1px solid var(--app-line); }
.log-drawer .log-image { width: 132px; aspect-ratio: 4 / 3; }

@container (max-width: 720px) {
  .log-table, .log-table tbody { display: block; }
  .log-table { border: 0; background: transparent; }
  .log-table thead { position: absolute; width: 1px; height: 1px; clip-path: inset(50%); overflow: hidden; }
  .log-table tr { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 10px; padding: 12px; margin-bottom: 8px; border: 1px solid var(--app-line); border-radius: var(--app-radius); background: var(--app-surface); }
  .log-table td { height: auto; border: 0; padding: 0; }
  .record-type { grid-area: 1 / 1; }
  .record-status { grid-area: 1 / 2; text-align: end; }
  .record-time { grid-area: 2 / 1 / 2 / -1; white-space: normal; }
  .record-content { grid-area: 3 / 1 / 3 / -1; width: auto; }
  .record-image { align-self: center; }
  .record-actions { justify-self: end; }
  .log-actions-menu summary, .log-actions :deep(.va-button) { min-width: 44px; min-height: 44px; }
}
@media (max-width: 600px) {
  .log-filter select, .log-range input { font-size: 16px; }
  .log-range input { flex: 1 1 0; width: 0; }
  .log-drawer-header, .log-drawer-body, .log-drawer-actions { padding-inline: 14px; }
}

.page-container { width: min(1180px, calc(100% - 2rem)); margin: 0 auto; padding: 1.5rem 0 4rem; font-family: inherit; }
.back-btn { margin-bottom: 1rem; margin-left: -0.5rem; }

/* Header */

/* Empty State */

.date-group-small { margin-bottom: 1.5rem; }
.date-header-small {
  font-size: 0.95rem; 
  font-weight: 700; 
  color: var(--app-muted);
  margin: 0 0 0.75rem 0; 
  text-transform: uppercase; 
  letter-spacing: 0.05em;
  border-left: 3px solid #cbd5e1;
  padding-left: 0.5rem;
}

/* Modals & Forms */

/* History & Verify UI */
.history-list { padding-right: 0.5rem; }
.v-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
.correction-reason { font-size: 0.9rem; color: #334155; margin-bottom: 0.5rem; background: #f1f5f9; padding: 0.5rem; border-radius: 6px; }

.summary-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; }
.stat-box { text-align: center; background: var(--app-canvas); border: 1px solid var(--app-line); border-radius: 12px; padding: 1rem; }
.stat-box strong { display: block; font-size: 1.5rem; margin-bottom: 0.25rem; color: var(--app-ink); }
.stat-box span { font-size: 0.8rem; color: var(--app-muted); text-transform: uppercase; font-weight: 600; }
.stat-box.ok strong { color: var(--va-success); }
.stat-box.err strong { color: var(--va-danger); }

.image-upload-field { display: grid; gap: 0.5rem; }
.image-upload-field > label { color: var(--app-muted); font-size: 0.9rem; font-weight: 600; }
.image-upload-field input[type="file"] { max-width: 100%; padding: 0.5rem; border: 1px solid #cbd5e1; border-radius: 8px; }
.image-upload-hint { margin: 0; color: var(--app-muted); font-size: 0.82rem; }
.image-preview-wrap { display: flex; align-items: flex-start; gap: 0.75rem; }
.image-preview { width: 132px; height: 96px; border-radius: 8px; object-fit: cover; border: 1px solid var(--app-line); }
.log-image-link { display: inline-flex; flex-direction: column; gap: 0.35rem; margin: 0.25rem 0 1rem; color: var(--va-primary); font-size: 0.82rem; }
.log-image { width: 100%; max-width: 280px; max-height: 180px; border-radius: 8px; object-fit: cover; }

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
  .summary-stats { grid-template-columns: 1fr; }
}

</style>
