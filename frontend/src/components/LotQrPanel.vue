<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import QRCode from 'qrcode'
import { VaAlert, VaButton, VaTextarea } from 'vuestic-ui'
import { api } from '../api/client'
import type { LotQr, LotQrResponse } from '../types/trace'

const props = defineProps<{ farmId: string; pondId: string; batchId: string; lotId: string; lotCode: string }>()
const router = useRouter()
const qr = ref<LotQr | null>(null)
const loading = ref(false)
const loaded = ref(false)
const saving = ref(false)
const error = ref('')
const imageError = ref('')
const reason = ref('')
const imageUrl = ref('')
let requestVersion = 0
let imageVersion = 0
const path = computed(() => `/farms/${props.farmId}/ponds/${props.pondId}/batches/${props.batchId}/lots/${props.lotId}/qr`)
const publicUrl = computed(() => qr.value ? new URL(router.resolve({ name: 'trace', params: { traceCode: qr.value.trace_code } }).href, window.location.origin).href : '')
const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)

function clearImage() {
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value)
  imageUrl.value = ''
}
async function generateImage() {
  const version = ++imageVersion
  clearImage()
  imageError.value = ''
  if (!publicUrl.value || qr.value?.status !== 'ACTIVE') return
  try {
    const svg = await QRCode.toString(publicUrl.value, { type: 'svg', margin: 4, errorCorrectionLevel: 'M', width: 320 })
    if (version === imageVersion) imageUrl.value = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  } catch { if (version === imageVersion) imageError.value = 'Không tạo được ảnh QR. Vui lòng thử lại.' }
}
watch([publicUrl, () => qr.value?.status], generateImage)
async function load() {
  const version = ++requestVersion
  loading.value = true; loaded.value = false; error.value = ''; qr.value = null; reason.value = ''
  try {
    const result = await api.get<LotQrResponse>(path.value)
    if (version === requestVersion) { qr.value = result.qr; loaded.value = true }
  } catch (e) { if (version === requestVersion) error.value = e instanceof Error ? e.message : 'Không tải được QR.' }
  finally { if (version === requestVersion) loading.value = false }
}
async function update(revoke = false) {
  if (saving.value || !loaded.value || (revoke && (reason.value.trim().length < 3 || reason.value.trim().length > 500))) return
  saving.value = true; error.value = ''
  const version = requestVersion
  try {
    const result = await api.post<LotQrResponse>(`${path.value}${revoke ? '/revoke' : ''}`, revoke ? { reason: reason.value.trim() } : undefined)
    if (version === requestVersion) { qr.value = result.qr; reason.value = '' }
  } catch (e) { if (version === requestVersion) error.value = e instanceof Error ? e.message : 'Không cập nhật được QR.' }
  finally { saving.value = false }
}
watch(path, load, { immediate: true })
onBeforeUnmount(() => { requestVersion++; imageVersion++; clearImage() })
</script>

<template>
  <section class="qr-panel" aria-label="QR công khai của lô" :aria-busy="loading || saving">
    <h4>QR truy xuất công khai</h4>
    <p v-if="loading" role="status">Đang tải trạng thái QR…</p>
    <va-alert v-if="error" color="danger" role="alert">{{ error }}</va-alert>
    <va-button v-if="!loading && !loaded" size="small" @click="load">Thử lại</va-button>
    <template v-if="loaded">
      <template v-if="!qr">
        <p>Lô chưa được công khai. Phát hành QR sẽ cho phép bất kỳ ai có đường dẫn xem hồ sơ truy xuất của lô.</p>
        <va-button size="small" :loading="saving" :disabled="saving" @click="update()">Phát hành QR công khai</va-button>
      </template>
      <template v-else-if="qr.status === 'REVOKED'">
        <va-alert color="warning">QR đã thu hồi. Không thể phát hành lại QR cho lô này.</va-alert>
        <p v-if="qr.revocation_reason">Lý do thu hồi: {{ qr.revocation_reason }}</p>
      </template>
      <template v-else>
        <p>QR đang công khai. Đường dẫn giữ nguyên khi hành trình được cập nhật.</p>
        <va-alert v-if="localHost" color="warning">Đây là địa chỉ localhost, thiết bị khác không thể mở. Chỉ in QR khi ứng dụng được mở tại địa chỉ công khai ổn định.</va-alert>
        <p>Trước khi in, kiểm tra địa chỉ hosting công khai và khả năng mở trực tiếp đường dẫn truy xuất.</p>
        <img v-if="imageUrl" :src="imageUrl" :alt="`QR truy xuất lô ${lotCode}`" width="240" height="240" />
        <va-alert v-if="imageError" color="danger">{{ imageError }}</va-alert>
        <va-button v-if="imageError" size="small" @click="generateImage">Tạo lại ảnh QR</va-button>
        <a class="trace-url" :href="publicUrl" target="_blank" rel="noopener noreferrer">Xem hồ sơ công khai: {{ publicUrl }}</a>
        <a v-if="imageUrl" class="download" :href="imageUrl" :download="`lot-${qr.trace_code}.svg`">Tải QR SVG</a>
        <form class="revoke-form" @submit.prevent="update(true)">
          <p>Thu hồi sẽ ngừng công khai hồ sơ ngay và không thể hoàn tác.</p>
          <va-textarea v-model="reason" label="Lý do thu hồi (3–500 ký tự)" :disabled="saving" maxlength="500" />
          <va-button type="submit" size="small" color="danger" :loading="saving" :disabled="saving || reason.trim().length < 3 || reason.trim().length > 500">Thu hồi QR</va-button>
        </form>
      </template>
    </template>
  </section>
</template>

<style scoped>
.qr-panel { display: grid; gap: .75rem; border-top: 1px solid #e5eeec; margin-top: 1rem; padding-top: 1rem; }
.qr-panel h4 { font-weight: 700; }
.qr-panel img { max-width: 100%; height: auto; background: white; }
.trace-url { overflow-wrap: anywhere; color: #0d6d64; }
.download { color: #0d6d64; font-weight: 700; text-decoration: underline; }
.revoke-form { display: grid; gap: .65rem; margin-top: .5rem; }
</style>
