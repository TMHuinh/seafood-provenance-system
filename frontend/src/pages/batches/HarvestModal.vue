<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { VaModal, VaButton, VaInput, VaTextarea, VaSelect, VaAlert, VaInnerLoading, VaCard, VaCardContent, VaBadge } from 'vuestic-ui'
import { api } from '../../api/client'
import { SPECIES_LABELS, type BatchItem, type HarvestLot, type HarvestCreateResponse } from '../../types'

const props = defineProps<{ batch: BatchItem; farmId: string; pondId: string }>()
const emit = defineEmits<{ close: []; updated: [batch: BatchItem] }>()
const lots = ref<HarvestLot[]>([])
const loading = ref(false); const saving = ref(false); const error = ref(''); const notice = ref('')
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const form = reactive({ harvestDate: today, quantity: '' as string | number, isFinal: false, note: '' })
const requestId = ref(crypto.randomUUID())
const options = [{ value: false, label: 'Thu hoạch một phần, tiếp tục nuôi' }, { value: true, label: 'Kết thúc thu hoạch vụ này' }]
const base = `/farms/${props.farmId}/ponds/${props.pondId}/batches/${props.batch.id}/harvests`
const labels: Record<string, string> = { SUCCESS: 'Đã ghi blockchain', PENDING: 'Chưa gửi blockchain', FAILED: 'Ghi blockchain thất bại', UNKNOWN: 'Chưa xác định kết quả' }
const harvestDay = (value: string) => new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(value))

async function load() {
  loading.value = true; error.value = ''
  try { lots.value = (await api.get<{ items: HarvestLot[] }>(base)).items }
  catch (e) { error.value = e instanceof Error ? e.message : 'Không tải được các lô thu hoạch' }
  finally { loading.value = false }
}
async function submit() {
  if (saving.value) return
  error.value = ''; notice.value = ''
  if (!form.harvestDate || !Number.isFinite(Number(form.quantity)) || Number(form.quantity) <= 0) {
    error.value = 'Vui lòng nhập ngày thu hoạch và khối lượng lớn hơn 0.'; return
  }
  saving.value = true
  try {
    const result = await api.post<HarvestCreateResponse>(base, { ...form, quantity: Number(form.quantity), requestId: requestId.value })
    emit('updated', result.batch)
    const lot: HarvestLot = { ...result.lot, harvest: result.harvest,
      blockchain: result.blockchain.status === 'UNKNOWN' ? null : {
        status: result.blockchain.status, transaction_hash: result.blockchain.transactionHash, data_hash: result.blockchain.dataHash,
      } }
    lots.value = [lot, ...lots.value.filter((item) => item.id !== lot.id)]
    notice.value = `Đã lưu thu hoạch và tạo lô ${lot.lot_code}. ${labels[result.blockchain.status]}.`
    requestId.value = crypto.randomUUID(); form.quantity = ''; form.note = ''
  } catch (e) { error.value = e instanceof Error ? e.message : 'Không lưu được thu hoạch' }
  finally { saving.value = false }
}
onMounted(load)
</script>

<template>
  <va-modal :model-value="true" hide-default-actions size="large" :no-dismiss="saving"
    @update:model-value="(value: boolean) => { if (!value && !saving) emit('close') }">
    <template #header><h2>Thu hoạch và lô hàng — {{ batch.batch_code }}</h2></template>
    <p>Mỗi lần thu hoạch tạo một lô riêng. Tổng sản lượng: {{ batch.yield_quantity ?? 0 }} kg.</p>
    <va-alert v-if="error" color="danger" class="message">{{ error }}</va-alert>
    <va-alert v-if="notice" color="info" class="message">{{ notice }} Không cần gửi lại lần thu hoạch đã lưu.</va-alert>
    <form v-if="['GROWING', 'READY_FOR_HARVEST'].includes(batch.status)" class="harvest-form" @submit.prevent="submit">
      <va-input v-model="form.harvestDate" type="date" label="Ngày thu hoạch *" :min="batch.stocking_date.slice(0, 10)" :max="today" :disabled="saving" />
      <va-input v-model="form.quantity" type="number" label="Khối lượng (kg) *" min="0.01" step="0.01" :disabled="saving" />
      <va-select v-model="form.isFinal" :options="options" value-by="value" text-by="label" label="Loại thu hoạch" :disabled="saving" />
      <va-textarea v-model="form.note" label="Ghi chú" maxlength="5000" :disabled="saving" />
      <va-button type="submit" :loading="saving" :disabled="saving">Lưu thu hoạch và tạo lô</va-button>
    </form>
    <p v-else>Vụ hiện không thể ghi thêm thu hoạch.</p>
    <h3>Các lô đã tạo</h3>
    <va-inner-loading :loading="loading">
      <div class="lot-list">
        <va-card v-for="lot in lots" :key="lot.id">
          <va-card-content>
            <strong class="hash">{{ lot.lot_code }}</strong>
            <p>{{ harvestDay(lot.harvest.harvest_date) }} · {{ lot.quantity.toLocaleString('vi-VN') }} kg · {{ lot.harvest.is_final ? 'Kết thúc thu hoạch' : 'Thu một phần' }}</p>
            <p>Nguồn: {{ lot.provenance.farm.name }} / {{ lot.provenance.pond.name }} / {{ lot.provenance.batch.batch_code }}</p>
            <p>{{ SPECIES_LABELS[lot.provenance.batch.species] }} · Giống: {{ lot.provenance.batch.seed_source || 'Chưa ghi nguồn giống' }}</p>
            <p v-if="lot.harvest.note">{{ lot.harvest.note }}</p>
            <va-badge :color="lot.blockchain?.status === 'SUCCESS' ? 'success' : 'warning'">{{ labels[lot.blockchain?.status ?? 'UNKNOWN'] }}</va-badge>
            <p class="hash">Sự kiện: {{ lot.blockchain_event_id }}</p>
            <p v-if="lot.blockchain" class="hash">Hash dữ liệu: {{ lot.blockchain.data_hash }}</p>
            <p v-if="lot.blockchain?.transaction_hash" class="hash">Giao dịch: {{ lot.blockchain.transaction_hash }}</p>
          </va-card-content>
        </va-card>
        <p v-if="!loading && !lots.length">Chưa có lô hàng từ thu hoạch.</p>
      </div>
    </va-inner-loading>
    <va-button preset="secondary" :disabled="saving" @click="emit('close')">Đóng</va-button>
  </va-modal>
</template>

<style scoped>
.harvest-form, .lot-list { display: grid; gap: 1rem; margin: 1rem 0; }
.hash { overflow-wrap: anywhere; }
.message { margin: 1rem 0; }
</style>
