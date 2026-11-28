<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { VaAlert, VaButton } from 'vuestic-ui'
import { api } from '../../api/client'
import EmptyState from '../../components/EmptyState.vue'
import LoadingState from '../../components/LoadingState.vue'
import PageHeader from '../../components/PageHeader.vue'
import { date, errorText, invitationPath, joinRequestPath, invitationStatusLabels, organizationsPath, type OrganizationInvitation, type SharingCandidate } from './model'
import SharedScopeFields from './SharedScopeFields.vue'
import { useOrganizationData } from './useOrganizationData'

interface RequestScope {
  requested_share_logs: boolean
  requested_batch_codes: string[]
}
const props = defineProps<{ invitationId: string }>()
const route = useRoute()
const scope = () => props.invitationId
const { data, loading, error, load } = useOrganizationData(scope, async () => {
  const id = props.invitationId
  const { invitations } = await api.get<{ invitations: OrganizationInvitation[] }>('/organizations/invitations')
  const invitation = invitations.find(item => item.id === id)
  let candidates: SharingCandidate[] = []
  let candidateError = ''
  if (invitation?.kind === 'HOUSEHOLD' && invitation.canRespond && invitation.status === 'PENDING' && invitation.target_organization_id) {
    try {
      const result = await api.get<{ batches: SharingCandidate[] }>(`${organizationsPath(invitation.target_organization_id)}/share-candidates`)
      candidates = result.batches
    } catch (cause) {
      candidateError = errorText(cause)
    }
  }
  const requestScope = invitation?.kind === 'HOUSEHOLD_REQUEST'
    ? await api.get<RequestScope>(joinRequestPath(id)) : undefined
  return { invitation, candidates, candidateError, requestScope }
})
const item = computed(() => data.value?.invitation)
const shareLogs = ref(false)
const sharedBatchIds = ref<string[]>([])
const saving = ref(false)
const actionError = ref('')
const success = ref('')
watch(scope, () => {
  shareLogs.value = false
  sharedBatchIds.value = []
  actionError.value = ''
  success.value = ''
})

