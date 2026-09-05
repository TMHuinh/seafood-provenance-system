<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { VaButton, VaInnerLoading } from 'vuestic-ui'
import { useRouter } from 'vue-router'

import { useAuthStore } from '../../stores/auth.store'
import { useFarmsStore } from '../../stores/farms.store'
import type { Farm, FarmInput } from '../../types'

const authStore = useAuthStore()
const farmsStore = useFarmsStore()
const router = useRouter()
const { items, loading, saving, error } = storeToRefs(farmsStore)

const showForm = ref(false)
const editingId = ref<string | null>(null)
const formError = ref('')
const successMessage = ref('')

const form = reactive({
  farmName: '',
  address: '',
  area: '',
  certification: '',
  status: true,
})

const formTitle = computed(() => (editingId.value ? 'Cập nhật cơ sở nuôi' : 'Tạo cơ sở nuôi'))

function resetForm() {
  editingId.value = null
  form.farmName = ''
  form.address = ''
  form.area = ''
  form.certification = ''
  form.status = true
  formError.value = ''
}

function openCreate() {
  resetForm()
  showForm.value = true
}

function openEdit(farm: Farm) {
  editingId.value = farm.id
  form.farmName = farm.farm_name
  form.address = farm.address ?? ''
  form.area = farm.area?.toString() ?? ''
  form.certification = farm.certification ?? ''
  form.status = farm.status
  formError.value = ''
  showForm.value = true
}

function closeForm() {
  showForm.value = false
  resetForm()
}

function optionalNumber(value: string | number): number | null {
  if (value === '' || value === null || value === undefined) return null
  const normalized = Number(value)
  return Number.isFinite(normalized) ? normalized : null
}

async function submit() {
  formError.value = ''
  successMessage.value = ''
  if (!form.farmName.trim()) {
    formError.value = 'Vui lòng nhập tên cơ sở nuôi'
    return
  }

  const payload: FarmInput = {
    farmName: form.farmName.trim(),
    address: form.address.trim() || null,
    area: optionalNumber(form.area),
    certification: form.certification.trim() || null,
    status: form.status,
  }

  try {
    if (editingId.value) {
      await farmsStore.update(editingId.value, payload)
      successMessage.value = 'Đã cập nhật cơ sở nuôi'
    } else {
      await farmsStore.create(payload)
      successMessage.value = 'Đã tạo cơ sở nuôi mới'
    }
    closeForm()
  } catch {
    formError.value = error.value
  }
}

async function removeFarm(farm: Farm) {
  if (!window.confirm(`Xóa cơ sở “${farm.farm_name}”?`)) return
  successMessage.value = ''
  try {
    await farmsStore.remove(farm.id)
    successMessage.value = 'Đã xóa cơ sở nuôi'
  } catch {
    // Store hiển thị thông báo từ API, gồm trường hợp cơ sở đang có ao nuôi.
  }
}

function formatArea(value: number | null): string {
  return value === null ? 'Chưa cập nhật' : `${new Intl.NumberFormat('vi-VN').format(value)} ha`
}

onMounted(async () => {
  if (!authStore.user) await authStore.fetchMe()
  await farmsStore.load()
})
</script>

<template>
  <main class="farms-page">
    <header class="page-header">
      <div>
        <p class="eyebrow">Quản lý vùng nuôi</p>
        <h1>Cơ sở nuôi của tôi</h1>
        <p class="subtitle">
          <template v-if="authStore.organizationName">Thuộc {{ authStore.organizationName }}</template>
          <template v-else>Hộ nuôi độc lập</template>
        </p>
      </div>
      <va-button gradient @click="openCreate">+ Thêm cơ sở nuôi</va-button>
    </header>

    <p v-if="successMessage" class="notice success">{{ successMessage }}</p>
    <p v-if="error" class="notice error">{{ error }}</p>

    <section class="farms-panel">
      <va-inner-loading :loading="loading">
        <div v-if="!loading && items.length === 0" class="empty-state">
          <div class="empty-icon">⌂</div>
          <h2>Chưa có cơ sở nuôi</h2>
          <p>Tạo cơ sở đầu tiên để tiếp tục quản lý ao và các vụ nuôi.</p>
          <va-button @click="openCreate">Tạo cơ sở nuôi</va-button>
        </div>

        <div v-else class="farm-grid">
          <article v-for="farm in items" :key="farm.id" class="farm-card">
            <div class="card-top">
              <span class="farm-icon">⌂</span>
              <span class="status" :class="{ inactive: !farm.status }">
                {{ farm.status ? 'Đang hoạt động' : 'Ngừng hoạt động' }}
              </span>
            </div>
            <h2>{{ farm.farm_name }}</h2>
            <p class="address">{{ farm.address || 'Chưa cập nhật địa chỉ' }}</p>
            <dl>
              <div><dt>Diện tích</dt><dd>{{ formatArea(farm.area) }}</dd></div>
              <div><dt>Chứng nhận</dt><dd>{{ farm.certification || 'Chưa có' }}</dd></div>
            </dl>
            <div class="card-actions">
              <va-button size="small" @click="router.push({ name: 'ponds', params: { farmId: farm.id } })">Quản lý ao</va-button>
              <va-button preset="secondary" size="small" @click="openEdit(farm)">Chỉnh sửa</va-button>
              <va-button preset="plain" color="danger" size="small" @click="removeFarm(farm)">Xóa</va-button>
            </div>
          </article>
        </div>
      </va-inner-loading>
    </section>

    <div v-if="showForm" class="modal-backdrop" @click.self="closeForm">
      <section class="farm-modal" role="dialog" aria-modal="true" :aria-label="formTitle">
        <header><div><p class="eyebrow">Thông tin cơ sở</p><h2>{{ formTitle }}</h2></div><button class="close" @click="closeForm">×</button></header>
        <form @submit.prevent="submit">
          <label class="full">Tên cơ sở nuôi <span>*</span><input v-model="form.farmName" maxlength="255" placeholder="VD: Cơ sở nuôi tôm Minh Hải" /></label>
          <label class="full">Địa chỉ<input v-model="form.address" maxlength="255" placeholder="Xã, huyện, tỉnh" /></label>
          <label>Diện tích (ha)<input v-model="form.area" type="number" min="0.01" step="0.01" placeholder="12.5" /></label>
          <label>Chứng nhận<input v-model="form.certification" maxlength="255" placeholder="VietGAP, ASC..." /></label>
          <label v-if="editingId" class="checkbox full"><input v-model="form.status" type="checkbox" /> Cơ sở đang hoạt động</label>
          <p v-if="formError" class="form-error full">{{ formError }}</p>
          <div class="form-actions full"><va-button preset="secondary" type="button" @click="closeForm">Hủy</va-button><va-button type="submit" :loading="saving">{{ editingId ? 'Lưu thay đổi' : 'Tạo cơ sở' }}</va-button></div>
        </form>
      </section>
    </div>
  </main>
