<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { 
  VaButton, VaInnerLoading, VaModal, VaInput, VaSwitch, 
  VaAlert, VaCard, VaCardTitle, VaCardContent, VaBadge, VaIcon 
} from 'vuestic-ui'
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

const formTitle = computed(() => (editingId.value ? 'Cập nhật cơ sở nuôi' : 'Tạo cơ sở nuôi mới'))

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
      successMessage.value = 'Đã cập nhật cơ sở nuôi thành công.'
    } else {
      await farmsStore.create(payload)
      successMessage.value = 'Đã tạo cơ sở nuôi mới thành công.'
    }
    closeForm()
  } catch {
    formError.value = error.value
  }
}

async function removeFarm(farm: Farm) {
  if (!window.confirm(`Bạn có chắc chắn muốn xóa cơ sở “${farm.farm_name}”? Mọi dữ liệu liên quan có thể bị mất.`)) return
  successMessage.value = ''
  try {
    await farmsStore.remove(farm.id)
    successMessage.value = 'Đã xóa cơ sở nuôi thành công.'
  } catch {
    // Store sẽ xử lý hiển thị lỗi
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
      <div class="header-content">
        <p class="eyebrow">Quản lý vùng nuôi</p>
        <h1 class="page-title">Cơ sở nuôi của tôi</h1>
        <div class="subtitle-badge">
          <va-icon name="domain" size="small" class="mr-1" />
          <template v-if="authStore.organizationName">{{ authStore.organizationName }}</template>
          <template v-else>Hộ nuôi độc lập</template>
        </div>
      </div>
      <va-button icon="add" gradient class="shadow-md" @click="openCreate">
        Thêm cơ sở mới
      </va-button>
    </header>

    <!-- Thông báo -->
    <va-alert v-if="successMessage" color="success" class="mb-4" icon="check_circle" outline closeable>
      {{ successMessage }}
    </va-alert>
    <va-alert v-if="error" color="danger" class="mb-4" icon="warning" outline closeable>
      {{ error }}
    </va-alert>

    <section class="farms-panel">
      <va-inner-loading :loading="loading">
        <!-- Empty State -->
        <div v-if="!loading && items.length === 0" class="empty-state">
          <div class="empty-icon-wrapper">
            <va-icon name="water" size="3rem" color="primary" />
          </div>
          <h2>Bạn chưa có cơ sở nuôi nào</h2>
          <p class="text-secondary">Hãy tạo cơ sở đầu tiên để bắt đầu quản lý ao và theo dõi vụ nuôi.</p>
          <va-button icon="add" class="mt-4" @click="openCreate">Tạo cơ sở ngay</va-button>
        </div>

        <!-- Farm Grid -->
        <div v-else class="farm-grid">
          <va-card v-for="farm in items" :key="farm.id" class="farm-card hover-elevation">
            <va-card-content>
              <div class="card-header">
                <div class="farm-icon-box">
                  <va-icon name="home_work" size="large" color="primary" />
                </div>
                <va-badge 
                  :color="farm.status ? 'success' : 'secondary'" 
                  :text="farm.status ? 'Hoạt động' : 'Tạm ngưng'"
                  class="status-badge"
                />
              </div>

              <div class="card-body">
                <h3 class="farm-title">{{ farm.farm_name }}</h3>
                <p class="address-text">
                  <va-icon name="place" size="small" color="secondary" class="mr-1" />
                  {{ farm.address || 'Chưa cập nhật địa chỉ' }}
                </p>

                <div class="stats-grid">
                  <div class="stat-item">
                    <span class="stat-label">Diện tích</span>
                    <span class="stat-value">{{ formatArea(farm.area) }}</span>
                  </div>
                  <div class="stat-item">
                    <span class="stat-label">Chứng nhận</span>
                    <span class="stat-value highlight">{{ farm.certification || 'Chưa có' }}</span>
                  </div>
                </div>
              </div>
            </va-card-content>

            <!-- Card Actions -->
            <div class="card-actions-custom">
              <va-button 
                preset="primary" 
                icon="water" 
                class="flex-1"
                @click="router.push({ name: 'ponds', params: { farmId: farm.id } })"
              >
                Quản lý Ao
              </va-button>
              <va-button preset="secondary" icon="edit" color="info" @click="openEdit(farm)" />
              <va-button preset="secondary" icon="delete" color="danger" @click="removeFarm(farm)" />
            </div>
          </va-card>
        </div>
      </va-inner-loading>
    </section>

    <!-- Vuestic Modal Form -->
    <va-modal v-model="showForm" hide-default-actions overlay-opacity="0.5">
      <template #header>
        <h2 class="modal-title">{{ formTitle }}</h2>
      </template>
      
      <form @submit.prevent="submit" class="modern-form">
        <va-input 
          v-model="form.farmName" 
          label="Tên cơ sở nuôi *" 
          placeholder="VD: Cơ sở nuôi tôm Minh Hải" 
          class="col-span-2"
          :rules="[(v) => !!v || 'Vui lòng nhập tên cơ sở']"
        />
        
        <va-input 
          v-model="form.address" 
          label="Địa chỉ" 
          placeholder="Xã, Huyện, Tỉnh" 
          class="col-span-2"
        >
          <template #prependInner>
            <va-icon name="place" color="secondary" size="small" />
          </template>
        </va-input>
        
        <va-input 
          v-model="form.area" 
          label="Diện tích (ha)" 
          type="number" 
          placeholder="VD: 12.5"
          :min="0.01"
          :step="0.01"
        />
        
        <va-input 
          v-model="form.certification" 
          label="Chứng nhận" 
          placeholder="VD: VietGAP, ASC..." 
        />
        
        <div v-if="editingId" class="col-span-2 switch-wrapper">
          <va-switch 
            v-model="form.status" 
            size="small"
            :label="form.status ? 'Cơ sở đang hoạt động' : 'Tạm ngưng hoạt động'" 
            :color="form.status ? 'success' : 'secondary'"
          />
        </div>

        <va-alert v-if="formError" color="danger" outline size="small" class="col-span-2 mt-2">
          {{ formError }}
        </va-alert>

        <div class="form-actions col-span-2">
          <va-button preset="secondary" type="button" color="secondary" @click="closeForm">
            Hủy bỏ
          </va-button>
          <va-button type="submit" :loading="saving" color="primary">
            {{ editingId ? 'Lưu thay đổi' : 'Hoàn tất tạo' }}
          </va-button>
        </div>
      </form>
    </va-modal>
  </main>
</template>

<style scoped>
.farms-page { 
  width: min(1180px, calc(100% - 2rem)); 
  margin: 0 auto; 
  padding: 2.5rem 0 4rem; 
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
}

/* Header Styles */
.page-header { 
  display: flex; 
  justify-content: space-between; 
  align-items: flex-end; 
  gap: 1rem; 
  margin-bottom: 2rem; 
}
.eyebrow { 
  margin: 0 0 0.5rem; 
  color: var(--va-primary); 
  font-size: 0.8rem; 
  font-weight: 700; 
  letter-spacing: 0.1em; 
  text-transform: uppercase; 
}
.page-title { 
  margin: 0 0 0.5rem; 
  font-size: clamp(1.8rem, 4vw, 2.2rem); 
  font-weight: 800;
  color: #1e293b;
}
.subtitle-badge { 
  display: inline-flex;
  align-items: center;
  color: #475569; 
  background: #f1f5f9;
  padding: 0.4rem 0.8rem;
  border-radius: 99px;
  font-size: 0.875rem;
  font-weight: 500;
}

/* Grid & Cards */
.farms-panel { min-height: 300px; } 
.farm-grid { 
  display: grid; 
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); 
  gap: 1.5rem; 
}

.farm-card {
  border-radius: 16px;
  border: 1px solid #e2e8f0;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03) !important;
  transition: all 0.2s ease-in-out;
  display: flex;
  flex-direction: column;
}
.farm-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04) !important;
  border-color: var(--va-primary);
}

