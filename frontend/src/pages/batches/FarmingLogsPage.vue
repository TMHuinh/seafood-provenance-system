<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import { VaButton, VaInnerLoading } from 'vuestic-ui'
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
const logTypes = Object.entries(FARMING_LOG_TYPE_LABELS) as [FarmingLogType, string][]
const form = reactive({ logType: 'FEEDING' as FarmingLogType, logDate: '', feedType: '', feedAmount: '' as string | number, temperature: '' as string | number, salinity: '' as string | number, ph: '' as string | number, dissolvedOxygen: '' as string | number, medicineName: '', dose: '', mortalityCount: '' as string | number, cause: '', description: '', imageUrl: '', correctionReason: '' })
const DETAIL_LABELS: Record<string, string> = { feedType: 'Loại thức ăn', feedAmount: 'Số lượng (kg)', temperature: 'Nhiệt độ (°C)', salinity: 'Độ mặn (‰)', ph: 'pH', dissolvedOxygen: 'Oxy hòa tan (mg/L)', medicineName: 'Tên thuốc / hoá chất', dose: 'Liều lượng', mortalityCount: 'Số con chết', cause: 'Nguyên nhân', description: 'Mô tả', note: 'Ghi chú' }
const numeric = (value: string | number) => value === '' ? null : Number(value)
const dateOnly = (value: string | null | undefined) => value ? value.slice(0, 10) : ''
function formatDateTime(value: string) { const d = new Date(value); return isNaN(d.getTime()) ? value : `${d.toLocaleDateString('vi-VN')} ${d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}` }
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
    logDate: dateOnly(log.log_date),
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
  if (!form.logDate) { formError.value = 'Vui lòng chọn ngày ghi nhật ký'; return }
  const required = validate()
  if (required) { formError.value = required; return }
  if (editingId.value && editingMode.value === 'CORRECTION' && form.correctionReason.trim().length < 3) { formError.value = 'Vui lòng nhập lý do đính chính (tối thiểu 3 ký tự)'; return }
  const input: FarmingLogInput = { batchId: batchId.value, logType: form.logType, logDate: form.logDate, details: buildDetails(), imageUrl: form.imageUrl.trim() || null, correctionReason: editingId.value ? form.correctionReason.trim() : undefined }
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
  verifyError.value = '';
  verifyResults.value = null;
  try {
    verifyResults.value = await logStore.verify(batchId.value)

    // Xử lý thêm điều kiện PENDING
    const map: Record<string, 'SYNCED' | 'DESYNCED' | 'PENDING' | 'DRAFT'> = {}
    for (const item of verifyResults.value.details) {
      if (item.record?.status === 'PENDING') {
        map[item.id] = 'PENDING'
      } else {
        map[item.id] = item.status
      }
    }
    verifiedStatus.value = map

  } catch {
    verifyError.value = logStore.error
  }
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
</script>

