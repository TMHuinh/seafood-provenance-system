<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router'
import { VaAlert, VaButton, VaInput, VaIcon } from 'vuestic-ui'
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
const contextId = computed(() => route.params.orgId ?? route.query.org)
const current = computed(() => contextId.value
  ? memberships.value.find(item => item.organization_id === contextId.value)
  : memberships.value[0])
const overview = computed(() => route.name === 'organizations')
const primaryDetails = computed(() => current.value && auth.user?.organization?.id === current.value.organization_id
  ? auth.user.organization : null)
const tabs = computed(() => {
  const member = current.value
  const org = member?.organization_id
  const lead = isOrganizationLead(member)
  const view = String(route.query.view ?? 'assignment')
  const items: { label: string; icon: string; active: boolean; to: RouteLocationRaw }[] = [
    { label: 'Tổng quan', icon: 'dashboard', active: overview.value, to: { name: 'organizations', query: { org } } },
  ]
  if (lead && org) {
    items.push(
      { label: member?.role === 'MANAGER' ? 'Hộ thành viên' : 'Hợp tác xã của tôi', icon: 'groups',
        active: route.name === 'org-households' || route.name === 'org-household-detail', to: { name: 'org-households', params: { orgId: org } } },
      { label: 'Nhân sự', icon: 'person', active: route.name === 'org-staff', to: { name: 'org-staff', params: { orgId: org } } },
    )
    for (const item of [
      { key: 'assignment', label: 'Phân công ao', icon: 'assignment_ind' },
      { key: 'handover', label: 'Bàn giao quyền vận hành', icon: 'swap_horiz' },
      { key: 'history', label: 'Lịch sử', icon: 'history' },
    ]) {
      items.push({ ...item, active: route.name === 'org-pond-operations' && view === item.key,
        to: { name: 'org-pond-operations', params: { orgId: org }, query: { view: item.key } } })
    }
  }
  items.push({ label: 'Lời mời', icon: 'mail', active: route.name === 'org-invitations' || route.name === 'org-invitation',
    to: { name: 'org-invitations', query: { org, kind: lead ? undefined : 'staff' } } })
  return items
})
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
watch(() => route.name, (next, previous) => {
  if (next === 'organizations' && (previous === 'org-household-setup' || previous === 'org-invitation')) void load()
})
onMounted(load)
onBeforeUnmount(() => { version++ })
</script>

