<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { VaAlert, VaButton, VaInput } from 'vuestic-ui'
import { api } from '../../api/client'
import PageHeader from '../../components/PageHeader.vue'
import EmptyState from '../../components/EmptyState.vue'
import LoadingState from '../../components/LoadingState.vue'
import { useAuthStore } from '../../stores/auth.store'
import { ORG_TYPE_OPTIONS } from '../../types'
import { errorText, isOrganizationLead, organizationsPath, permissionLabels, roleLabels, type Membership } from './model'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const memberships = ref<Membership[]>([])
const loading = ref(true)
const error = ref('')
let version = 0
const current = computed(() => route.query.org
  ? memberships.value.find(item => item.organization_id === route.query.org)
  : memberships.value[0])
const currentId = computed(() => current.value?.organization_id)
const canCreateHousehold = computed(() => auth.user?.role === 'FARMER' && !auth.user.organization_id
  && !memberships.value.some(item => item.role === 'REPRESENTATIVE' && item.organization_type === 'FARMER_HOUSEHOLD'))
const editing = ref(false)
const name = ref('')
const address = ref('')
const saving = ref(false)
const actionError = ref('')
const success = ref('')
watch(currentId, () => { editing.value = false; actionError.value = ''; success.value = '' })

function openEdit() {
  if (!current.value || !isOrganizationLead(current.value)) return
  name.value = current.value.organization_name
  address.value = current.value.organization_address ?? ''
  actionError.value = ''
  success.value = ''
  editing.value = true
}

async function saveOrganization() {
  if (!currentId.value || !name.value.trim() || saving.value) return
  const id = currentId.value
  const request = version
  saving.value = true
  actionError.value = ''
  try {
    await api.patch(organizationsPath(id), { name: name.value.trim(), address: address.value.trim() || null })
    if (id === currentId.value && request === version) {
      editing.value = false
      success.value = 'Đã cập nhật thông tin tổ chức.'
      await load()
    }
  } catch (cause) {
    if (id === currentId.value && request === version) actionError.value = errorText(cause)
  } finally {
    saving.value = false
  }
}

async function leaveStaffOrganization() {
  const item = current.value
  if (saving.value || item?.role !== 'STAFF' || !item.membership_id) return
  if (!window.confirm(`Rời ${item.organization_name}? Quyền truy cập theo tổ chức và các phân công liên quan sẽ kết thúc. Hồ sơ bạn đã tạo vẫn được lưu.`)) return
  const id = currentId.value
  const request = version
  saving.value = true
  actionError.value = ''
  try {
    await api.post(`${organizationsPath(item.organization_id)}/staff/${item.membership_id}/leave`)
    if (id === currentId.value && request === version) {
      await router.replace({ name: 'organizations' })
      await load()
      success.value = 'Đã rời tổ chức.'
    }
  } catch (cause) {
    if (id === currentId.value && request === version) actionError.value = errorText(cause)
  } finally {
    saving.value = false
  }
}

async function load() {
  const request = ++version
  loading.value = true
  error.value = ''
  try {
    const result = await api.get<{ memberships: Membership[] }>('/organizations/workspace')
    if (request === version) memberships.value = result.memberships
  } catch (cause) {
    if (request === version) {
      memberships.value = []
      error.value = errorText(cause)
    }
  } finally {
    if (request === version) loading.value = false
  }
}
function changeContext(event: Event) {
  const org = (event.target as HTMLSelectElement).value
  void router.push({ name: 'organizations', query: { org } })
}
onMounted(load)
onBeforeUnmount(() => { version++ })
</script>

