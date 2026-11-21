<script setup lang="ts">
import { draftDismiss } from '../../components/overlay-dismiss'
import LoadingState from '../../components/LoadingState.vue'
import DecimalField from '../../components/DecimalField.vue'
import PageHeader from '../../components/PageHeader.vue'
import EmptyState from '../../components/EmptyState.vue'
import { computed, reactive, ref, watch, onUnmounted } from 'vue'
import CollectionToolbar from '../../components/CollectionToolbar.vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import {
  VaButton, VaInnerLoading, VaModal, VaInput, VaSelect,
  VaAlert, VaCard, VaCardContent, VaBadge, VaIcon, VaTextarea
} from 'vuestic-ui'
import { usePondsStore } from '../../stores/ponds.store'
import { usePondBatchesStore } from '../../stores/pond-batches.store'
import BatchVersionList from './BatchVersionList.vue'
import BatchDetailDrawer from './BatchDetailDrawer.vue'
import HarvestModal from './HarvestModal.vue'
import { useAuthStore } from '../../stores/auth.store'
import { SPECIES_LABELS, STATUS_LABELS, type BatchVersion, type BatchInput, type BatchItem, type BatchStatusCode, type Species } from '../../types'

const route = useRoute(); const router = useRouter(); const store = usePondBatchesStore(); const pondsStore = usePondsStore()
const auth = useAuthStore()
const farmer = computed(() => auth.user?.role === 'FARMER')
const { items, loading, saving, error } = storeToRefs(store)
const farmId = computed(() => String(route.params.farmId)); const pondId = computed(() => String(route.params.pondId))
const pond = computed(() => pondsStore.scope === farmId.value ? pondsStore.items.find((item) => item.id === pondId.value) : undefined)
const pondName = computed(() => pond.value?.pond_name ?? '')
const showForm = ref(false); const editingId = ref<string | null>(null); const formError = ref(''); const success = ref(''); const warning = ref('')
const correctionReason = ref(''); const expectedVersion = ref(1)
const editingBatch = computed(() => items.value.find((item) => item.id === editingId.value) ?? null)
const historyItems = ref<BatchVersion[]>([]); const historyTitle = ref(''); const historyLoading = ref(false)
const detailId = ref('')
const detailSection = ref<'general' | 'history'>('general')

function openDetail(item: BatchItem, section: 'general' | 'history' = 'general') {
  detailSection.value = section
  detailId.value = item.id
}

function chooseAction(event: Event, action?: () => void) {
  const menu = (event.currentTarget as HTMLElement).closest('details')
  if (menu) {
    menu.open = false
    menu.querySelector('summary')?.focus()
  }
  action?.()
}

const detailBatch = computed(() => items.value.find((item) => item.id === detailId.value))
const harvestBatchId = ref<string | null>(null)
watch([() => route.query.harvest, items, loading], ([id, rows, pending], [previousId]) => {
  if (!pending && typeof id === 'string' && rows.some((item) => item.id === id)) harvestBatchId.value = id
  if (id == null && typeof previousId === 'string') harvestBatchId.value = null
})

function closeHarvest() {
  harvestBatchId.value = null
  if (!route.query.harvest) return
  const { harvest, ...query } = route.query
  if (harvest) void router.replace({ query })
}

const harvestBatch = computed(() => items.value.find((item) => item.id === harvestBatchId.value))
function updateHarvestBatch(batch: BatchItem) {
  const index = items.value.findIndex((item) => item.id === batch.id)
  if (index >= 0) items.value[index] = batch
}

const query = ref(''); const filterStatus = ref(''); const listPage = ref(1); const listPageSize = 9
const filteredItems = computed(() => items.value.filter((item) => (!filterStatus.value || item.status === filterStatus.value) && (!filterSpecies.value || item.species === filterSpecies.value) && `${item.batch_code} ${SPECIES_LABELS[item.species]} ${item.seed_source ?? ''}`.toLocaleLowerCase('vi').includes(query.value.trim().toLocaleLowerCase('vi'))))
const filterSpecies = ref('')
const visibleItems = computed(() => filteredItems.value.slice((listPage.value - 1) * listPageSize, listPage.value * listPageSize))
watch([query, filterStatus, filterSpecies], () => { listPage.value = 1 })
watch(() => filteredItems.value.length, (length) => { listPage.value = Math.min(listPage.value, Math.max(1, Math.ceil(length / listPageSize))) })

