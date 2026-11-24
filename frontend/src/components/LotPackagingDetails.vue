<script setup lang="ts">
import type { LotPackaging } from '../types/trace'

defineProps<{ items: LotPackaging[]; publicView?: boolean }>()
const chainLabels: Record<string, string> = { SUCCESS: 'Đã ghi', PENDING: 'Đang chờ ghi', FAILED: 'Đang chờ thử lại' }
const verificationLabels = {
  MATCH: 'Đã kiểm tra. Thông tin đóng gói và kiểm định khớp với hồ sơ đã lưu.',
  MISMATCH: 'Thông tin đóng gói và kiểm định có sai lệch so với hồ sơ đã lưu. Vui lòng hỏi nhà phân phối.',
  PENDING: 'Thông tin đóng gói và kiểm định đang chờ được kiểm tra.',
  UNAVAILABLE: 'Tạm thời chưa thể kiểm tra thông tin đóng gói và kiểm định. Vui lòng thử lại sau.',
}
const quantityFormat = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 })
const formatDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.split('-').reverse().join('/') : date
</script>

<template>
  <p v-if="!items.length" class="empty">Chưa có hồ sơ đóng gói và kiểm định.</p>
  <div v-else class="records">
    <article v-for="item in items" :key="item.transportCode" class="record">
      <header class="record-header">
        <strong>{{ item.distributorName }}</strong>
        <span>Mã chuyến <code>{{ item.transportCode }}</code></span>
      </header>
      <div class="record-grid">
        <section class="detail">
          <h3>Đóng gói</h3>
          <dl>
            <div><dt>Ngày đóng gói</dt><dd><time :datetime="item.packagedDate">{{ formatDate(item.packagedDate) }}</time></dd></div>
            <div><dt>Khối lượng đóng gói</dt><dd>{{ quantityFormat.format(Number(item.quantity)) }} kg</dd></div>
            <div><dt>Quy cách</dt><dd>{{ item.specification }}</dd></div>
          </dl>
        </section>
        <section class="detail">
          <h3>Kiểm định</h3>
          <dl>
            <div><dt>Ngày kiểm định</dt><dd><time :datetime="item.inspectionDate">{{ formatDate(item.inspectionDate) }}</time></dd></div>
            <div><dt>Đơn vị kiểm định</dt><dd>{{ item.inspectionUnit }}</dd></div>
            <div><dt>Kết quả kiểm định</dt><dd class="inspection-result">{{ item.inspectionResult }}</dd></div>
          </dl>
        </section>
      </div>
      <dl v-if="publicView || item.blockchainStatus || item.transactionHash" class="proof">
        <div v-if="publicView" class="chain-row">
          <dt>Kết quả kiểm tra hồ sơ</dt>
          <dd><span class="chain-status" :data-status="item.verificationStatus ?? 'UNAVAILABLE'">
            {{ item.verificationStatus === 'PENDING' && item.blockchainStatus === 'FAILED'
              ? 'Hệ thống chưa lưu được hồ sơ để kiểm tra và sẽ tự thử lại.'
              : verificationLabels[item.verificationStatus ?? 'UNAVAILABLE'] }}
          </span></dd>
        </div>
        <template v-else>
        <div v-if="item.blockchainStatus" class="chain-row">
          <dt>Trạng thái ghi Blockchain</dt>
          <dd><span class="chain-status" :data-status="item.blockchainStatus">{{ chainLabels[item.blockchainStatus] || 'Chưa xác định' }}</span></dd>
        </div>
        <div v-if="item.transactionHash">
          <dt>Mã giao dịch</dt><dd><code>{{ item.transactionHash }}</code></dd>
        </div>
        </template>
      </dl>
    </article>
  </div>
</template>

<style scoped>
.empty { margin: 0; color: var(--app-muted); }
.records, .record { display: grid; gap: 1rem; min-width: 0; }
.record-header { display: grid; gap: .15rem; overflow-wrap: anywhere; }
.record-header strong { font-size: 1.05rem; }
.record-header span, dt { color: var(--app-muted); font-size: .825rem; }
code { font-size: .8rem; overflow-wrap: anywhere; }
.record-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr));
  gap: .75rem;
}
.detail {
  min-width: 0;
  padding: .9rem 1rem;
  border: 1px solid var(--app-line);
  border-radius: .75rem;
  background: var(--app-canvas);
}
.detail h3 { margin: 0 0 .6rem; color: var(--app-primary-dark); font-size: .95rem; }
dl { display: grid; gap: .55rem; margin: 0; }
dd { margin: 0; color: var(--app-ink); font-weight: 600; overflow-wrap: anywhere; }
.inspection-result { white-space: pre-wrap; }
.proof { border-top: 1px solid var(--app-line); padding-top: .75rem; }
.chain-row { display: flex; align-items: center; flex-wrap: wrap; gap: .25rem .65rem; }
.chain-status { display: inline-block; padding: .15rem .55rem; border-radius: 999px; background: var(--app-canvas); color: var(--app-muted); font-size: .8rem; }
.chain-status:is([data-status='SUCCESS'], [data-status='MATCH']) { background: var(--app-primary-soft); color: var(--app-primary-dark); }
.chain-status:is([data-status='FAILED'], [data-status='PENDING'], [data-status='UNAVAILABLE']) { background: var(--app-warning-soft); color: var(--app-warning); }
.chain-status[data-status='MISMATCH'] { background: var(--app-danger-soft, #fceaea); color: var(--app-danger, #952d2d); }
@media print {
  .detail { break-inside: avoid; background: transparent; }
  .chain-status { padding: 0; }
}
</style>