.card-header { 
  display: flex; 
  align-items: flex-start; 
  justify-content: space-between; 
  margin-bottom: 1rem;
}
.farm-icon-box { 
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px; 
  height: 48px; 
  border-radius: 12px; 
  background: #f0fdfa; /* Light teal matching primary */
}
.status-badge { font-weight: 600; letter-spacing: 0.3px; }

.farm-title { 
  margin: 0 0 0.5rem; 
  font-size: 1.25rem; 
  font-weight: 700;
  color: #0f172a;
}
.address-text { 
  display: flex;
  align-items: flex-start;
  color: #64748b; 
  font-size: 0.9rem;
  min-height: 2.5rem; 
  margin: 0 0 1.5rem 0;
  line-height: 1.4;
}

.stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  padding-top: 1rem;
  border-top: 1px dashed #e2e8f0;
}
.stat-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.stat-label { font-size: 0.8rem; color: #64748b; }
.stat-value { font-weight: 600; color: #1e293b; }
.stat-value.highlight { color: var(--va-primary); }

.card-actions-custom { 
  display: flex; 
  align-items: center; 
  gap: 0.5rem; 
  padding: 1rem 1.25rem;
  background: #f8fafc;
  border-top: 1px solid #f1f5f9;
  border-radius: 0 0 16px 16px;
  margin-top: auto;
}
.flex-1 { flex: 1; }

/* Empty State */
.empty-state { 
  padding: 5rem 1rem; 
  text-align: center; 
  background: #f8fafc; 
  border: 2px dashed #cbd5e1; 
  border-radius: 20px; 
  display: flex;
  flex-direction: column;
  align-items: center;
}
.empty-icon-wrapper {
  width: 80px; height: 80px;
  background: #e0f2fe;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 1.5rem;
}
.empty-state h2 { margin: 0 0 0.5rem; font-size: 1.5rem; color: #1e293b; }
.text-secondary { color: #64748b; margin: 0; }

/* Modal & Form */
.modal-title { font-size: 1.4rem; font-weight: 700; color: #0f172a; margin-bottom: 1rem; }
.modern-form { 
  display: grid; 
  grid-template-columns: 1fr 1fr; 
  gap: 1.25rem; 
  width: 100%;
  min-width: 450px;
}
.col-span-2 { grid-column: 1 / -1; }
.switch-wrapper {
  padding: 0.75rem;
  background: #f8fafc;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
}
.form-actions { 
  display: flex; 
  justify-content: flex-end; 
  gap: 1rem; 
  margin-top: 1rem; 
  padding-top: 1rem;
  border-top: 1px solid #f1f5f9;
}

/* Utilities */
.mr-1 { margin-right: 0.25rem; }
.mb-4 { margin-bottom: 1rem; }
.mt-4 { margin-top: 1rem; }
.mt-2 { margin-top: 0.5rem; }

/* Responsive */
@media (max-width: 768px) { 
  .page-header { flex-direction: column; align-items: flex-start; } 
  .farm-grid { grid-template-columns: 1fr; } 
  .modern-form { grid-template-columns: 1fr; min-width: 100%; }
  .col-span-2 { grid-column: auto; }
}
</style>