<template>
  <main class="page-container org-page" :aria-busy="loading">
    <PageHeader title="Tổ chức của tôi">
      <template #actions>
        <label v-if="memberships.length > 1 || (!current && memberships.length)" class="org-select">Đơn vị làm việc
          <select :value="current?.organization_id ?? ''" @change="changeContext">
            <option v-if="!current" disabled value="">Chọn đơn vị</option>
            <option v-for="item in memberships" :key="item.organization_id" :value="item.organization_id">{{ item.organization_name }}</option>
          </select>
        </label>
        <VaButton preset="secondary" :to="{ name: 'org-invitations', query: { kind: 'staff' } }">Lời mời nhân sự</VaButton>
      </template>
    </PageHeader>
    <VaAlert v-if="success" color="success" outline role="status">{{ success }}</VaAlert>
    <VaAlert v-if="actionError" color="danger" outline role="alert">{{ actionError }}</VaAlert>
    <LoadingState v-if="loading" label="Đang tải thông tin tổ chức…" />
    <va-alert v-else-if="error" color="danger" role="alert">
      {{ error }} <va-button size="small" preset="secondary" @click="load">Thử lại</va-button>
    </va-alert>
    <section v-else-if="current" class="org-panel org-stack">
      <h2>{{ current.organization_name }}</h2>
      <dl>
        <dt>Loại tổ chức</dt>
        <dd>{{ ORG_TYPE_OPTIONS.find(option => option.value === current?.organization_type)?.label }}</dd>
        <dt>Vai trò của bạn</dt><dd>{{ roleLabels[current.role] }}</dd>
        <template v-if="current.organization_address"><dt>Địa chỉ</dt><dd>{{ current.organization_address }}</dd></template>
      </dl>
      <nav v-if="isOrganizationLead(current)" class="org-actions" aria-label="Quản lý tổ chức">
        <VaButton :to="{ name: 'org-households', params: { orgId: current.organization_id } }">{{ current.role === 'MANAGER' ? 'Hộ thành viên' : 'Hợp tác xã của tôi' }}</VaButton>
        <VaButton preset="secondary" :to="{ name: 'org-invitations', query: { org: current.organization_id } }">{{ current.role === 'MANAGER' ? 'Lời mời đã gửi' : 'Lời mời gia nhập' }}</VaButton>
        <VaButton v-if="current.role === 'REPRESENTATIVE'" preset="secondary" :to="{ name: 'org-household-setup', query: { org: current.organization_id } }">Gắn cơ sở riêng</VaButton>
        <VaButton preset="secondary" :to="{ name: 'org-staff', params: { orgId: current.organization_id } }">Nhân sự</VaButton>
        <VaButton preset="secondary" :to="{ name: 'org-pond-operations', params: { orgId: current.organization_id } }">Phân công và bàn giao ao</VaButton>
        <VaButton v-if="!editing" preset="secondary" @click="openEdit">Chỉnh sửa thông tin</VaButton>
      </nav>
      <div v-else-if="current.role === 'STAFF' && current.membership_id" class="org-actions">
        <VaButton preset="secondary" color="danger" :loading="saving" :disabled="saving" @click="leaveStaffOrganization">Rời tổ chức</VaButton>
      </div>
      <form v-if="editing" class="org-stack" @submit.prevent="saveOrganization">
        <VaInput v-model="name" label="Tên tổ chức" required maxlength="255" :disabled="saving" />
        <VaInput v-model="address" label="Địa chỉ" maxlength="1000" :disabled="saving" />
        <div class="org-actions">
          <VaButton type="submit" :loading="saving" :disabled="saving || !name.trim()">Lưu thông tin</VaButton>
          <VaButton type="button" preset="secondary" :disabled="saving" @click="editing = false">Hủy</VaButton>
        </div>
      </form>
    </section>
    <EmptyState v-else-if="!canCreateHousehold" :title="memberships.length ? 'Bạn không có quyền truy cập đơn vị này' : 'Bạn chưa tham gia tổ chức nào'" icon="groups" />
    <section v-if="!loading && !error && canCreateHousehold" class="org-panel org-row household-entry">
      <div>
        <h2>Quản lý cơ sở của bạn theo hộ nuôi</h2>
        <p class="org-muted">Tạo hồ sơ từ tài khoản hiện có và chọn cơ sở muốn đưa vào hộ để tham gia HTX.</p>
      </div>
      <VaButton icon="add" :to="{ name: 'org-household-setup' }">Tạo hồ sơ hộ nuôi</VaButton>
    </section>
    <section v-if="!loading && !error && current?.role === 'STAFF'" class="org-panel org-stack">
      <h2>Ao được phân công</h2>
      <p v-if="!current.assigned_ponds?.length" class="org-muted">Bạn chưa có phân công đang hiệu lực tại đơn vị này.</p>
      <ul v-else class="org-list org-records">
        <li v-for="pond in current.assigned_ponds" :key="pond.id" class="org-row">
          <div>
            <strong>{{ pond.pond_name }} · {{ pond.pond_code }}</strong>
            <p>{{ pond.permissions.map(permission => permissionLabels[permission]).join(' · ') }}</p>
          </div>
          <RouterLink :to="{ name: 'pond-batches', params: { farmId: pond.farm_id, pondId: pond.id } }">Mở vụ nuôi và nhật ký</RouterLink>
        </li>
      </ul>
    </section>
  </main>
</template>

<style src="./organizations.css"></style>

<style scoped>
.household-entry {
  border-inline-start: 3px solid var(--app-primary);
  align-items: center;
}
.household-entry > div { flex: 1 1 20rem; }
.household-entry h2 { margin-bottom: var(--app-space-2); }
.household-entry p { margin-bottom: 0; }
.household-entry :deep(.va-button) { min-height: 44px; }
</style>