</template>

<style scoped>
.farms-page { width: min(1180px, calc(100% - 2.5rem)); margin: 0 auto; padding: 2.5rem 0 4rem; }
.page-header { display: flex; justify-content: space-between; align-items: end; gap: 1rem; margin-bottom: 1.5rem; }
.eyebrow { margin: 0 0 .35rem; color: #0f766e; font-size: .76rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
h1 { margin: 0; font-size: clamp(1.8rem, 4vw, 2.5rem); } .subtitle { color: #64748b; margin: .5rem 0 0; }
.notice { border-radius: 10px; padding: .8rem 1rem; margin: 0 0 1rem; } .notice.error, .form-error { color: #b91c1c; background: #fef2f2; } .notice.success { color: #047857; background: #ecfdf5; }
.farms-panel { min-height: 240px; } .farm-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; }
.farm-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 18px; padding: 1.25rem; box-shadow: 0 10px 30px rgba(15, 23, 42, .05); }
.card-top, .card-actions { display: flex; align-items: center; justify-content: space-between; gap: .5rem; }
.farm-icon { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 12px; background: #ccfbf1; color: #0f766e; font-size: 1.35rem; }
.status { color: #047857; background: #ecfdf5; padding: .3rem .55rem; border-radius: 999px; font-size: .74rem; font-weight: 700; } .status.inactive { color: #64748b; background: #f1f5f9; }
.farm-card h2 { margin: 1rem 0 .25rem; font-size: 1.15rem; } .address { color: #64748b; min-height: 2.5em; margin: 0; }
dl { margin: 1rem 0; border-top: 1px solid #f1f5f9; } dl div { display: flex; justify-content: space-between; gap: 1rem; padding: .65rem 0; border-bottom: 1px solid #f1f5f9; } dt { color: #64748b; } dd { margin: 0; text-align: right; font-weight: 600; }
.empty-state { padding: 4rem 1rem; text-align: center; background: #fff; border: 1px dashed #cbd5e1; border-radius: 18px; } .empty-state h2 { margin: .5rem 0; } .empty-state p { color: #64748b; } .empty-icon { font-size: 2rem; color: #0f766e; }
.modal-backdrop { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; padding: 1rem; background: rgba(15, 23, 42, .55); }
.farm-modal { width: min(620px, 100%); max-height: 90vh; overflow: auto; border-radius: 20px; padding: 1.5rem; background: #fff; box-shadow: 0 24px 70px rgba(15, 23, 42, .25); }
.farm-modal header { display: flex; justify-content: space-between; align-items: start; margin-bottom: 1.25rem; } .farm-modal h2 { margin: 0; } .close { border: 0; background: #f1f5f9; border-radius: 50%; width: 34px; height: 34px; cursor: pointer; font-size: 1.4rem; }
form { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; } label { display: grid; gap: .4rem; color: #334155; font-size: .86rem; font-weight: 700; } label span { color: #dc2626; } .full { grid-column: 1 / -1; }
input:not([type='checkbox']) { width: 100%; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 10px; padding: .75rem .8rem; font: inherit; outline: none; } input:focus { border-color: #0d9488; box-shadow: 0 0 0 3px rgba(13, 148, 136, .12); }
.checkbox { display: flex; grid-auto-flow: column; justify-content: start; align-items: center; } .form-error { margin: 0; border-radius: 8px; padding: .7rem; } .form-actions { display: flex; justify-content: flex-end; gap: .75rem; margin-top: .5rem; }
@media (max-width: 900px) { .farm-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 620px) { .page-header { align-items: stretch; flex-direction: column; } .farm-grid, form { grid-template-columns: 1fr; } .full { grid-column: auto; } }
</style>
