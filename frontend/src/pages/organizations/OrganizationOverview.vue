<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { VaAlert, VaButton, VaIcon } from 'vuestic-ui'
import LoadingState from '../../components/LoadingState.vue'
import { useAuthStore } from '../../stores/auth.store'
import { date, type Membership } from './model'
import { loadOverview, pendingInvitations } from './workspaceOverview'
import { useOrganizationData } from './useOrganizationData'

const props = defineProps<{ member: Membership }>()
const auth = useAuthStore()
const org = computed(() => props.member.organization_id)
const cooperative = computed(() => props.member.role === 'MANAGER')
const { data, loading, error, load } = useOrganizationData(org, () => loadOverview(org.value, cooperative.value))
const details = computed(() => auth.user?.organization?.id === org.value ? auth.user.organization : null)
const operation = (view: string) => ({ name: 'org-pond-operations', params: { orgId: org.value }, query: { view } })
const households = computed(() => ({ name: 'org-households', params: { orgId: org.value } }))
const staff = computed(() => ({ name: 'org-staff', params: { orgId: org.value } }))
const tasks = computed(() => [
  ...pendingInvitations(data.value?.invitations ?? [], org.value, auth.user?.id).map(item => ({
    key: item.id, icon: 'mail', title: item.kind === 'HOUSEHOLD_REQUEST' ? 'Yêu cầu gia nhập HTX' : item.kind === 'HOUSEHOLD' ? 'Lời mời gia nhập HTX' : 'Lời mời nhân sự',
    detail: item.organization_name, when: 'Hết hạn ' + date(item.expires_at), order: item.created_at,
    to: { name: 'org-invitation', params: { invitationId: item.id }, query: { org: org.value, kind: item.kind === 'STAFF' ? 'staff' : undefined } },
  })),
  ...(data.value?.handovers ?? []).map(item => ({
    key: item.id, icon: 'swap_horiz', title: 'Tiếp nhận vận hành ao', detail: item.pond_name + ' · ' + item.household_name,
    when: 'Chờ tiếp nhận', order: item.requested_at, to: operation('handover'),
  })),
].sort((a, b) => b.order.localeCompare(a.order)))
const stats = computed(() => [
  ...(cooperative.value ? [{ label: 'Hộ thành viên', icon: 'groups', value: data.value?.households?.length, to: households.value }] : []),
  { label: 'Nhân sự', icon: 'person', value: data.value?.staff?.length, to: staff.value },
  { label: 'Ao đang quản lý', icon: 'water', value: data.value?.ponds?.unique.length, to: operation('assignment') },
  { label: 'Vụ nuôi đang hoạt động', icon: 'calendar_month', value: data.value?.batches },
])
const actions = computed(() => [
  { label: cooperative.value ? 'Mời hộ nuôi' : 'Quản lý chia sẻ', icon: 'groups', to: households.value },
  { label: 'Mời nhân sự', icon: 'person_add', to: staff.value },
  { label: 'Phân công ao', icon: 'assignment_ind', to: operation('assignment') },
  { label: 'Bàn giao ao', icon: 'swap_horiz', to: operation('handover') },
  { label: 'Xem lịch sử', icon: 'history', to: operation('history') },
])
const total = computed(() => (data.value?.ponds?.operated.length ?? 0) + (data.value?.ponds?.remaining.length ?? 0))
const share = computed(() => total.value ? Math.round(100 * (data.value?.ponds?.operated.length ?? 0) / total.value) : 0)
const ownLabel = computed(() => cooperative.value ? 'HTX vận hành' : 'Hộ tự vận hành')
const otherLabel = computed(() => cooperative.value ? 'Hộ tự vận hành' : 'Đơn vị tiếp nhận vận hành')
</script>