<template>
  <main class="page"><button class="back" @click="router.push({ name: 'pond-batches', params: { farmId, pondId } })">←
      Các vụ nuôi</button>
    <header>
      <div>
        <p class="eyebrow">{{ batchInfo ? `${batchInfo.batch_code} · ${SPECIES_LABELS[batchInfo.species]}` : 'Vụ nuôi'
        }} · {{ pondName }}</p>
        <h1>Nhật ký nuôi</h1>
      </div>
      <div class="actions"><va-button preset="secondary" :loading="verifying" @click="checkSync">Kiểm tra đồng bộ
          Blockchain</va-button><va-button gradient @click="openCreate">+ Ghi nhật ký</va-button></div>
    </header>
    <p v-if="success" class="notice success">{{ success }}</p>
    <p v-if="error"><va-alert color="danger" dense>{{ error }}</va-alert></p><va-inner-loading :loading="loading">
      <div v-if="!loading && !items.length" class="empty">
        <h2>Chưa có nhật ký nuôi</h2>
        <p>Ghi nhật ký đầu tiên cho vụ nuôi này.</p><va-button @click="openCreate">Ghi nhật ký</va-button>
      </div>
      <div v-else class="grid">
        <article v-for="log in items" :key="log.id">
          <div class="top"><strong>{{ FARMING_LOG_TYPE_LABELS[log.log_type] }}</strong><span :class="log.lifecycle_status === 'CONFIRMED' ? 'ok' : 'no'">{{ log.lifecycle_status === 'DRAFT' ? 'Bản nháp' : log.lifecycle_status === 'REVOKED' ? 'Đã thu hồi' : '✓ Đã chứng thực' }}</span></div>
          <p class="when">{{ formatDateTime(log.log_date) }}</p>
          <dl>
            <div v-for="row in detailsRows(log)" :key="row.label">
              <dt>{{ row.label }}</dt>
              <dd>{{ row.value }}</dd>
            </div>
          </dl>
          <blockquote v-if="log.data_hash" class="hash">DATA {{ shortHash(log.data_hash) }}<template v-if="log.tx_hash">
              · TX {{ shortHash(log.tx_hash) }}</template>
          </blockquote>
          <p v-if="verifiedStatus[log.id]" class="verify-badge" :class="verifiedStatus[log.id]?.toLowerCase()">
            {{
              verifiedStatus[log.id] === 'SYNCED'
                ? '✓ Đồng bộ blockchain'
                : (verifiedStatus[log.id] === 'PENDING' ? '⏳ Đang chờ xác nhận' : verifiedStatus[log.id] === 'DRAFT' ? 'Bản nháp chưa chứng thực' : '✗ Lệch dữ liệu blockchain')
            }}
          </p>
          <footer><va-button v-if="log.lifecycle_status !== 'REVOKED'" preset="secondary" size="small" @click="openEdit(log)">{{ log.lifecycle_status === 'DRAFT' ? 'Chỉnh sửa' : 'Đính chính' }}</va-button><va-button v-if="log.lifecycle_status === 'DRAFT'" size="small" :loading="saving" @click="confirmLog(log)">Xác nhận</va-button><va-button v-if="log.lifecycle_status === 'CONFIRMED'" preset="plain" color="danger" size="small" @click="revokeLog(log)">Thu hồi</va-button><va-button v-if="log.current_version_id" preset="plain" size="small" @click="showHistory(log)">Lịch sử</va-button></footer>
        </article>
      </div>
    </va-inner-loading>
    <div v-if="showForm" class="backdrop" @click.self="close">
      <section class="modal">
        <header>
          <h2>{{ editingId ? (editingMode === 'CORRECTION' ? 'Đính chính nhật ký' : 'Chỉnh sửa bản nháp') : 'Ghi nhật ký nuôi' }}</h2><button @click="close">×</button>
        </header>
        <form @submit.prevent="submit"><label>Loại nhật ký *<select v-model="form.logType">
              <option v-for="([value, label]) in logTypes" :key="value" :value="value">{{ label }}</option>
            </select></label><label>Ngày ghi nhật ký *<input v-model="form.logDate" type="date"
              :max="dateOnly(new Date().toISOString())" /></label><template
            v-if="form.logType === 'FEEDING'"><label>Loại thức ăn *<input v-model="form.feedType" maxlength="255"
                placeholder="Thức ăn viên 40%" /></label><label>Số lượng (kg)<input v-model="form.feedAmount"
                type="number" min="0" step="0.01" /></label></template><template
            v-else-if="form.logType === 'WATER_QUALITY'"><label>Nhiệt độ (°C)<input v-model="form.temperature"
                type="number" step="0.1" /></label><label>Độ mặn (‰)<input v-model="form.salinity" type="number"
                step="0.1" /></label><label>pH<input v-model="form.ph" type="number" min="0" max="14"
                step="0.1" /></label><label>Oxy hòa tan (mg/L)<input v-model="form.dissolvedOxygen" type="number"
                step="0.1" /></label></template><template v-else-if="form.logType === 'MEDICINE'"><label>Tên thuốc / hoá
              chất *<input v-model="form.medicineName" maxlength="255" /></label><label>Liều lượng<input
                v-model="form.dose" maxlength="255" /></label></template><template
            v-else-if="form.logType === 'MORTALITY'"><label>Số con chết *<input v-model="form.mortalityCount"
                type="number" min="0" step="1" /></label><label>Nguyên nhân<input v-model="form.cause"
                maxlength="255" /></label></template><template v-else><label class="full">Mô tả *<textarea
                v-model="form.description" rows="3"
                placeholder="Mô tả chi tiết hoạt động chăm sóc / môi trường..."></textarea></label></template><template
            v-if="form.logType !== 'CARE' && form.logType !== 'ENVIRONMENT' && form.logType !== 'OTHER'"><label
              class="full">Ghi chú<textarea v-model="form.description" rows="2"></textarea></label></template><label
            class="full">Hình ảnh (URL)<input v-model="form.imageUrl" placeholder="https://..." /></label>
          <label v-if="editingId && editingMode === 'CORRECTION'" class="full">Lý do đính chính *<textarea v-model="form.correctionReason" rows="3"
              minlength="3" maxlength="1000" required placeholder="Ví dụ: Nhập nhầm số lượng thức ăn"></textarea></label>
          <p v-if="formError" class="form-error">{{ formError }}</p>
          <footer><va-button preset="secondary" type="button" @click="close">Hủy</va-button><va-button type="submit"
              :loading="saving">{{ editingId ? 'Lưu thay đổi' : 'Ghi nhật ký' }}</va-button></footer>
        </form>
      </section>
    </div>
    <div v-if="historyResult" class="backdrop" @click.self="historyResult = null"><section class="modal verify"><header><h2>Lịch sử phiên bản</h2><button @click="historyResult = null">×</button></header><ul class="verify-list"><li v-for="version in historyResult.items" :key="version.id"><div class="v-top"><strong>Phiên bản {{ version.version_number }}</strong><span>{{ version.status }}</span></div><p v-if="version.correction_reason">Lý do: {{ version.correction_reason }}</p><p class="when">{{ formatDateTime(version.created_at) }}</p><blockquote class="hash">EVENT {{ shortHash(version.blockchain_event_id) }}<template v-if="version.tx_hash"> · TX {{ shortHash(version.tx_hash) }}</template></blockquote></li></ul></section></div>
    <div v-if="verifyResults" class="backdrop" @click.self="verifyResults = null">
      <section class="modal verify">
        <header>
          <h2>Kết quả kiểm tra đồng bộ Blockchain</h2><button @click="verifyResults = null">×</button>
        </header>
        <p v-if="verifyError" class="notice error">{{ verifyError }}</p>
        <div class="summary">
          <div><strong>{{ verifyResults.summary.total }}</strong><span>Tổng nhật ký</span></div>
          <div class="ok"><strong>{{ verifyResults.summary.verified }}</strong><span>Đồng bộ</span></div>
          <div class="err"><strong>{{ verifyResults.summary.desynced }}</strong><span>Lệch dữ liệu</span></div>
        </div>
        <ul class="verify-list">
          <li v-for="item in verifyResults.details" :key="item.id"
            :class="item.record?.status === 'PENDING' ? 'pending' : item.status.toLowerCase()">
            <div class="v-top">
              <strong>{{ FARMING_LOG_TYPE_LABELS[item.logType] }}</strong>
              <span>
                {{
                  item.record?.status === 'PENDING'
                    ? '⏳ Đang chờ xác nhận'
                    : (item.status === 'SYNCED' ? '✓ Đồng bộ' : '✗ Lệch dữ liệu')
                }}
              </span>
            </div>
            <p class="when">{{ formatDateTime(item.logDate) }}</p>
            <ul v-if="item.issues.length" class="issues" :class="{ 'pending-text': item.record?.status === 'PENDING' }">
              <li v-for="(issue, i) in item.issues" :key="i">{{ issue }}</li>
            </ul>
            <blockquote v-if="item.record" class="hash">
              DATA {{ shortHash(item.record.dataHash) }}
              <template v-if="item.record.txHash"> · TX {{ shortHash(item.record.txHash) }}</template>
              · <em>{{ item.record.status }}</em>
            </blockquote>
          </li>
        </ul>
      </section>
    </div>
  </main>
