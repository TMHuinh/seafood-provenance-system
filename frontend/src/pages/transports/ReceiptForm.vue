<script setup lang="ts">
import { computed, ref } from 'vue'
import { VaButton } from 'vuestic-ui'
import { RECEIPT_LABELS, type LotTransport, type ReceiptInput, type ReceiptOutcome } from '../../types'

const props = defineProps<{ trip: LotTransport; busy: boolean; error: string }>()
const emit = defineEmits<{ confirm: [receipt: ReceiptInput] }>()
const outcome = ref<ReceiptOutcome | null>(null)
const measured = ref('')
const note = ref('')
const weightInput = ref<HTMLInputElement | null>(null)
const reasonInput = ref<HTMLTextAreaElement | null>(null)
const localError = ref('')
const kg = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 })
const sent = computed(() => Number(props.trip.quantity))
const received = computed(() => {
  if (outcome.value === 'FULL') return sent.value
  if (outcome.value === 'REJECTED') return 0
  const raw = measured.value.trim()
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(raw)) return null
  const value = Number(raw.replace(',', '.'))
  return value > 0 && value < sent.value ? value : null
})

function save() {
  localError.value = ''
  if (props.busy || !outcome.value) return
  if (received.value === null) {
    localError.value = 'Nhập khối lượng lớn hơn 0, nhỏ hơn khối lượng gửi và có tối đa 2 chữ số thập phân.'
    weightInput.value?.focus()
    return
  }
  if (outcome.value !== 'FULL' && !note.value.trim()) {
    localError.value = 'Vui lòng ghi lý do để nông hộ và tài xế cùng đối chiếu.'
    reasonInput.value?.focus()
    return
  }
  emit('confirm', { receiptOutcome: outcome.value, receivedQuantity: received.value, note: note.value.trim() })
}
</script>

<template>
  <form class="receipt-form" @submit.prevent="save" @input="localError = ''">
    <header><h3>Phiếu thực nhận</h3><p>Đối chiếu hàng tại kho trước khi chốt phiếu.</p></header>
    <fieldset :disabled="busy">
      <legend>Kết quả kiểm nhận</legend>
      <div class="choices">
        <label v-for="(label, key) in RECEIPT_LABELS" :key="key" :class="{ chosen: outcome === key }">
          <input v-model="outcome" type="radio" name="receipt-outcome" :value="key" required />
          {{ label }}
        </label>
      </div>
      <label v-if="outcome === 'PARTIAL'" class="entry">
        Khối lượng thực nhận (kg)
        <input ref="weightInput" v-model="measured" inputmode="decimal" type="text" placeholder="Ví dụ 92,5"
          :aria-invalid="!!localError && received === null" aria-describedby="receipt-weight-hint" />
        <small id="receipt-weight-hint">Nhập số kg đã cân, tối đa 2 chữ số thập phân.</small>
      </label>
      <dl class="weights" aria-live="polite" aria-atomic="true">
        <div><dt>Đã gửi</dt><dd>{{ kg.format(sent) }} kg</dd></div>
        <div><dt>Thực nhận</dt><dd>{{ received === null ? '—' : kg.format(received) + ' kg' }}</dd></div>
        <div><dt>Chênh lệch</dt><dd>{{ received === null ? '—' : kg.format(sent - received) + ' kg' }}</dd></div>
      </dl>
      <label v-if="outcome" class="entry">
        {{ outcome === 'FULL' ? 'Ghi chú (tùy chọn)' : 'Lý do (bắt buộc)' }}
        <textarea ref="reasonInput" v-model="note" rows="2" maxlength="1000" :aria-required="outcome !== 'FULL'"
          :aria-invalid="!!localError && received !== null && !note.trim()" />
      </label>
    </fieldset>
    <p v-if="localError || error" role="alert" class="form-error">{{ localError || error }}</p>
    <div class="actions"><va-button type="submit" :loading="busy" :disabled="busy"
      :color="outcome === 'REJECTED' ? 'danger' : 'primary'">
      {{ outcome === 'REJECTED' ? 'Xác nhận từ chối nhận' : 'Lưu phiếu thực nhận' }}
    </va-button></div>
  </form>
</template>

<style scoped>
.receipt-form { padding: clamp(16px, 4vw, 24px); border: 1px solid var(--app-line); border-top: 3px solid var(--app-primary); border-radius: var(--app-radius); background: var(--app-surface); }
.receipt-form h3 { margin: 0; font-size: 1.2rem; }
header p, small, dt { color: var(--app-muted); }
header p { margin: 4px 0 18px; }
fieldset { min-width: 0; padding: 0; border: 0; margin: 0; }
legend, .entry { font-size: .9rem; font-weight: 650; }
.choices { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0 16px; }
.choices label { display: flex; align-items: center; flex: 1 1 auto; gap: 8px; min-height: 44px; padding: 6px 12px; border: 1px solid var(--app-control-line); border-radius: var(--app-control-radius); cursor: pointer; }
.chosen { background: var(--app-primary-soft); color: var(--app-primary-dark); border-color: var(--app-primary) !important; }
input[type=radio] { accent-color: var(--app-primary); }
.entry { display: grid; gap: 6px; margin-top: 12px; }
.entry input, textarea { width: 100%; box-sizing: border-box; padding: 10px 12px; min-height: 44px; font: inherit; font-weight: 400; font-size: 1rem; border: 1px solid var(--app-control-line); border-radius: var(--app-control-radius); color: var(--app-ink); background: var(--app-surface); }
textarea { resize: vertical; }
:focus-visible { outline: 2px solid var(--app-primary); outline-offset: 2px; }
small { font-weight: 400; }
.weights { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 14px 0; padding: 14px; border-radius: var(--app-control-radius); background: var(--app-canvas); }
.weights dt { font-size: .8rem; }
.weights dd { margin: 4px 0 0; font-weight: 700; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.actions { display: flex; justify-content: flex-end; margin-top: 16px; }
.form-error { color: var(--app-danger); margin-top: 10px; }
@media (max-width: 500px) { .actions :deep(.va-button) { width: 100%; } .weights { padding: 10px; } }
</style>
