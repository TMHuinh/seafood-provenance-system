<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { VaAlert, VaButton, VaInput } from 'vuestic-ui'
import { api } from '../../api/client'
import EmptyState from '../../components/EmptyState.vue'
import LoadingState from '../../components/LoadingState.vue'
import PageHeader from '../../components/PageHeader.vue'
import { date, errorText, isOrganizationLead, organizationsPath, type DirectoryOrganization, type HouseholdRelationship, type Membership, type SharingCandidate } from './model'
import SharedScopeFields from './SharedScopeFields.vue'
import { useOrganizationData } from './useOrganizationData'

const props = defineProps<{ orgId: string }>()
const scope = () => props.orgId
const { data, loading, error, load } = useOrganizationData(scope, async () => {
  const id = props.orgId
  const { memberships } = await api.get<{ memberships: Membership[] }>('/organizations/workspace')
  const member = memberships.find(item => item.organization_id === id)
  if (!isOrganizationLead(member)) return { member, households: [], active: undefined, candidates: [], candidateError: '' }
  const path = organizationsPath(id)
  const { households } = await api.get<{ households: HouseholdRelationship[] }>(`${path}/households`)
  const active = member?.role === 'REPRESENTATIVE' ? households.find(item => !item.ended_at) : undefined
  let candidates: SharingCandidate[] = []
  let candidateError = ''
  if (active) {
    try {
      candidates = (await api.get<{ batches: SharingCandidate[] }>(`${path}/share-candidates`)).batches
    } catch (cause) {
      candidateError = errorText(cause)
    }
  }
  return { member, households, active, candidates, candidateError }
})
const member = computed(() => data.value?.member)
const manager = computed(() => member.value?.organization_type === 'COOPERATIVE' && member.value.role === 'MANAGER')
const active = computed(() => data.value?.active)
const history = computed(() => data.value?.households.filter(item => item.ended_at) ?? [])
const currentHouseholds = computed(() => data.value?.households.filter(item => !item.ended_at) ?? [])

const term = ref('')
const matches = ref<DirectoryOrganization[]>([])
const searched = ref(false)
const searching = ref(false)
const sentIds = ref<string[]>([])
const saving = ref('')
const actionError = ref('')
const success = ref('')
const shareLogs = ref(false)
const sharedBatchIds = ref<string[]>([])
watch(active, item => {
  shareLogs.value = item?.share_logs ?? false
  sharedBatchIds.value = [...(item?.shared_batch_ids ?? [])]
})
watch(scope, () => {
  term.value = ''
  matches.value = []
  searched.value = false
  searching.value = false
  sentIds.value = []
  actionError.value = ''
  success.value = ''
})

async function search() {
  const q = term.value.trim()
  if (!manager.value || searching.value || q.length < 2) return
  const id = props.orgId
  searching.value = true
  searched.value = false
  matches.value = []
  actionError.value = ''
  try {
    const result = await api.get<{ households: DirectoryOrganization[] }>(`${organizationsPath(id)}/household-search?${new URLSearchParams({ q })}`)
    if (id === props.orgId) {
      searched.value = true
      matches.value = result.households
    }
  } catch (cause) {
    if (id === props.orgId) actionError.value = errorText(cause)
  } finally {
    if (id === props.orgId) searching.value = false
  }
}

async function invite(household: DirectoryOrganization) {
  if (!manager.value || saving.value) return
  const id = props.orgId
  saving.value = household.id
  actionError.value = ''
  success.value = ''
  try {
    await api.post(`${organizationsPath(id)}/invitations`, { householdId: household.id })
    if (id === props.orgId) {
      sentIds.value.push(household.id)
      success.value = `Đã gửi lời mời đến ${household.name}.`
    }
  } catch (cause) {
    if (id === props.orgId) actionError.value = errorText(cause)
  } finally {
    saving.value = ''
  }
}

async function changeRelationship(leave: boolean) {
  if (saving.value || !active.value) return
  if (!leave && data.value?.candidateError) return
  if (leave && !window.confirm('Rời hợp tác xã? Quyền xem dữ liệu qua quan hệ thành viên sẽ kết thúc. Lô đã liên kết, giao dịch và lịch sử truy xuất vẫn được lưu.')) return
  const id = props.orgId
  const path = `${organizationsPath(id)}/households/${active.value.id}`
  saving.value = leave ? 'leave' : 'sharing'
  actionError.value = ''
  success.value = ''
  try {
    if (leave) await api.post(`${path}/leave`)
    else await api.patch(`${path}/sharing`, { shareLogs: shareLogs.value, sharedBatchIds: sharedBatchIds.value })
    if (id === props.orgId) {
      success.value = leave ? 'Đã rời hợp tác xã.' : 'Đã cập nhật phạm vi chia sẻ.'
      await load()
    }
  } catch (cause) {
    if (id === props.orgId) actionError.value = errorText(cause)
  } finally {
    saving.value = ''
  }
}
</script>

