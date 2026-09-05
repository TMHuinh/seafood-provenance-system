<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import { VaButton, VaInnerLoading } from 'vuestic-ui'
import { api, ApiError } from '../../api/client'
import { usePondsStore } from '../../stores/ponds.store'
import type { FarmResponse, Pond, PondInput, PondStatus } from '../../types'

const route = useRoute(); const router = useRouter(); const store = usePondsStore()
const { items, loading, saving, error } = storeToRefs(store)
const farmId = computed(() => String(route.params.farmId)); const farmName = ref('')
const showForm = ref(false); const editingId = ref<string | null>(null); const formError = ref(''); const success = ref('')
const form = reactive({ pondCode: '', pondName: '', area: '' as string | number, depth: '' as string | number, waterType: '', status: 'ACTIVE' as PondStatus })
const statuses: { value: PondStatus; label: string }[] = [{ value: 'ACTIVE', label: 'Đang hoạt động' }, { value: 'INACTIVE', label: 'Ngừng hoạt động' }, { value: 'MAINTENANCE', label: 'Bảo trì' }]
const waterTypes = ['Nước ngọt', 'Nước lợ', 'Nước mặn']
const statusLabels: Record<PondStatus, string> = { ACTIVE: 'Đang hoạt động', INACTIVE: 'Ngừng hoạt động', MAINTENANCE: 'Bảo trì' }
function numberOrNull(value: string | number) { if (value === '') return null; const n = Number(value); return Number.isFinite(n) ? n : null }
function reset() { editingId.value = null; form.pondCode = ''; form.pondName = ''; form.area = ''; form.depth = ''; form.waterType = ''; form.status = 'ACTIVE'; formError.value = '' }
function openCreate() { reset(); showForm.value = true }
function openEdit(pond: Pond) { editingId.value = pond.id; form.pondCode = pond.pond_code; form.pondName = pond.pond_name; form.area = pond.area ?? ''; form.depth = pond.depth ?? ''; form.waterType = pond.water_type ?? ''; form.status = pond.status; showForm.value = true }
function close() { showForm.value = false; reset() }
async function submit() {
  formError.value = ''; success.value = ''
  if (!form.pondCode.trim() || !form.pondName.trim()) { formError.value = 'Vui lòng nhập mã ao và tên ao'; return }
  const payload: PondInput = { pondCode: form.pondCode.trim(), pondName: form.pondName.trim(), area: numberOrNull(form.area), depth: numberOrNull(form.depth), waterType: form.waterType.trim() || null, status: form.status }
  try { if (editingId.value) { await store.update(farmId.value, editingId.value, payload); success.value = 'Đã cập nhật ao nuôi' } else { await store.create(farmId.value, payload); success.value = 'Đã tạo ao nuôi' }; close() }
  catch { formError.value = error.value }
}
async function remove(pond: Pond) { if (!confirm(`Xóa ao “${pond.pond_name}”?`)) return; success.value = ''; try { await store.remove(farmId.value, pond.id); success.value = 'Đã xóa ao nuôi' } catch {} }
onMounted(async () => { try { farmName.value = (await api.get<FarmResponse>(`/farms/${farmId.value}`)).farm.farm_name; await store.load(farmId.value) } catch (e) { if (e instanceof ApiError) store.error = e.message } })
</script>

