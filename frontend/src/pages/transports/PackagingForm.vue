<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { VaButton } from 'vuestic-ui'
import { api } from '../../api/client'
import LotPackagingDetails from '../../components/LotPackagingDetails.vue'
import type { LotPackaging } from '../../types/trace'

const props = defineProps<{ transportId: string; receivedQuantity: number }>()
const emit = defineEmits<{ confirmed: [] }>()
const path = `/transports/${props.transportId}/packaging`
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const form = reactive({ packagedDate: today, quantity: props.receivedQuantity, specification: '', inspectionDate: today, inspectionUnit: '', inspectionResult: '' })
const packaging = ref<LotPackaging | null>(null)
const loaded = ref(false)
const busy = ref(false)
const error = ref('')

async function load() {
  error.value = ''
  try {
    packaging.value = (await api.get<{ packaging: LotPackaging | null }>(path)).packaging
    loaded.value = true
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Không thể tải hồ sơ đóng gói'
  }
}

async function submit() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    packaging.value = (await api.post<{ packaging: LotPackaging }>(path, form)).packaging
    emit('confirmed')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Không thể xác nhận đóng gói'
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>

<template>
  <section class="packaging">
    <h3>Đóng gói và kiểm định</h3>
    <p v-if="error" role="alert">{{ error }}</p>
    <va-button v-if="!loaded && error" preset="secondary" @click="load">Tải lại hồ sơ</va-button>
    <p v-else-if="!loaded" role="status">Đang tải hồ sơ đóng gói…</p>
    <LotPackagingDetails v-else-if="packaging" :items="[packaging]" />
    <form v-else @submit.prevent="submit">
      <label>Ngày đóng gói <input v-model="form.packagedDate" type="date" :max="today" required /></label>
      <label>Khối lượng đóng gói (kg) <input v-model.number="form.quantity" type="number" min="0.01" :max="receivedQuantity" step="0.01" required /></label>
      <label>Quy cách đóng gói <input v-model.trim="form.specification" maxlength="200" required /></label>
      <label>Ngày kiểm định <input v-model="form.inspectionDate" type="date" :max="today" required /></label>
      <label>Đơn vị kiểm định <input v-model.trim="form.inspectionUnit" maxlength="200" required /></label>
      <label>Chỉ tiêu và kết quả kiểm định <textarea v-model.trim="form.inspectionResult" maxlength="1000" required /></label>
      <p>Sau khi xác nhận, hệ thống gửi mã băm lên Blockchain. Thông tin trên sẽ hiển thị cho khách khi quét QR của chuyến phát hành.</p>
      <va-button type="submit" :loading="busy" :disabled="busy">Xác nhận đóng gói</va-button>
    </form>
  </section>
</template>

<style scoped>
.packaging { margin-block: 1rem; }
form, label { display: grid; gap: .5rem; }
form { gap: .9rem; }
input, textarea { padding: .5rem; border: 1px solid var(--app-border, #bec8c3); border-radius: .35rem; }
</style>