let contextVersion = 0; let historyVersion = 0

const form = reactive({ species: 'SHRIMP' as Species, seedSource: '', seedQuantity: '' as string | number, stockingDate: '', expectedHarvestDate: '', actualHarvestDate: '', yieldQuantity: '' as string | number, status: 'GROWING' as BatchStatusCode, note: '' })

// Chuyển đổi options cho Vuestic Select
const statusOptions = Object.entries(STATUS_LABELS).map(([value, label]) => ({ value: value as BatchStatusCode, label }))
const speciesOptions = Object.entries(SPECIES_LABELS).map(([value, label]) => ({ value: value as Species, label }))

// Helper màu sắc cho Badge trạng thái
const statusColors: Record<string, string> = {
  PREPARING: 'info',
  GROWING: 'primary',
  READY_FOR_HARVEST: 'warning',
  HARVESTED: 'success',
  COMPLETED: 'success',
  CANCELLED: 'danger',
}

const canEnterHarvest = computed(() => Boolean(editingId.value) && ['HARVESTED', 'COMPLETED'].includes(form.status))
const numeric = (value: string | number) => value === '' ? null : Number(value)
const day = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' })
const displayDate = (value: string | null | undefined) => value ? day.format(new Date(value)) : '—'
const dateOnly = (value: string | null | undefined) => value
  ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)) : ''

function reset() { correctionReason.value = ''; expectedVersion.value = 1; editingId.value = null; Object.assign(form, { species: 'SHRIMP', seedSource: '', seedQuantity: '', stockingDate: '', expectedHarvestDate: '', actualHarvestDate: '', yieldQuantity: '', status: 'GROWING', note: '' }); formError.value = '' }
function openCreate() { if (saving.value || loading.value) return; reset(); showForm.value = true }
function openEdit(item: BatchItem) { if (saving.value || loading.value) return; correctionReason.value = ''; formError.value = ''; expectedVersion.value = item.current_version; editingId.value = item.id; Object.assign(form, { species: item.species, seedSource: item.seed_source ?? '', seedQuantity: item.seed_quantity, stockingDate: dateOnly(item.stocking_date), expectedHarvestDate: dateOnly(item.expected_harvest_date), actualHarvestDate: dateOnly(item.actual_harvest_date), yieldQuantity: item.yield_quantity ?? '', status: item.status, note: item.note ?? '' }); showForm.value = true }
const formDismiss = draftDismiss(() => [form, correctionReason.value], () => saving.value, showForm).dismiss
function close() { showForm.value = false; reset() }

async function submit() {
  if (saving.value || loading.value) return
  const version = contextVersion
  formError.value = ''; success.value = ''; warning.value = ''
  if (!form.stockingDate || numeric(form.seedQuantity) === null) { formError.value = 'Vui lòng nhập số lượng giống và ngày thả giống.'; return }

  const payload: BatchInput = { species: form.species, seedSource: form.seedSource.trim() || null, seedQuantity: Number(form.seedQuantity), stockingDate: form.stockingDate, expectedHarvestDate: form.expectedHarvestDate || null, status: form.status, note: form.note.trim() || null }

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
    if (version !== contextVersion) return
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
    if (version === contextVersion) formError.value = error.value
  }
}

async function openHistory(item: BatchItem) {
  const version = ++historyVersion
  historyTitle.value = item.batch_code
  historyItems.value = []
  historyLoading.value = true
  try {
    const result = await store.history(farmId.value, pondId.value, item.id)
    if (version === historyVersion) historyItems.value = result
  } catch {
    if (version !== historyVersion) return
    historyTitle.value = ''
    warning.value = 'Không thể tải lịch sử vụ nuôi. Vui lòng thử lại.'
  } finally {
    if (version === historyVersion) historyLoading.value = false
  }
}

function toggleHistory(value: boolean) {
  if (!value) { ++historyVersion; historyTitle.value = ''; historyLoading.value = false }
}

