<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { VaAlert, VaButton, VaInput } from 'vuestic-ui'
import { api } from '../../api/client'
import EmptyState from '../../components/EmptyState.vue'
import LoadingState from '../../components/LoadingState.vue'
import PageHeader from '../../components/PageHeader.vue'
import { approvalPermissions, date, errorText, isOrganizationLead, organizationsPath, permissionLabels, roleLabels, type Membership, type OrganizationStaff, type PondPermission } from './model'
import { useOrganizationData } from './useOrganizationData'

const props = defineProps<{ orgId: string }>()
const scope = () => props.orgId
const { data, loading, error, load } = useOrganizationData(scope, async () => {
  const id = props.orgId
  const { memberships } = await api.get<{ memberships: Membership[] }>('/organizations/workspace')
  const member = memberships.find(item => item.organization_id === id)
  const records = isOrganizationLead(member)
    ? await api.get<{ staff: OrganizationStaff[]; history: OrganizationStaff[] }>(`${organizationsPath(id)}/staff`) : undefined
  return { member, staff: records?.staff ?? [], history: records?.history ?? [] }
})
const staff = computed(() => data.value?.staff ?? [])
const history = computed(() => data.value?.history ?? [])
const email = ref('')
const saving = ref('')
const editing = ref('')
const permissions = ref<PondPermission[]>([])
const success = ref('')
const actionError = ref('')
watch(scope, () => { email.value = ''; editing.value = ''; success.value = ''; actionError.value = '' })

async function mutate(task: string, request: () => Promise<unknown>, message: string, refresh = true) {
  if (saving.value || !isOrganizationLead(data.value?.member)) return
  const context = props.orgId
  saving.value = task
  success.value = ''
  actionError.value = ''
  try {
    await request()
    if (context === props.orgId) {
      success.value = message
      if (refresh) {
        editing.value = ''
        await load()
      } else email.value = ''
    }
  } catch (cause) {
    if (context === props.orgId) actionError.value = errorText(cause)
  } finally {
    saving.value = ''
  }
}
function invite() {
  if (!email.value.trim()) return
  void mutate('invite', () => api.post(`${organizationsPath(props.orgId)}/staff/invitations`, { email: email.value.trim() }),
    'Đã gửi lời mời nhân sự.', false)
}
function changePermissions(item: OrganizationStaff) {
  editing.value = item.id
  permissions.value = [...item.permissions]
}
function updatePermissions(item: OrganizationStaff) {
  void mutate(item.id, () => api.patch(`${organizationsPath(props.orgId)}/staff/${item.id}/permissions`, { permissions: permissions.value }),
    'Đã cập nhật quyền xác nhận.')
}
function remove(item: OrganizationStaff) {
  if (!window.confirm(`Kết thúc tư cách nhân sự của ${item.full_name}? Quyền truy cập theo tổ chức và các phân công liên quan sẽ kết thúc. Hồ sơ đã tạo vẫn được lưu.`)) return
  void mutate(item.id, () => api.post(`${organizationsPath(props.orgId)}/staff/${item.id}/remove`), 'Đã kết thúc tư cách nhân sự.')
}
</script>

<template>
  <main class="page-container org-page" :aria-busy="loading">
    <RouterLink :to="{ name: 'organizations', query: { org: orgId } }">← Tổ chức của tôi</RouterLink>
    <PageHeader title="Nhân sự" :context="data?.member?.organization_name">
      <template v-if="isOrganizationLead(data?.member)" #actions>
        <VaButton preset="secondary" :to="{ name: 'org-invitations', query: { org: orgId, kind: 'staff' } }">Lời mời đã gửi</VaButton>
      </template>
    </PageHeader>
    <VaAlert v-if="success" color="success" outline role="status">{{ success }}</VaAlert>
    <VaAlert v-if="actionError" color="danger" outline role="alert">{{ actionError }}</VaAlert>
    <LoadingState v-if="loading" />
    <VaAlert v-else-if="error" color="danger" role="alert">
      {{ error }} <VaButton size="small" preset="secondary" @click="load">Thử lại</VaButton>
    </VaAlert>
    <EmptyState v-else-if="!isOrganizationLead(data?.member)" title="Bạn không có quyền quản lý nhân sự của đơn vị này" icon="groups" />
    <template v-else>
      <section class="org-panel org-stack">
        <h2>Mời nhân sự</h2>
        <form class="org-search" @submit.prevent="invite">
          <VaInput v-model="email" type="email" label="Email tài khoản người nuôi" required maxlength="254" :disabled="Boolean(saving)" />
          <VaButton type="submit" :loading="saving === 'invite'" :disabled="Boolean(saving) || !email.trim()">Gửi lời mời</VaButton>
        </form>
      </section>
      <section v-if="history.length" class="org-panel">
        <h2>Lịch sử nhân sự</h2>
        <ul class="org-list org-records">
          <li v-for="item in history" :key="item.id">
            <strong>{{ item.full_name }}</strong>
            <p>{{ roleLabels[item.role] }} · Tham gia {{ date(item.starts_at, true) }} · Kết thúc {{ date(item.ends_at, true) }}</p>
          </li>
        </ul>
      </section>
      <section class="org-panel">
        <h2>Thành viên đang hoạt động</h2>
        <p v-if="!staff.length" class="org-muted">Chưa có thành viên.</p>
        <ul v-else class="org-list org-records">
          <li v-for="item in staff" :key="item.id" class="org-stack">
            <div class="org-row">
              <div>
                <strong>{{ item.full_name }}</strong>
                <p>{{ roleLabels[item.role] }} · Tham gia từ {{ date(item.starts_at) }}</p>
                <p v-if="item.permissions.length">{{ item.permissions.map(permission => permissionLabels[permission]).join(' · ') }}</p>
              </div>
              <div class="org-actions">
                <VaButton v-if="item.role !== 'STAFF' && editing !== item.id" preset="secondary" :disabled="Boolean(saving)" @click="changePermissions(item)">Quyền xác nhận</VaButton>
                <VaButton v-if="item.role === 'STAFF'" preset="secondary" color="danger" :disabled="Boolean(saving)" @click="remove(item)">Kết thúc tư cách nhân sự</VaButton>
              </div>
            </div>
            <form v-if="editing === item.id" class="org-stack" @submit.prevent="updatePermissions(item)">
              <fieldset class="org-fields" :disabled="Boolean(saving)">
                <legend>Quyền xác nhận của {{ item.full_name }}</legend>
                <label v-for="permission in approvalPermissions" :key="permission" class="org-choice">
                  <input v-model="permissions" type="checkbox" :value="permission" />
                  <span>{{ permissionLabels[permission] }}</span>
                </label>
              </fieldset>
              <div class="org-actions">
                <VaButton type="submit" :loading="saving === item.id" :disabled="Boolean(saving)">Lưu quyền</VaButton>
                <VaButton type="button" preset="secondary" :disabled="Boolean(saving)" @click="editing = ''">Hủy</VaButton>
              </div>
            </form>
          </li>
        </ul>
      </section>
    </template>
  </main>
</template>

<style src="./organizations.css"></style>
