<script setup lang="ts">
import { date, type SharingCandidate } from './model'

defineProps<{ candidates: SharingCandidate[]; disabled?: boolean }>()
const shareLogs = defineModel<boolean>('shareLogs', { required: true })
const sharedBatchIds = defineModel<string[]>('sharedBatchIds', { required: true })
</script>

<template>
  <fieldset class="org-fields" :disabled="disabled">
    <legend>Dữ liệu tùy chọn</legend>
    <label class="org-choice">
      <input v-model="shareLogs" type="checkbox" />
      <span>Nhật ký chi tiết và lịch sử chăm sóc của các vụ đã chia sẻ</span>
    </label>
    <p class="org-muted">Chọn các vụ còn hoạt động đã bắt đầu trước khi gia nhập để chia sẻ thêm.</p>
    <p v-if="!candidates.length" class="org-muted">Không có vụ nuôi nào để chọn.</p>
    <label v-for="batch in candidates" :key="batch.id" class="org-choice">
      <input v-model="sharedBatchIds" type="checkbox" :value="batch.id" />
      <span>{{ batch.batch_code }} · {{ batch.pond_name }} · {{ date(batch.stocking_date) }}</span>
    </label>
  </fieldset>
</template>