<template>
  <div class="page-container org-page workspace-page" :aria-busy="loading">
    <LoadingState v-if="loading" label="Đang tải tổ chức…" />
    <VaAlert v-else-if="error" color="danger" role="alert">
      {{ error }} <VaButton size="small" preset="secondary" @click="load">Thử lại</VaButton>
    </VaAlert>
    <template v-else>
      <header v-if="current" class="workspace-header">
        <span class="workspace-icon"><VaIcon :name="current.organization_type === 'COOPERATIVE' ? 'groups' : 'home_work'" aria-hidden="true" /></span>
        <div class="workspace-identity">
          <h1>{{ current.organization_name }}</h1>
          <div class="workspace-meta">
            <span>{{ ORG_TYPE_OPTIONS.find(option => option.value === current?.organization_type)?.label }}</span>
            <span>{{ roleLabels[current.role] }}</span>
            <span class="workspace-badge workspace-badge-active">Đang hoạt động</span>
          </div>
          <p v-if="current.organization_address || primaryDetails?.phone" class="workspace-contact">
            {{ [current.organization_address, primaryDetails?.phone].filter(Boolean).join(' · ') }}
          </p>
        </div>
        <div class="org-actions">
          <label v-if="memberships.length > 1" :key="currentId" class="org-select">Đơn vị làm việc
            <select :value="currentId" @change="changeContext">
              <option v-for="item in memberships" :key="item.organization_id" :value="item.organization_id">{{ item.organization_name }}</option>
            </select>
          </label>
          <VaButton v-if="isOrganizationLead(current) && !editing" preset="secondary" icon="edit" @click="openEdit">Chỉnh sửa thông tin</VaButton>
        </div>
      </header>
      <PageHeader v-else-if="overview" title="Tổ chức của tôi" />
      <nav v-if="current || overview" class="workspace-nav" aria-label="Điều hướng tổ chức">
        <RouterLink v-for="tab in tabs" :key="tab.label" :to="tab.to" :aria-current="tab.active ? 'page' : undefined">
          <VaIcon :name="tab.icon" size="small" aria-hidden="true" /> {{ tab.label }}
        </RouterLink>
      </nav>

      <VaAlert v-if="success" color="success" outline role="status">{{ success }}</VaAlert>
      <VaAlert v-if="actionError" color="danger" outline role="alert">{{ actionError }}</VaAlert>
      <form v-if="editing" class="org-panel org-stack" @submit.prevent="saveOrganization">
        <h2>Chỉnh sửa thông tin</h2>
        <div class="org-form-grid">
          <VaInput v-model="name" label="Tên tổ chức" required maxlength="255" :disabled="saving" />
          <VaInput v-model="address" label="Địa chỉ" maxlength="1000" :disabled="saving" />
        </div>
        <div class="org-actions">
          <VaButton type="submit" :loading="saving" :disabled="saving || !name.trim()">Lưu thông tin</VaButton>
          <VaButton type="button" preset="secondary" :disabled="saving" @click="editing = false">Hủy</VaButton>
        </div>
      </form>

      <template v-if="overview && current?.role === 'STAFF'">
        <section class="org-panel org-stack">
          <h2>Ao được phân công</h2>
          <p v-if="!current.assigned_ponds?.length" class="org-muted">Bạn chưa có phân công đang hiệu lực tại đơn vị này.</p>
          <ul v-else class="org-list org-records">
            <li v-for="pond in current.assigned_ponds" :key="pond.id" class="org-row">
              <div><strong>{{ pond.pond_name }} · {{ pond.pond_code }}</strong>
                <p>{{ pond.permissions.map(permission => permissionLabels[permission]).join(' · ') }}</p>
              </div>
              <RouterLink :to="{ name: 'pond-batches', params: { farmId: pond.farm_id, pondId: pond.id } }">Mở vụ nuôi và nhật ký</RouterLink>
            </li>
          </ul>
        </section>
        <VaButton v-if="current.membership_id" preset="secondary" color="danger" :loading="saving" :disabled="saving" @click="leaveStaffOrganization">Rời tổ chức</VaButton>
      </template>
      <EmptyState v-else-if="overview && !current && !canCreateHousehold" :title="memberships.length ? 'Bạn không có quyền truy cập đơn vị này' : 'Bạn chưa tham gia tổ chức nào'" icon="groups">
        <VaButton v-if="memberships.length" :to="{ name: 'organizations' }">Mở tổ chức của tôi</VaButton>
      </EmptyState>

      <div class="workspace-body" :class="{ 'workspace-with-header': current && !['org-invitation', 'org-household-detail', 'org-household-setup'].includes(String(route.name)) }">
        <RouterView v-slot="{ Component }">
          <component :is="Component" v-if="!overview" />
          <component :is="Component" v-else-if="current && isOrganizationLead(current)" :key="currentId" :member="current" />
        </RouterView>
      </div>

      <section v-if="overview && canCreateHousehold" class="org-panel org-row household-entry">
        <div>
          <h2>Quản lý cơ sở của bạn theo hộ nuôi</h2>
          <p class="org-muted">Tạo hồ sơ từ tài khoản hiện có và chọn cơ sở muốn đưa vào hộ để tham gia HTX.</p>
        </div>
        <VaButton icon="add" :to="{ name: 'org-household-setup' }">Tạo hồ sơ hộ nuôi</VaButton>
      </section>
    </template>
  </div>
</template>

<style src="./organizations.css"></style>
<style src="./workspace.css"></style>

<style scoped>
.household-entry { margin-top: var(--app-space-4); border-inline-start: 3px solid var(--app-primary); }
.household-entry > div { flex: 1 1 20rem; }
.household-entry p { margin-bottom: 0; }
.household-entry :deep(.va-button) { min-height: 44px; }
</style>
