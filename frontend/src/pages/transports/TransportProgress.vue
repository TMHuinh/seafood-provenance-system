<script setup lang="ts">
import { computed } from 'vue'
import { VaIcon } from 'vuestic-ui'
import type { LotTransport } from '../../types'

const props = defineProps<{ job: LotTransport & { claimed_at?: string | null } }>()
const steps = computed(() => {
  const job = props.job
  const hasEvent = (type: string) => job.events?.some((event) => event.event_type === type)
  return [
    { label: 'Đã nhận', done: Boolean(job.claimed_at || job.handler_id || hasEvent('CLAIMED')) },
    { label: 'Khởi hành', done: job.status === 'IN_TRANSIT' || job.status === 'DELIVERED' || hasEvent('IN_TRANSIT') },
    { label: 'Báo giao', done: Boolean(job.delivery_reported_at || hasEvent('DELIVERY_REPORTED')) },
    { label: job.status === 'REJECTED' ? 'Từ chối nhận' : 'Bàn giao', done: job.status === 'DELIVERED' || job.status === 'REJECTED' },
  ]
})
const active = computed(() => ['CANCELLED', 'DELIVERED', 'REJECTED'].includes(props.job.status)
  ? -1
  : steps.value.map((step) => step.done).lastIndexOf(true))
</script>

<template>
  <ol class="journey-progress" aria-label="Tiến trình chuyến vận chuyển">
    <li v-for="(step, index) in steps" :key="step.label" :class="{ done: step.done, connected: index > 0 && step.done && steps[index - 1]?.done }" :aria-current="active === index ? 'step' : undefined">
      <span class="step-icon">
        <va-icon v-if="step.done" name="check" size="14px" aria-hidden="true" />
      </span>
      <span class="step-label">{{ step.label }}<span class="sr-only">{{ step.done ? ' (đã ghi nhận)' : ' (chưa ghi nhận)' }}</span></span>
    </li>
  </ol>
</template>

<style scoped>
.journey-progress { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); width: 100%; min-width: 0; column-gap: 5px; padding: 0; margin: 0; list-style: none; }
.journey-progress li { position: relative; min-width: 0; display: grid; justify-items: center; align-content: start; gap: 6px; text-align: center; color: #486275; }
.journey-progress li + li::before { content: ''; position: absolute; top: 10px; right: calc(50% + 12px); width: calc(100% - 19px); height: 2px; background: var(--app-line); }
.journey-progress li.connected::before { background: var(--app-primary); }
.step-icon { display: grid; place-items: center; width: 22px; height: 22px; border: 2px solid var(--app-line); border-radius: 50%; background: white; }
.done .step-icon { color: white; background: var(--app-primary); border-color: var(--app-primary); }
[aria-current] .step-icon { outline: var(--app-focus-width) solid var(--app-accent); outline-offset: 2px; }
.step-label { font-size: 11px; line-height: 1.4; overflow-wrap: anywhere; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
</style>
