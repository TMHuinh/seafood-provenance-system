<script setup lang="ts">
import { VaBadge, VaCard, VaCardContent } from 'vuestic-ui'
import { SPECIES_LABELS, STATUS_LABELS, type BatchVersion } from '../../types'

defineProps<{ versions: BatchVersion[]; loading?: boolean }>()
const day = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' })
const dateOnly = (value: string | null | undefined) => value ? day.format(new Date(value)) : '—'
</script>

<template>
        <div class="version-list">
          <va-card v-for="version in versions" :key="version.id" class="version-card">
            <va-card-content>
              <div class="version-heading">
                <strong>Phiên bản {{ version.version_number }}</strong>
                <time :datetime="version.created_at">{{ dateOnly(version.created_at) }}</time>
                <va-badge :color="version.blockchain?.status === 'SUCCESS' ? 'success' : 'warning'" :text="version.blockchain?.status === 'SUCCESS' ? 'Đã ghi blockchain' : 'Chưa xác nhận'" />
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
          <p v-if="!loading && !versions.length" class="text-secondary">Chưa có dữ liệu lịch sử.</p>
        </div>
</template>

<style scoped>
.version-list {
  display: grid;
  gap: 1rem;
}

.version-card {
  border: 1px solid var(--app-line);
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
  color: var(--app-muted);
  font-size: 0.85rem;
}


.version-heading { flex-wrap: wrap; }
</style>
