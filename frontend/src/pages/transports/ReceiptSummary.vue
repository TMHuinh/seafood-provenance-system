<script setup lang="ts">
import { computed } from 'vue'
import { RECEIPT_LABELS, type LotTransport } from '../../types'

const props = defineProps<{ trip: LotTransport }>()
const confirmation = computed(() => props.trip.events?.find(event =>
  event.event_type === 'DELIVERED' || event.event_type === 'REJECTED')?.payload.receiverConfirmation)
const note = computed(() => {
  const value = confirmation.value
  return value && typeof value === 'object' && 'note' in value && typeof value.note === 'string' ? value.note : ''
})
const kg = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 })
</script>

<template>
  <section v-if="trip.status === 'DELIVERED' || trip.status === 'REJECTED'" class="receipt" :data-outcome="trip.receipt_outcome">
    <h3>{{ trip.receipt_outcome ? RECEIPT_LABELS[trip.receipt_outcome] : 'Đã xác nhận nhận hàng' }}</h3>
    <dl v-if="trip.received_quantity != null">
      <div><dt>Đã gửi</dt><dd>{{ kg.format(trip.quantity) }} kg</dd></div>
      <div><dt>Thực nhận</dt><dd>{{ kg.format(trip.received_quantity) }} kg</dd></div>
      <div><dt>Chênh lệch</dt><dd>{{ kg.format(trip.quantity - trip.received_quantity) }} kg</dd></div>
    </dl>
    <p v-else>Chưa ghi nhận khối lượng thực nhận.</p>
    <p v-if="note"><strong>{{ trip.receipt_outcome === 'PARTIAL' || trip.receipt_outcome === 'REJECTED' ? 'Lý do' : 'Ghi chú' }}</strong> · {{ note }}</p>
  </section>
</template>

<style scoped>
.receipt { padding: 14px 16px; margin-block: 12px; border: 1px solid var(--app-line); border-inline-start: 3px solid var(--app-success); border-radius: var(--app-control-radius); background: var(--app-surface); overflow-wrap: anywhere; color: var(--app-ink); }
.receipt[data-outcome=PARTIAL] { border-inline-start-color: var(--app-warning); }
.receipt[data-outcome=REJECTED] { border-inline-start-color: var(--app-danger); }
h3 { margin: 0; font-size: 1rem; }
dl { margin: 12px 0 0; display: flex; flex-wrap: wrap; gap: 12px 24px; }
dt { color: var(--app-muted); font-size: .82rem; }
dd { margin: 3px 0 0; font-weight: 700; font-variant-numeric: tabular-nums; }
p { margin: 8px 0 0; white-space: pre-line; }
</style>