</template>

<style scoped>
.page {
  width: min(1180px, calc(100% - 2.5rem));
  margin: auto;
  padding: 2rem 0 4rem
}

.back {
  border: 0;
  background: none;
  color: #0f766e;
  font-weight: 700;
  cursor: pointer;
  margin-bottom: 1rem
}

.page>header,
.modal header,
.top,
article footer,
form footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem
}

.actions {
  display: flex;
  gap: .6rem;
  flex-wrap: wrap
}

.eyebrow {
  color: #0f766e;
  font-weight: 800;
  margin: 0 0 .3rem
}

h1 {
  margin: 0
}

.notice {
  padding: .8rem 1rem;
  border-radius: 10px
}

.success {
  background: #ecfdf5;
  color: #047857
}

.error,
.form-error {
  background: #fef2f2;
  color: #b91c1c
}

.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
  margin-top: 1.5rem
}

article,
.empty {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 18px;
  padding: 1.25rem
}

article .top span {
  font-size: .75rem;
  padding: .3rem .55rem;
  border-radius: 99px
}

.top span.ok {
  background: #ecfdf5;
  color: #047857
}

.top span.no {
  background: #f1f5f9;
  color: #64748b
}

.when {
  color: #64748b;
  font-size: .85rem;
  margin: .4rem 0 0
}

