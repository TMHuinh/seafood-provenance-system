<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { VaAlert, VaButton } from 'vuestic-ui'
import { api } from '../../api/client'
import EmptyState from '../../components/EmptyState.vue'
import LoadingState from '../../components/LoadingState.vue'
import PageHeader from '../../components/PageHeader.vue'
import { date, errorText, invitationPath, invitationStatusLabels, type OrganizationInvitation } from './model'
import { useOrganizationData } from './useOrganizationData'

const route = useRoute()
const org = computed(() => typeof route.query.org === 'string' ? route.query.org : undefined)
const kind = computed(() => route.query.kind === 'staff' ? 'STAFF' : 'HOUSEHOLD')
const scope = computed(() => [org.value, kind.value] as const)
const { data, loading, error, load } = useOrganizationData(scope,
  () => api.get<{ invitations: OrganizationInvitation[] }>('/organizations/invitations'))
const invitations = computed(() => (data.value?.invitations ?? []).filter(item =>
  item.kind === kind.value && (!org.value || item.organization_id === org.value || item.target_organization_id === org.value)))
const saving = ref('')
const actionError = ref('')
const success = ref('')
watch(scope, () => { actionError.value = ''; success.value = '' })

async function cancel(item: OrganizationInvitation) {
  if (saving.value || !window.confirm('Hủy lời mời này? Người nhận sẽ không còn có thể chấp nhận lời mời.')) return
  const context = scope.value
  saving.value = item.id
  actionError.value = ''
  success.value = ''
  try {
    await api.post(`${invitationPath(item.id)}/cancel`)
    if (scope.value === context) {
      success.value = 'Đã hủy lời mời.'
      await load()
    }
  } catch (cause) {
    if (scope.value === context) actionError.value = errorText(cause)
  } finally {
    saving.value = ''
  }
}
</script>

<template>
  <main class="page-container org-page" :aria-busy="loading">
    <RouterLink :to="{ name: 'organizations', query: { org } }">← Tổ chức của tôi</RouterLink>
    <PageHeader :title="kind === 'STAFF' ? 'Lời mời nhân sự' : 'Lời mời hợp tác xã'" />
    <VaAlert v-if="success" color="success" outline role="status">{{ success }}</VaAlert>
    <VaAlert v-if="actionError" color="danger" outline role="alert">{{ actionError }}</VaAlert>
    <LoadingState v-if="loading" label="Đang tải lời mời…" />
    <VaAlert v-else-if="error" color="danger" role="alert">
      {{ error }} <VaButton size="small" preset="secondary" @click="load">Thử lại</VaButton>
    </VaAlert>
    <EmptyState v-else-if="!invitations.length" title="Chưa có lời mời" icon="mail" />
    <ul v-else class="org-list">
      <li v-for="item in invitations" :key="item.id" class="org-panel org-row">
        <div>
          <h2>{{ item.organization_name }} → {{ item.target_organization_name || item.target_user_name || 'Nhân sự' }}</h2>
          <p>{{ invitationStatusLabels[item.status] }} · Gửi ngày {{ date(item.created_at) }} · Hết hạn {{ date(item.expires_at) }}</p>
          <p v-if="item.sender_name" class="org-muted">Người gửi: {{ item.sender_name }}</p>
        </div>
        <div class="org-actions">
          <VaButton v-if="item.canRespond && item.status === 'PENDING'" :to="{ name: 'org-invitation', params: { invitationId: item.id }, query: { org, kind: route.query.kind } }">Xem và phản hồi</VaButton>
          <VaButton v-if="item.canCancel && item.status === 'PENDING'" preset="secondary" color="danger" :loading="saving === item.id" :disabled="Boolean(saving)" @click="cancel(item)">Hủy lời mời</VaButton>
        </div>
      </li>
    </ul>
  </main>
</template>

<style src="./organizations.css"></style>