<template>
  <main class="page">
    <button class="back" @click="router.push({ name: 'farms' })">← Cơ sở nuôi</button>
    <header><div><p class="eyebrow">{{ farmName }}</p><h1>Danh sách ao nuôi</h1></div><va-button gradient @click="openCreate">+ Thêm ao nuôi</va-button></header>
    <p v-if="success" class="notice success">{{ success }}</p><p v-if="error" class="notice error">{{ error }}</p>
    <va-inner-loading :loading="loading">
      <div v-if="!loading && !items.length" class="empty"><h2>Chưa có ao nuôi</h2><p>Thêm ao đầu tiên cho cơ sở này.</p><va-button @click="openCreate">Tạo ao nuôi</va-button></div>
      <div v-else class="grid"><article v-for="pond in items" :key="pond.id"><div class="top"><strong>{{ pond.pond_code }}</strong><span :class="pond.status.toLowerCase()">{{ statusLabels[pond.status] }}</span></div><h2>{{ pond.pond_name }}</h2><dl><div><dt>Diện tích</dt><dd>{{ pond.area === null ? '—' : `${pond.area} ha` }}</dd></div><div><dt>Độ sâu</dt><dd>{{ pond.depth === null ? '—' : `${pond.depth} m` }}</dd></div><div><dt>Loại nước</dt><dd>{{ pond.water_type || '—' }}</dd></div></dl><footer><va-button size="small" @click="router.push({ name: 'pond-batches', params: { farmId, pondId: pond.id } })">Quản lý vụ nuôi</va-button><va-button preset="secondary" size="small" @click="openEdit(pond)">Chỉnh sửa</va-button><va-button preset="plain" color="danger" size="small" @click="remove(pond)">Xóa</va-button></footer></article></div>
    </va-inner-loading>
    <div v-if="showForm" class="backdrop" @click.self="close"><section class="modal"><header><h2>{{ editingId ? 'Cập nhật ao nuôi' : 'Tạo ao nuôi' }}</h2><button @click="close">×</button></header><form @submit.prevent="submit"><label>Mã ao *<input v-model="form.pondCode" maxlength="100" placeholder="AO-01" /></label><label>Tên ao *<input v-model="form.pondName" maxlength="255" placeholder="Ao nuôi số 1" /></label><label>Diện tích (ha)<input v-model="form.area" type="number" min="0.01" step="0.01" /></label><label>Độ sâu (m)<input v-model="form.depth" type="number" min="0.01" step="0.01" /></label><label>Loại nước<select v-model="form.waterType"><option value="">Chọn loại nước</option><option v-for="waterType in waterTypes" :key="waterType" :value="waterType">{{ waterType }}</option></select></label><label>Trạng thái<select v-model="form.status"><option v-for="item in statuses" :key="item.value" :value="item.value">{{ item.label }}</option></select></label><p v-if="formError" class="form-error">{{ formError }}</p><footer><va-button preset="secondary" type="button" @click="close">Hủy</va-button><va-button type="submit" :loading="saving">Lưu</va-button></footer></form></section></div>
  </main>
</template>

<style scoped>
.page{width:min(1180px,calc(100% - 2.5rem));margin:auto;padding:2rem 0 4rem}.back{border:0;background:none;color:#0f766e;font-weight:700;cursor:pointer;margin-bottom:1rem}.page>header,.modal header,.top,article footer,form footer{display:flex;align-items:center;justify-content:space-between;gap:1rem}.eyebrow{color:#0f766e;font-weight:800;margin:0 0 .3rem}h1{margin:0}.notice{padding:.8rem 1rem;border-radius:10px}.success{background:#ecfdf5;color:#047857}.error,.form-error{background:#fef2f2;color:#b91c1c}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin-top:1.5rem}article,.empty{background:#fff;border:1px solid #e2e8f0;border-radius:18px;padding:1.25rem}article h2{font-size:1.15rem}.top span{font-size:.75rem;font-weight:700;padding:.3rem .55rem;border-radius:99px;background:#ecfdf5;color:#047857}.top .inactive{background:#f1f5f9;color:#64748b}.top .maintenance{background:#fff7ed;color:#c2410c}dl div{display:flex;justify-content:space-between;border-top:1px solid #f1f5f9;padding:.6rem 0}dd{margin:0;font-weight:600}.empty{text-align:center;margin-top:1.5rem;padding:4rem}.backdrop{position:fixed;inset:0;z-index:100;background:#0f172a88;display:grid;place-items:center;padding:1rem}.modal{background:#fff;border-radius:18px;padding:1.5rem;width:min(600px,100%)}.modal header button{border:0;background:#f1f5f9;border-radius:50%;font-size:1.4rem;width:34px;height:34px}.modal form{display:grid;grid-template-columns:1fr 1fr;gap:1rem}.modal label{display:grid;gap:.4rem;font-weight:700;font-size:.86rem}.modal input,.modal select{padding:.75rem;border:1px solid #cbd5e1;border-radius:10px;font:inherit}.form-error,.modal form footer{grid-column:1/-1;margin:0;padding:.7rem;border-radius:8px}@media(max-width:800px){.grid{grid-template-columns:1fr 1fr}}@media(max-width:600px){.grid,.modal form{grid-template-columns:1fr}.page>header{align-items:stretch;flex-direction:column}}
</style>
