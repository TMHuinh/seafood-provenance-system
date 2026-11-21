<script setup lang="ts">
import { computed } from 'vue'
import { VaIcon } from 'vuestic-ui'
import type { LotTransport } from '../../types'

const props = defineProps<{ trips: LotTransport[] }>()
const pending = computed(() => props.trips
  .filter((trip) => trip.status === 'IN_TRANSIT' && trip.delivery_reported_at)
  .sort((a, b) => Date.parse(a.delivery_reported_at!) - Date.parse(b.delivery_reported_at!))
  .slice(0, 5))
const incoming = computed(() => props.trips
  .filter((trip) => trip.status === 'IN_TRANSIT' && !trip.delivery_reported_at)
  .slice(0, 5))

const milestones = {
  DELIVERY_REPORTED: { label: 'Đã báo giao hàng', icon: 'schedule' },
  DELIVERED: { label: 'Đã xác nhận nhận hàng', icon: 'check_circle' },
} as const
const activity = computed(() => props.trips.flatMap((trip) =>
  (trip.events ?? []).flatMap((event) => {
    const milestone = milestones[event.event_type as keyof typeof milestones]
    return milestone ? [{ trip, event, ...milestone }] : []
  }))
  .sort((a, b) => Date.parse(b.event.occurred_at) - Date.parse(a.event.occurred_at))
  .slice(0, 5))

const groups = computed(() => [
  { title: 'Cần xử lý ngay', subtitle: 'Chuyến đã báo giao và đang chờ xác nhận nhận hàng.', rows: pending.value,
    empty: 'Không có chuyến chờ xác nhận trong danh sách đã tải.', icon: 'bolt', pending: true },
  { title: 'Chuyến hàng đang đến', subtitle: 'Chuyến đang vận chuyển và chưa báo giao.', rows: incoming.value,
    empty: 'Không có chuyến đang đến trong danh sách đã tải.', icon: 'local_shipping', pending: false },
])
const date = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' })
const quantity = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 })
const tripDetail = (id: string) => ({ name: 'receipts', query: { trip: id } })
</script>

<template>
  <div class="distribution-grid">
    <div class="distribution-work">
      <section v-for="group in groups" :key="group.title" class="distribution-panel">
        <header class="panel-heading" :class="{ urgent: group.pending && group.rows.length }">
          <va-icon :name="group.icon" aria-hidden="true" />
          <div>
            <h2>{{ group.title }}</h2>
            <p>{{ group.subtitle }}</p>
          </div>
        </header>
        <p v-if="!group.rows.length" class="empty">{{ group.empty }}</p>
        <ul v-else class="shipments">
          <li v-for="trip in group.rows" :key="trip.id">
            <div>
              <strong>{{ trip.transport_code }}</strong>
              <small>{{ trip.from_location }}</small>
            </div>
            <div>
              <strong>{{ quantity.format(trip.quantity) }} kg</strong>
              <small v-if="group.pending && trip.delivery_reported_at">
                Báo giao {{ date.format(new Date(trip.delivery_reported_at)) }}
              </small>
            </div>
            <span class="status" :class="{ pending: group.pending }">
              {{ group.pending ? 'Chờ xác nhận' : 'Đang vận chuyển' }}
            </span>
            <RouterLink :to="tripDetail(trip.id)" class="details-link" :aria-label="`Xem chi tiết chuyến ${trip.transport_code}`">
              Xem chi tiết
            </RouterLink>
          </li>
        </ul>
      </section>
    </div>

    <section class="distribution-panel">
      <header class="panel-heading">
        <va-icon name="history" aria-hidden="true" />
        <div><h2>Hoạt động gần đây</h2><p>Các mốc báo giao và xác nhận nhận hàng mới nhất.</p></div>
      </header>
      <p v-if="!activity.length" class="empty">Chưa có hoạt động trong danh sách đã tải.</p>
      <ol v-else class="timeline">
        <li v-for="item in activity" :key="item.event.id">
          <span class="event-icon"><va-icon :name="item.icon" aria-hidden="true" /></span>
          <div>
            <RouterLink :to="tripDetail(item.trip.id)">{{ item.trip.transport_code }}</RouterLink>
            <span> · {{ item.label }}</span>
            <time :datetime="item.event.occurred_at">{{ date.format(new Date(item.event.occurred_at)) }}</time>
          </div>
        </li>
      </ol>
    </section>
  </div>
</template>

<style scoped>
.distribution-grid { display: grid; grid-template-columns: minmax(0, 1.85fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.distribution-work { display: grid; gap: 16px; min-width: 0; }
.distribution-panel { min-width: 0; padding: 10px; border: 1px solid var(--app-line); border-radius: var(--app-radius); background: var(--app-surface); overflow-wrap: anywhere; }
.panel-heading { display: flex; align-items: flex-start; gap: 12px; padding: 12px; border-radius: var(--app-control-radius); }
.panel-heading.urgent { background: var(--app-primary-soft); }
.panel-heading > .va-icon, .timeline a { color: var(--app-primary-dark); }
h2 { margin: 0; font-size: 1.1rem; }
p, small, time { color: var(--app-muted); }
p { margin: 4px 0 0; }
small, time { display: block; margin-top: 3px; }
.empty { padding: 14px 12px; }
.shipments, .timeline { margin: 0; padding: 0 12px; list-style: none; }
.shipments li { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) auto auto; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--app-line); }
.shipments li:last-child, .timeline li:last-child { border-bottom: 0; }
.status { justify-self: start; border-radius: var(--app-pill-radius); padding: var(--app-space-1) var(--app-space-2); background: var(--app-info-soft); color: var(--app-info); font-size: .78rem; }
.status.pending { background: var(--app-warning-soft); color: var(--app-warning); }
.details-link { display: inline-flex; min-height: 44px; align-items: center; justify-content: center; padding: 4px 10px; border: 1px solid var(--app-line); border-radius: var(--app-control-radius); color: var(--app-primary-dark); font-weight: 600; font-size: .85rem; }
.details-link:hover { background: var(--app-primary-soft); }
.timeline li { display: flex; align-items: flex-start; gap: 10px; padding: 12px 0; border-bottom: 1px solid var(--app-line); }
.timeline a { font-weight: 700; text-decoration: underline; text-underline-offset: 3px; }
.event-icon { display: grid; place-items: center; flex: 0 0 32px; height: 32px; border-radius: 50%; background: var(--app-primary-soft); color: var(--app-primary-dark); }
@media (max-width: 1050px) {
  .distribution-grid { grid-template-columns: 1fr; }
}
@media (max-width: 620px) {
  .shipments li { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .details-link { justify-self: start; }
}
</style>