<template>
  <section class="workspace-overview" aria-label="Tổng quan" :aria-busy="loading">
    <LoadingState v-if="loading" label="Đang tải tổng quan…" />
    <VaAlert v-else-if="error || data?.incomplete" color="warning" outline role="alert">
      {{ error || 'Một số số liệu chưa tải được.' }} <VaButton preset="secondary" size="small" @click="load">Tải lại</VaButton>
    </VaAlert>
    <template v-if="!loading">
      <div class="workspace-stats">
        <component :is="item.to ? RouterLink : 'article'" v-for="item in stats" :key="item.label" :to="item.to" class="workspace-stat">
          <span class="workspace-icon"><VaIcon :name="item.icon" aria-hidden="true" /></span>
          <span class="workspace-stat-value">{{ item.value ?? '—' }}</span>
          <span>{{ item.label }}</span>
        </component>
      </div>

      <div class="workspace-columns">
        <section class="org-panel dashboard-panel">
          <h2>Ao theo đơn vị vận hành</h2>
          <p class="org-muted">Phạm vi ao có hồ sơ vận hành tại đơn vị.</p>
          <div v-if="total" class="workspace-chart">
            <svg viewBox="0 0 120 120" role="img" :aria-label="'Tổng ' + total + ' ao'">
              <circle cx="60" cy="60" r="49" fill="none" stroke-width="14" class="chart-other"><title>{{ otherLabel }} · {{ data?.ponds?.remaining.length }} ao</title></circle>
              <circle v-if="share" cx="60" cy="60" r="49" fill="none" stroke-width="14" pathLength="100" :stroke-dasharray="share + ' 100'" transform="rotate(-90 60 60)" class="chart-own"><title>{{ ownLabel }} · {{ data?.ponds?.operated.length }} ao</title></circle>
              <text x="60" y="61" text-anchor="middle" class="chart-total">{{ total }}</text>
              <text x="60" y="78" text-anchor="middle" class="chart-caption">Tổng số ao</text>
            </svg>
            <ul class="org-list chart-legend">
              <li><i class="chart-key chart-key-own"></i><span>{{ ownLabel }}</span><strong>{{ data?.ponds?.operated.length }} · {{ share }}%</strong></li>
              <li><i class="chart-key"></i><span>{{ otherLabel }}</span><strong>{{ data?.ponds?.remaining.length }} · {{ 100 - share }}%</strong></li>
            </ul>
          </div>
          <p v-else class="workspace-empty">{{ data?.ponds ? 'Chưa có ao trong phạm vi vận hành.' : 'Chưa tải được dữ liệu vận hành.' }}</p>
        </section>
        <section class="org-panel dashboard-panel">
          <h2>Việc cần xử lý <span v-if="tasks.length" class="workspace-badge">{{ tasks.length }}</span></h2>
          <ul v-if="tasks.length" class="org-list workspace-tasks">
            <li v-for="item in tasks.slice(0, 4)" :key="item.key">
              <span class="workspace-icon task-icon"><VaIcon :name="item.icon" aria-hidden="true" /></span>
              <div><strong>{{ item.title }}</strong><p class="org-muted">{{ item.detail }} · {{ item.when }}</p></div>
              <RouterLink :to="item.to">Xem</RouterLink>
            </li>
          </ul>
          <p v-else class="workspace-empty">{{ data?.incomplete ? 'Chưa thấy việc cần xử lý trong dữ liệu đã tải.' : 'Bạn đã xử lý hết công việc.' }}</p>
          <div v-if="tasks.length" class="org-actions">
            <RouterLink v-if="tasks.some(item => item.icon === 'mail')" :to="{ name: 'org-invitations', query: { org } }">Xem tất cả lời mời</RouterLink>
            <RouterLink v-if="data?.handovers.length" :to="operation('handover')">Xem tất cả bàn giao</RouterLink>
          </div>
        </section>
      </div>

      <div class="workspace-columns">
        <section class="org-panel dashboard-panel">
          <h2>Thao tác nhanh</h2>
          <div class="workspace-quick">
            <RouterLink v-for="item in actions" :key="item.label" :to="item.to">
              <VaIcon :name="item.icon" aria-hidden="true" /> {{ item.label }}
            </RouterLink>
          </div>
        </section>
        <section class="org-panel dashboard-panel">
          <h2>Thông tin tổ chức</h2>
          <dl>
            <dt>Mã tổ chức</dt><dd>{{ org }}</dd>
            <template v-if="data?.households?.[0] && !cooperative"><dt>Hợp tác xã</dt><dd>{{ data.households[0].cooperative_name }}</dd></template>
            <template v-if="details?.representative"><dt>Người đại diện</dt><dd>{{ details.representative }}</dd></template>
            <template v-if="details?.email"><dt>Email</dt><dd>{{ details.email }}</dd></template>
            <template v-if="details?.created_at"><dt>Ngày tạo</dt><dd>{{ date(details.created_at) }}</dd></template>
            <template v-if="!cooperative"><dt>Cơ sở độc lập</dt><dd><RouterLink :to="{ name: 'org-household-setup', query: { org } }">Gắn cơ sở riêng</RouterLink></dd></template>
          </dl>
        </section>
      </div>
    </template>
  </section>
</template>

<style src="./organizations.css"></style>
<style src="./workspace.css"></style>