article footer {
  margin-top: .8rem
}

dl div {
  display: flex;
  justify-content: space-between;
  border-top: 1px solid #f1f5f9;
  padding: .6rem 0
}

dd {
  margin: 0;
  font-weight: 600
}

.hash {
  font-size: .72rem;
  color: #0f766e;
  background: #f0fdfa;
  border: 1px solid #ccfbf1;
  border-radius: 8px;
  padding: .4rem .55rem;
  margin: .6rem 0 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  word-break: break-all
}

.verify-badge {
  font-size: .72rem;
  font-weight: 700;
  padding: .3rem .55rem;
  border-radius: 99px;
  margin: .6rem 0 0;
  display: inline-block
}

.verify-badge.synced {
  background: #ecfdf5;
  color: #047857
}

.verify-badge.desynced {
  background: #fef2f2;
  color: #b91c1c
}

.empty {
  text-align: center;
  margin-top: 1.5rem;
  padding: 4rem
}

.backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: #0f172a88;
  display: grid;
  place-items: center;
  padding: 1rem
}

.modal {
  background: #fff;
  border-radius: 18px;
  padding: 1.5rem;
  width: min(700px, 100%);
  max-height: 90vh;
  overflow: auto
}

.modal header button {
  border: 0;
  border-radius: 50%;
  font-size: 1.4rem;
  width: 34px;
  height: 34px
}

.modal form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem
}

.modal label {
  display: grid;
  gap: .4rem;
  font-weight: 700;
  font-size: .86rem
}

.modal .full {
  grid-column: 1/-1
}

.modal input,
.modal select,
.modal textarea {
  padding: .75rem;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  font: inherit
}

.form-error,
.modal form footer {
  grid-column: 1/-1;
  margin: 0;
  padding: .7rem;
  border-radius: 8px
}

.form-error {
  grid-column: 1/-1
}

.summary {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
  margin: 1rem 0
}

.summary>div {
  text-align: center;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  padding: 1rem
}

.summary strong {
  display: block;
  font-size: 1.6rem
}

.summary span {
  color: #64748b;
  font-size: .8rem
}

.summary .ok strong {
  color: #047857
}

.summary .err strong {
  color: #b91c1c
}

.verify-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: .8rem
}

.verify-list>li {
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  padding: 1rem
}

.verify-list>li.desynced {
  border-color: #fecaca;
  background: #fef2f2
}

.v-top {
  display: flex;
  justify-content: space-between;
  align-items: center
}

.v-top span {
  font-size: .72rem;
  font-weight: 700;
  padding: .25rem .5rem;
  border-radius: 99px
}

.verify-list li.synced .v-top span {
  background: #ecfdf5;
  color: #047857
}

.verify-list li.desynced .v-top span {
  background: #fee2e2;
  color: #b91c1c
}

.issues {
  color: #b91c1c;
  font-size: .8rem;
  margin: .5rem 0 0;
  padding-left: 1.1rem
}

@media(max-width:800px) {
  .grid {
    grid-template-columns: 1fr 1fr
  }
}

@media(max-width:600px) {

  .grid,
  .modal form,
  .summary {
    grid-template-columns: 1fr
  }

  .page>header {
    align-items: stretch;
    flex-direction: column
  }

  /* Bổ sung Badge cho trạng thái PENDING ở màn hình ngoài */
  .verify-badge.pending {
    background: #fffbeb;
    color: #d97706;
  }

  /* Bổ sung CSS cho thẻ <li> trong Modal khi ở trạng thái PENDING */
  .verify-list>li.pending {
    border-color: #fde68a;
    background: #fffbeb;
  }

  /* Bổ sung huy hiệu PENDING bên trong Modal */
  .verify-list li.pending .v-top span {
    background: #fef3c7;
    color: #d97706;
  }

  /* Đổi màu chữ báo lỗi thành màu cam nếu lỗi đó là do đang chờ Blockchain */
  .issues.pending-text {
    color: #d97706;
  }
}
</style>