<template>
  <main class="page-container org-page" :aria-busy="loading">
    <RouterLink :to="{ name: 'organizations', query: { org: orgId } }">← Tổ chức của tôi</RouterLink>
    <PageHeader :title="manager ? 'Hộ thành viên' : 'Quan hệ hợp tác xã'" :context="member?.organization_name">
      <template v-if="isOrganizationLead(member)" #actions>
        <VaButton preset="secondary" :to="{ name: 'org-invitations', query: { org: orgId } }">{{ manager ? 'Lời mời đã gửi' : 'Lời mời gia nhập' }}</VaButton>
      </template>
    </PageHeader>
    <VaAlert v-if="success" color="success" outline role="status">{{ success }}</VaAlert>
    <VaAlert v-if="actionError" color="danger" outline role="alert">{{ actionError }}</VaAlert>
    <LoadingState v-if="loading" />
    <VaAlert v-else-if="error" color="danger" role="alert">
      {{ error }} <VaButton size="small" preset="secondary" @click="load">Thử lại</VaButton>
    </VaAlert>
    <EmptyState v-else-if="!isOrganizationLead(member)" title="Bạn không có quyền quản lý quan hệ của đơn vị này" icon="groups" />
    <template v-else>
      <section v-if="manager" class="org-panel org-stack">
        <h2>Mời hộ nuôi</h2>
        <form class="org-search" @submit.prevent="search">
          <VaInput v-model="term" label="Tên hộ nuôi" maxlength="100" :disabled="searching" />
          <VaButton type="submit" :loading="searching" :disabled="searching || term.trim().length < 2">Tìm kiếm</VaButton>
        </form>
        <p v-if="searched && !matches.length" class="org-muted" role="status">Không tìm thấy hộ nuôi phù hợp.</p>
        <ul v-if="matches.length" class="org-list org-records" aria-label="Kết quả tìm kiếm hộ nuôi">
          <li v-for="household in matches" :key="household.id" class="org-row">
            <div><strong>{{ household.name }}</strong><p v-if="household.address">{{ household.address }}</p></div>
            <p v-if="sentIds.includes(household.id)">Đã gửi lời mời</p>
            <VaButton v-else preset="secondary" :disabled="Boolean(saving)" :loading="saving === household.id" @click="invite(household)">Gửi lời mời</VaButton>
          </li>
        </ul>
      </section>

      <section v-if="manager" class="org-panel">
        <h2>Hộ đang tham gia</h2>
        <p v-if="!currentHouseholds.length" class="org-muted">Chưa có hộ thành viên.</p>
        <ul v-else class="org-list org-records">
          <li v-for="item in currentHouseholds" :key="item.id" class="org-row">
            <div><strong>{{ item.household_name }}</strong><p>Tham gia từ {{ date(item.joined_at) }}</p></div>
            <RouterLink :to="{ name: 'org-household-detail', params: { orgId, relationId: item.id } }">Xem dữ liệu được chia sẻ</RouterLink>
          </li>
        </ul>
      </section>

      <EmptyState v-else-if="!active" title="Hộ chưa tham gia hợp tác xã" icon="groups" />
      <form v-else class="org-panel org-stack" @submit.prevent="changeRelationship(false)">
        <div><h2>{{ active.cooperative_name }}</h2><p>Tham gia từ {{ date(active.joined_at) }}</p></div>
        <p>Thông tin cơ bản của hộ, các ao liên quan, vụ nuôi và lô thu hoạch trong thời gian tham gia thuộc phạm vi chia sẻ mặc định.</p>
        <VaAlert v-if="data?.candidateError" color="danger" role="alert">
          {{ data.candidateError }} <VaButton type="button" size="small" preset="secondary" :disabled="Boolean(saving)" @click="load">Tải lại dữ liệu tùy chọn</VaButton>
        </VaAlert>
        <SharedScopeFields v-else v-model:share-logs="shareLogs" v-model:shared-batch-ids="sharedBatchIds" :candidates="data?.candidates ?? []" :disabled="Boolean(saving)" />
        <div class="org-actions">
          <VaButton type="submit" :loading="saving === 'sharing'" :disabled="Boolean(saving) || Boolean(data?.candidateError)">Lưu phạm vi chia sẻ</VaButton>
          <VaButton type="button" preset="secondary" color="danger" :loading="saving === 'leave'" :disabled="Boolean(saving)" @click="changeRelationship(true)">Rời hợp tác xã</VaButton>
        </div>
      </form>

      <section v-if="history.length" class="org-panel">
        <h2>Lịch sử thành viên</h2>
        <ul class="org-list org-records">
          <li v-for="item in history" :key="item.id">
            <strong>{{ manager ? item.household_name : item.cooperative_name }}</strong>
            <p>Tham gia {{ date(item.joined_at) }} · Kết thúc {{ date(item.ended_at) }}</p>
          </li>
        </ul>
      </section>
    </template>
  </main>
</template>

<style src="./organizations.css"></style>