async function remove(item: BatchItem) {
  if (saving.value || loading.value) return
  const version = contextVersion
  if (!confirm(`Bạn có chắc chắn muốn xóa vụ “${item.batch_code}”? Mọi dữ liệu nhật ký liên quan có thể bị mất.`)) return;
  try {
    await store.remove(farmId.value, pondId.value, item.id);
    if (version !== contextVersion) return
    success.value = 'Đã xóa vụ nuôi khỏi hệ thống.'
  } catch { }
}

async function loadContext() {
  const version = ++contextVersion; ++historyVersion
  const farm = farmId.value; const pond = pondId.value
  detailId.value = ''; showForm.value = false; reset(); historyTitle.value = ''; historyItems.value = []; historyLoading.value = false; harvestBatchId.value = null; success.value = ''; warning.value = ''; query.value = ''; filterStatus.value = ''; filterSpecies.value = ''
  await store.load(farm, pond)
  if (version !== contextVersion) return
  await pondsStore.load(farm)
}
watch(() => `${farmId.value}/${pondId.value}`, loadContext, { immediate: true })

onUnmounted(() => { ++contextVersion; ++historyVersion })
</script>

<template>
  <main class="page-container" :class="{ 'farmer-batches': farmer }" :aria-busy="loading">

    <PageHeader title="Vụ nuôi" :context="pondName" :description="farmer ? 'Quản lý các vụ nuôi tại ao, theo dõi trạng thái, nhật ký và thu hoạch.' : 'Theo dõi vụ nuôi, nhật ký chăm sóc và các lô thu hoạch.'">
      <template #actions>
        <va-button icon="add" :disabled="loading || saving" @click="openCreate">{{ farmer ? 'Thêm vụ nuôi' : 'Tạo vụ nuôi mới' }}</va-button>
      </template>
    </PageHeader>

    <!-- Alerts -->
    <va-alert v-if="success" color="success" class="mb-4" icon="check_circle" outline closeable role="status">
      {{ success }}
    </va-alert>
    <va-alert v-if="warning" color="warning" class="mb-4" icon="warning" outline closeable>
      {{ warning }}
    </va-alert>
    <va-alert v-if="error" color="danger" class="mb-4" icon="warning" outline closeable role="alert">
      {{ error }} <va-button preset="secondary" size="small" @click="loadContext()">Thử lại</va-button>
    </va-alert>

    <CollectionToolbar v-model:query="query" v-model:status="filterStatus" v-model:page="listPage"
      class="batch-toolbar" :statuses="statusOptions" :total="filteredItems.length" :page-size="listPageSize"
      :loading="loading" :extra-filters-active="Boolean(filterSpecies)"
      :search-placeholder="farmer ? 'Mã vụ hoặc loại thủy sản…' : undefined"
      label="vụ nuôi trong danh sách đã tải" @clear="filterSpecies = ''">
      <template v-if="farmer" #filters>
        <label class="species-filter">Loài nuôi
          <select v-model="filterSpecies" aria-label="Loài nuôi">
            <option value="">Tất cả loài</option>
            <option v-for="species in speciesOptions" :key="species.value" :value="species.value">{{ species.label }}</option>
          </select>
        </label>
      </template>
    </CollectionToolbar>

    <div v-if="loading && farmer" class="batch-rows" role="status">
      <span class="sr-only">Đang tải vụ nuôi</span>
      <div v-for="index in 3" :key="index" class="batch-row batch-skeleton" aria-hidden="true"><span /><span /><span /></div>
    </div>
    <LoadingState v-else-if="loading" />
    <template v-else>
      <!-- Empty State -->
      <EmptyState v-if="!loading && !error && !items.length" title="Chưa có vụ nuôi nào" description="Tạo vụ nuôi đầu tiên để theo dõi quá trình nuôi trong ao này." icon="set_meal">
        <va-button icon="add" @click="openCreate">Tạo vụ nuôi mới</va-button>
      </EmptyState>
      <EmptyState v-else-if="!loading && !error && !filteredItems.length" title="Không có vụ nuôi phù hợp" description="Thử đổi từ khóa hoặc trạng thái." />

      <ul v-else-if="farmer && visibleItems.length" class="batch-rows" aria-label="Danh sách vụ nuôi">
        <li v-for="item in visibleItems" :key="item.id" class="batch-row">
          <div class="batch-identity">
            <span class="species-icon"><va-icon name="set_meal" aria-hidden="true" /></span>
            <div>
              <h2>{{ SPECIES_LABELS[item.species] }}</h2>
              <span class="batch-code">{{ item.batch_code }}</span>
              <va-badge :color="statusColors[item.status]" :text="STATUS_LABELS[item.status]" />
            </div>
          </div>

          <dl class="row-facts">
            <div><dt>Ngày thả giống</dt><dd>{{ displayDate(item.stocking_date) }}</dd></div>
            <div><dt>Số lượng giống</dt><dd>{{ item.seed_quantity.toLocaleString('vi-VN') }}</dd></div>
            <div><dt>Dự kiến thu hoạch</dt><dd>{{ displayDate(item.expected_harvest_date) }}</dd></div>
          </dl>

          <div class="row-actions">
            <va-button size="small" preset="secondary" icon="edit_document"
              :to="{ name: 'farming-logs', params: { farmId, pondId, batchId: item.id } }">Nhật ký</va-button>
            <va-button size="small" preset="secondary" icon="agriculture" @click="harvestBatchId = item.id">Thu hoạch &amp; Lô</va-button>
            <va-button size="small" preset="secondary" @click="openDetail(item)">Xem chi tiết</va-button>
            <details class="batch-menu" name="batch-actions"
              @keydown.esc.stop="chooseAction($event)">
              <summary :aria-label="`Thao tác khác cho vụ ${item.batch_code}`" title="Thao tác khác">
                <va-icon name="more_horiz" aria-hidden="true" />
              </summary>
              <div class="menu-actions">
                <button type="button" :disabled="saving" @click="chooseAction($event, () => openEdit(item))">Đính chính</button>
                <button type="button" @click="chooseAction($event, () => openDetail(item, 'history'))">Lịch sử</button>
                <button type="button" class="menu-danger" :disabled="saving" @click="chooseAction($event, () => remove(item))">Xóa vụ nuôi</button>
              </div>
            </details>
          </div>
        </li>
      </ul>

      <!-- Lưới Card -->
      <div v-else-if="!farmer && visibleItems.length" class="batch-grid">
        <va-card v-for="item in visibleItems" :key="item.id" class="batch-card hover-elevation">
          <va-card-content>
            <div class="card-top">
              <div class="batch-code-badge">
                <va-icon name="tag" size="small" class="mr-1" />
                <strong>{{ item.batch_code }}</strong>
              </div>
              <va-badge :color="statusColors[item.status] || 'primary'" class="status-badge" :text="STATUS_LABELS[item.status]" />
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
          <div class="card-actions batch-actions">
            <va-button preset="primary" icon="edit_document" class="flex-1"
              @click="router.push({ name: 'farming-logs', params: { farmId, pondId, batchId: item.id } })">
              Nhật ký
            </va-button>
            <va-button preset="secondary" icon="agriculture" aria-label="Thu hoạch và lô hàng" @click="harvestBatchId = item.id">Thu hoạch và lô</va-button>
            <div class="batch-secondary-actions">
              <va-button preset="plain" size="small" icon="edit" color="secondary" @click="openEdit(item)">Đính chính</va-button>
              <va-button preset="plain" size="small" icon="history" color="secondary" @click="openHistory(item)">Lịch sử</va-button>
              <va-button preset="plain" size="small" icon="delete" color="danger" aria-label="Xóa vụ nuôi" @click="remove(item)" />
            </div>
          </div>
        </va-card>
      </div>
    </template>

    <BatchDetailDrawer v-if="detailBatch" :key="detailBatch.id" :batch="detailBatch"
      :farm-id="farmId" :pond-id="pondId" :pond="pond" :initial-section="detailSection"
      :badge-color="statusColors[detailBatch.status] ?? 'primary'"
      @close="detailId = ''"
      @edit="openEdit(detailBatch); detailId = ''"
      @harvest="harvestBatchId = detailBatch.id; detailId = ''" />

    <HarvestModal v-if="harvestBatch" :key="harvestBatch.id" :batch="harvestBatch" :farm-id="farmId" :pond-id="pondId"
      @close="closeHarvest" @updated="updateHarvestBatch" />

    <!-- Modal Form -->
    <va-modal title="batch-form-title" :model-value="showForm" @update:model-value="(open: boolean) => { if (!open) close() }" :mobile-fullscreen="false" :before-close="formDismiss" close-button aria-close-label="Đóng biểu mẫu" :no-dismiss="saving" hide-default-actions overlay-opacity="0.5">
      <template #header>
        <h2 id="batch-form-title" class="modal-title">{{ editingId ? 'Đính chính vụ nuôi' : 'Tạo vụ nuôi mới' }}</h2>
      </template>

      <form @submit.prevent="submit" class="modern-form">
        <div v-if="editingBatch" class="generated-code col-span-2"><span>Mã vụ nuôi</span><strong>{{ editingBatch.batch_code }}</strong><small>Mã vụ được hệ thống tạo tự động và không thể sửa.</small></div>
        <p v-else class="generated-code-hint col-span-2">Mã vụ nuôi sẽ được tạo tự động khi lưu.</p>

        <h3 class="form-section-heading">Con giống và kế hoạch nuôi</h3>
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
              <va-input v-model="form.actualHarvestDate" type="date" label="Ngày kết thúc thu hoạch" readonly />
              <DecimalField v-model="form.yieldQuantity" label="Sản lượng thu hoạch (kg)" readonly />
            </div>
          </div>
        </template>

        <h3 class="form-section-heading">Thông tin bổ sung</h3>
        <va-textarea v-model="form.note" label="Ghi chú" placeholder="Thông tin thêm..." class="col-span-2" />

        <va-textarea v-if="editingId" v-model="correctionReason" label="Lý do đính chính *"
          placeholder="Ví dụ: Nhập sai số lượng con giống" minlength="3" maxlength="1000" class="col-span-2" />

        <va-alert v-if="formError" color="danger" outline size="small" class="col-span-2 mt-2" role="alert">
          {{ formError }}
        </va-alert>

        <div class="form-actions col-span-2">
          <va-button preset="secondary" type="button" color="secondary" :disabled="saving" @click="formDismiss(close)">
            Hủy
          </va-button>
          <va-button type="submit" :loading="saving" :disabled="saving" color="primary">
            {{ editingId ? 'Đính chính và ghi blockchain' : 'Tạo và ghi blockchain' }}
          </va-button>
        </div>
      </form>
    </va-modal>

    <va-modal title="batch-history-title" :mobile-fullscreen="false" :model-value="Boolean(historyTitle)" hide-default-actions size="large"
      @update:model-value="toggleHistory">
      <template #header>
        <h2 id="batch-history-title" class="modal-title">Lịch sử vụ {{ historyTitle }}</h2>
      </template>
      <va-inner-loading :loading="historyLoading">
        <BatchVersionList :versions="historyItems" :loading="historyLoading" />
      </va-inner-loading>
      <div class="form-actions">
        <va-button preset="secondary" @click="historyTitle = ''">Đóng</va-button>
      </div>
    </va-modal>
  </main>