async function respond(accept: boolean) {
  if (saving.value || !item.value?.canRespond || item.value.status !== 'PENDING') return
  if (accept && data.value?.candidateError) return
  const id = props.invitationId
  saving.value = true
  actionError.value = ''
  try {
    await api.post(`${item.value.kind === 'HOUSEHOLD_REQUEST' ? joinRequestPath(id) : invitationPath(id)}/respond`, {
      accept,
      ...(item.value.kind === 'HOUSEHOLD' ? {
        shareLogs: accept && shareLogs.value,
        sharedBatchIds: accept ? sharedBatchIds.value : [],
      } : {}),
    })
    if (id === props.invitationId) {
      success.value = item.value?.kind === 'HOUSEHOLD_REQUEST'
        ? (accept ? 'Đã duyệt yêu cầu gia nhập.' : 'Đã từ chối yêu cầu gia nhập.')
        : (accept ? 'Đã chấp nhận lời mời.' : 'Đã từ chối lời mời.')
      await load()
    }
  } catch (cause) {
    if (id === props.invitationId) actionError.value = errorText(cause)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <main class="page-container org-page" :aria-busy="loading">
    <RouterLink :to="{ name: 'org-invitations', query: { org: route.query.org, kind: route.query.kind } }">← Danh sách lời mời</RouterLink>
    <PageHeader :title="item?.kind === 'HOUSEHOLD_REQUEST' ? 'Yêu cầu gia nhập HTX' : item?.kind === 'STAFF' ? 'Lời mời tham gia tổ chức' : 'Lời mời tham gia hợp tác xã'" :context="item?.organization_name" />
    <VaAlert v-if="success" color="success" outline role="status">{{ success }}</VaAlert>
    <VaAlert v-if="actionError" color="danger" outline role="alert">{{ actionError }}</VaAlert>
    <LoadingState v-if="loading" label="Đang tải lời mời…" />
    <VaAlert v-else-if="error" color="danger" role="alert">
      {{ error }} <VaButton size="small" preset="secondary" @click="load">Thử lại</VaButton>
    </VaAlert>
    <EmptyState v-else-if="!item" title="Không tìm thấy lời mời" icon="mail" />
    <template v-else>
      <section class="org-panel">
        <h2>{{ item.kind === 'HOUSEHOLD_REQUEST' ? 'Thông tin yêu cầu' : 'Thông tin lời mời' }}</h2>
        <dl>
          <dt>{{ item.kind === 'HOUSEHOLD_REQUEST' ? 'Hộ gửi yêu cầu' : item.kind === 'STAFF' ? 'Tổ chức' : 'Hợp tác xã' }}</dt><dd>{{ item.organization_name }}</dd>
          <dt>Người gửi</dt><dd>{{ item.sender_name || '—' }}</dd>
          <dt>{{ item.kind === 'HOUSEHOLD_REQUEST' ? 'HTX nhận yêu cầu' : item.kind === 'STAFF' ? 'Nhân sự được mời' : 'Hộ được mời' }}</dt><dd>{{ item.target_organization_name || item.target_user_name || '—' }}</dd>
          <dt>Trạng thái</dt><dd>{{ invitationStatusLabels[item.status] }}</dd>
          <dt>Hết hạn</dt><dd>{{ date(item.expires_at) }}</dd>
        </dl>
      </section>
      <section v-if="item.kind === 'HOUSEHOLD_REQUEST' && data?.requestScope" class="org-panel org-stack">
        <h2>Phạm vi hộ đồng ý chia sẻ</h2>
        <p>Thông tin cơ bản của hộ, ao liên quan, vụ nuôi và lô thu hoạch mới sẽ được chia sẻ khi HTX duyệt.</p>
        <p>Nhật ký chi tiết: {{ data.requestScope.requested_share_logs ? 'Có chia sẻ' : 'Không chia sẻ' }}</p>
        <p v-if="data.requestScope.requested_batch_codes.length">Vụ nuôi cũ được chọn: {{ data.requestScope.requested_batch_codes.join(', ') }}</p>
        <div v-if="item.canRespond && item.status === 'PENDING'" class="org-actions">
          <VaButton :disabled="saving" @click="respond(true)">Duyệt gia nhập</VaButton>
          <VaButton preset="secondary" color="danger" :disabled="saving" @click="respond(false)">Từ chối</VaButton>
        </div>
      </section>
      <form v-else-if="item.kind === 'HOUSEHOLD' && item.canRespond && item.status === 'PENDING'" class="org-panel org-stack" @submit.prevent="respond(true)">
        <div>
          <h2>Phạm vi chia sẻ khi gia nhập</h2>
          <p>Hợp tác xã có quyền xem dữ liệu trong phạm vi bạn đồng ý. Quyền quản lý, quyền chỉnh sửa và quyền sở hữu vẫn thuộc hộ nuôi.</p>
          <h3>Dữ liệu chia sẻ mặc định</h3>
          <ul class="org-bullets">
            <li>Thông tin nhận diện cơ bản của hộ và các ao liên quan.</li>
            <li>Thông tin các vụ bắt đầu từ ngày gia nhập.</li>
            <li>Thông tin lô thu hoạch từ ngày gia nhập, kèm nguồn gốc tối thiểu cho lô thuộc vụ cũ.</li>
          </ul>
        </div>
        <VaAlert v-if="data?.candidateError" color="danger" role="alert">
          {{ data.candidateError }} <VaButton type="button" size="small" preset="secondary" :disabled="saving" @click="load">Tải lại dữ liệu tùy chọn</VaButton>
        </VaAlert>
        <SharedScopeFields v-else v-model:share-logs="shareLogs" v-model:shared-batch-ids="sharedBatchIds" :candidates="data?.candidates ?? []" :disabled="saving" />
        <p>Khi rời hợp tác xã, quyền theo dõi dữ liệu theo tư cách thành viên kết thúc. Lô đã liên kết hợp lệ, giao dịch và sự kiện truy xuất vẫn được lưu.</p>
        <div class="org-actions">
          <VaButton type="submit" :disabled="saving || Boolean(data?.candidateError)">Chấp nhận và chia sẻ</VaButton>
          <VaButton type="button" preset="secondary" color="danger" :disabled="saving" @click="respond(false)">Từ chối</VaButton>
        </div>
      </form>
      <section v-else-if="item.kind === 'STAFF' && item.canRespond && item.status === 'PENDING'" class="org-panel org-stack">
        <h2>Tham gia với vai trò nhân sự</h2>
        <p>Bạn sẽ truy cập các ao và thực hiện nghiệp vụ theo phân công và quyền được giao tại tổ chức này.</p>
        <div class="org-actions">
          <VaButton :disabled="saving" @click="respond(true)">Chấp nhận</VaButton>
          <VaButton preset="secondary" color="danger" :disabled="saving" @click="respond(false)">Từ chối</VaButton>
        </div>
      </section>
      <VaButton v-else-if="item.kind === 'HOUSEHOLD' && item.status === 'ACCEPTED' && item.target_organization_id && (success || route.query.org === item.target_organization_id)" :to="{ name: 'org-households', params: { orgId: item.target_organization_id } }">Quản lý chia sẻ</VaButton>
      <VaButton v-else-if="item.kind === 'STAFF' && item.status === 'ACCEPTED' && success" :to="{ name: 'organizations', query: { org: item.organization_id } }">Mở tổ chức</VaButton>
    </template>
  </main>
</template>

<style src="./organizations.css"></style>
