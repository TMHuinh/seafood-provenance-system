<script setup lang="ts">
import LoadingState from '../../components/LoadingState.vue'
import DecimalField from '../../components/DecimalField.vue'
import PageHeader from '../../components/PageHeader.vue'
import EmptyState from '../../components/EmptyState.vue'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import CollectionToolbar from '../../components/CollectionToolbar.vue'
import { storeToRefs } from 'pinia'
import { 
  VaButton, VaInnerLoading, VaModal, VaInput, VaSwitch, 
  VaAlert, VaCard, VaCardContent, VaBadge, VaIcon
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

const query = ref(''); const filterStatus = ref(''); const listPage = ref(1); const listPageSize = 9
const statuses = [{ value: 'active', label: 'Hoạt động' }, { value: 'inactive', label: 'Tạm ngưng' }]
const filteredItems = computed(() => {
  const term = query.value.trim().toLocaleLowerCase('vi')
  return items.value.filter((farm) => {
    const matchesStatus = !filterStatus.value || filterStatus.value === (farm.status ? 'active' : 'inactive')
    return matchesStatus && `${farm.farm_name} ${farm.address ?? ''}`.toLocaleLowerCase('vi').includes(term)
  })
})
const visibleItems = computed(() => filteredItems.value.slice((listPage.value - 1) * listPageSize, listPage.value * listPageSize))
watch([query, filterStatus], () => { listPage.value = 1 })
watch(() => filteredItems.value.length, (length) => { listPage.value = Math.min(listPage.value, Math.max(1, Math.ceil(length / listPageSize))) })

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
  <main class="farms-page" :aria-busy="loading">
    <PageHeader title="Cơ sở nuôi của tôi" :context="authStore.organizationName || 'Hộ nuôi độc lập'" description="Quản lý cơ sở và truy cập các ao nuôi.">
      <template #actions>
        <va-button icon="add" @click="openCreate">Thêm cơ sở mới</va-button>
      </template>
    </PageHeader>

    <!-- Thông báo -->
    <va-alert v-if="successMessage" color="success" class="mb-4" icon="check_circle" outline closeable role="status">
      {{ successMessage }}
    </va-alert>
    <va-alert v-if="error" color="danger" class="mb-4" icon="warning" outline closeable role="alert">
      {{ error }} <va-button preset="secondary" size="small" @click="farmsStore.load()">Thử lại</va-button>
    </va-alert>

    <section class="farms-panel">
      <CollectionToolbar v-model:query="query" v-model:status="filterStatus" v-model:page="listPage" :statuses="statuses" search-placeholder="Tên cơ sở hoặc địa chỉ…" :total="filteredItems.length" :page-size="listPageSize" :loading="loading" label="cơ sở trong danh sách đã tải" />
    <LoadingState v-if="loading" />
    <va-inner-loading v-else :loading="false">
        <!-- Empty State -->
        <EmptyState v-if="!loading && !error && !items.length" title="Bạn chưa có cơ sở nuôi nào" description="Hãy tạo cơ sở đầu tiên để quản lý ao và theo dõi vụ nuôi." icon="water">
          <va-button icon="add" @click="openCreate">Tạo cơ sở mới</va-button>
        </EmptyState>
        <EmptyState v-else-if="!loading && !error && !filteredItems.length" title="Không có cơ sở phù hợp" description="Thử đổi từ khóa hoặc trạng thái." />

        <!-- Farm Grid -->
        <div v-else class="farm-grid">
          <va-card v-for="farm in visibleItems" :key="farm.id" class="farm-card hover-elevation">
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
                <h2 class="farm-title">{{ farm.farm_name }}</h2>
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
                Quản lý ao
              </va-button>
              <va-button preset="secondary" icon="edit" color="info" aria-label="Chỉnh sửa" @click="openEdit(farm)" />
              <va-button preset="secondary" icon="delete" color="danger" aria-label="Xóa" @click="removeFarm(farm)" />
            </div>
          </va-card>
        </div>
      </va-inner-loading>
    </section>

    <!-- Vuestic Modal Form -->
    <va-modal title="farm-form-title" v-model="showForm" hide-default-actions overlay-opacity="0.5">
      <template #header>
        <h2 id="farm-form-title" class="modal-title">{{ formTitle }}</h2>
      </template>
      
      <form @submit.prevent="submit" class="modern-form">
        <h3 class="form-section-heading">Thông tin cơ sở</h3>
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
        
        <h3 class="form-section-heading">Quy mô và chứng nhận</h3>
        <DecimalField v-model="form.area" label="Diện tích (ha)" placeholder="VD: 12.5" />
        
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

        <va-alert v-if="formError" color="danger" outline size="small" class="col-span-2 mt-2" role="alert">
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
  font-family: inherit;
}

/* Header Styles */

/* Grid & Cards */
.farms-panel { min-height: 300px; } 
.farm-grid { 
  display: grid; 
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); 
  gap: 1.5rem; 
}

.farm-card {
  border-radius: 16px;
  border: 1px solid var(--app-line);
  box-shadow: none;
  transition: border-color var(--app-motion);
  display: flex;
  flex-direction: column;
}
.farm-card:hover {
  transform: none;
  box-shadow: none;
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
  color: var(--app-ink);
}
.address-text { 
  display: flex;
  align-items: flex-start;
  color: var(--app-muted);
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
  border-top: 1px dashed var(--app-line);
}
.stat-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.stat-label { font-size: 0.8rem; color: var(--app-muted); }
.stat-value { font-weight: 600; color: var(--app-ink); }
.stat-value.highlight { color: var(--va-primary); }

.card-actions-custom { 
  display: flex; 
  align-items: center; 
  gap: 0.5rem; 
  padding: 1rem 1.25rem;
  background: var(--app-canvas);
  border-top: 1px solid #f1f5f9;
  border-radius: 0 0 16px 16px;
  margin-top: auto;
}
.flex-1 { flex: 1; }

/* Empty State */

/* Modal & Form */
.modal-title { font-size: 1.4rem; font-weight: 700; color: var(--app-ink); margin-bottom: 1rem; }
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
  background: var(--app-canvas);
  border-radius: 8px;
  border: 1px solid var(--app-line);
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

  .farm-grid { grid-template-columns: 1fr; } 
  .modern-form { grid-template-columns: 1fr; min-width: 100%; }
  .col-span-2 { grid-column: auto; }
}
</style>