</template>

<style scoped>
.farmer-batches .batch-toolbar { margin-bottom: 14px; }
.farmer-batches .species-filter { flex: 1; display: grid; gap: 8px; min-width: 150px; font-size: 12px; font-weight: 500; }
.species-filter select { width: 100%; min-height: 44px; border: 1px solid var(--app-control-line); border-radius: var(--app-control-radius); background: var(--app-surface); color: var(--app-ink); padding: 8px 12px; font: inherit; font-size: 1rem; }
.batch-rows { display: grid; gap: 10px; list-style: none; margin: 0; padding: 0; }
.batch-row { display: grid; min-height: 104px; box-sizing: border-box; grid-template-columns: minmax(150px, 1fr) minmax(240px, 1.5fr) auto; align-items: center; gap: 16px; padding: 14px 16px; border: 1px solid var(--app-line); border-radius: var(--app-radius); background: var(--app-surface); overflow-wrap: anywhere; }
.batch-row:hover, .batch-row:focus-within { border-color: var(--app-control-line); }
.batch-identity { display: flex; min-width: 0; gap: 10px; align-items: center; }
.species-icon { display: grid; place-items: center; width: 40px; height: 40px; flex: 0 0 40px; border-radius: var(--app-control-radius); background: var(--app-primary-soft); color: var(--app-primary-dark); }
.batch-identity h2 { margin: 0; font-size: 1rem; }
.batch-code { display: block; margin: 2px 0 4px; color: var(--app-muted); font-size: .8rem; }
.row-facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 0; }
.row-facts dt { color: var(--app-muted); font-size: .78rem; }
.row-facts dd { margin: 4px 0 0; font-size: .9rem; font-weight: 650; }
.row-actions { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; }
.row-actions :deep(.va-button), .batch-menu summary { min-height: 44px; }
.batch-menu { position: relative; }
.batch-menu summary { display: grid; place-items: center; width: 44px; cursor: pointer; border: 1px solid var(--app-line); border-radius: var(--app-control-radius); color: var(--app-primary-dark); }
.batch-menu summary::-webkit-details-marker { display: none; }
.menu-actions { position: absolute; top: calc(100% + 4px); right: 0; z-index: 4; min-width: 152px; padding: 4px; border: 1px solid var(--app-line); border-radius: var(--app-control-radius); background: var(--app-surface); box-shadow: 0 6px 18px rgb(0 0 0 / 12%); }
.menu-actions button { display: block; width: 100%; min-height: 44px; text-align: start; padding: 6px 9px; color: var(--app-ink); background: transparent; border: 0; cursor: pointer; }
.menu-actions button:hover, .batch-menu summary:hover { background: var(--app-primary-soft); }
.menu-actions .menu-danger { color: var(--va-danger); }
.menu-actions button:disabled { opacity: .6; cursor: default; }
.batch-skeleton { min-height: 70px; }
.batch-skeleton span { min-height: 18px; width: min(100%, 124px); border-radius: var(--app-control-radius); background: var(--app-canvas); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
@media (max-width: 1160px), (min-width: 1024px) and (max-width: 1360px) {
  .batch-row { grid-template-columns: minmax(140px, 1fr) minmax(0, 1.7fr); }
  .row-actions { grid-column: 1 / -1; justify-content: end; }
}
@media (max-width: 600px) {
  .batch-row { grid-template-columns: minmax(0, 1fr); }
  .row-actions { justify-content: start; }
}
.batch-secondary-actions { width: 100%; display: flex; gap: 4px; align-items: center; border-top: 1px solid var(--app-line); padding-top: 8px; margin-top: 4px; flex-wrap: wrap; }
.batch-secondary-actions :last-child { margin-left: auto; }

.page-container {
  width: min(1180px, calc(100% - 2rem));
  margin: 0 auto;
  padding: 1.5rem 0 4rem;
  font-family: inherit;
}

.back-btn {
  margin-bottom: 1rem;
  margin-left: -0.5rem;
}

/* Header Styles */

/* Empty State */

/* Grid Layout */
.batch-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr));
  gap: 1.5rem;
}

/* Cards */
.batch-card {
  border-radius: 16px;
  border: 1px solid var(--app-line);
  box-shadow: none;
  transition: border-color var(--app-motion);
  display: flex;
  flex-direction: column;
}

.batch-card:hover {
  transform: none;
  box-shadow: none;
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

.stat-value.highlight {
  display: flex;
  align-items: center;
  color: #0284c7;
}

/* Card Actions */
.card-actions {
  display: flex;
  flex-wrap: wrap;
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





.harvest-section {
  background: var(--app-canvas);
  border: 1px dashed #cbd5e1;
  padding: 1.25rem;
  border-radius: 12px;
}

.section-title {
  margin: 0 0 1rem;
  font-size: 1rem;
  font-weight: 700;
  color: var(--app-primary);
}

.harvest-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.25rem;
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

  .batch-grid {
    grid-template-columns: 1fr;
  }

  .harvest-grid,
  .version-list {
    grid-template-columns: 1fr;
    min-width: 100%;
  }

}
</style>
