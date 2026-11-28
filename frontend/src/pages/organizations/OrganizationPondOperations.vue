<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { VaAlert, VaButton, VaInput } from 'vuestic-ui'
import { api } from '../../api/client'
import EmptyState from '../../components/EmptyState.vue'
import LoadingState from '../../components/LoadingState.vue'
import PageHeader from '../../components/PageHeader.vue'
import { assignmentPermissions, date, errorText, handoverActions, handoverStatuses, isOrganizationLead, organizationsPath, permissionLabels,
  type HouseholdRelationship, type Membership, type OperationPond, type OrganizationStaff, type PondAssignment, type PondHandover, type PondPermission } from './model'
import { useOrganizationData } from './useOrganizationData'

interface Operations {
  ponds: OperationPond[]
  assignments: PondAssignment[]
  handovers: PondHandover[]
}

const props = defineProps<{ orgId: string }>()
const route = useRoute()
const view = computed(() => route.query.view === 'history' || route.query.view === 'handover' ? route.query.view : 'assignment')
const archivedHandovers = computed(() => handovers.value.filter(item => item.status !== 'PENDING' && item.status !== 'ACCEPTED'))
const visibleHandovers = computed(() => view.value === 'history' ? archivedHandovers.value : handovers.value.filter(item =>
  item.status === 'PENDING' || item.status === 'ACCEPTED'))
const viewTitle = computed(() => ({ assignment: 'Phân công ao', handover: 'Bàn giao quyền vận hành', history: 'Lịch sử vận hành' })[view.value])
const scope = () => props.orgId
const { data, loading, error, load } = useOrganizationData(scope, async () => {
  const id = props.orgId
  const path = organizationsPath(id)
  const { memberships } = await api.get<{ memberships: Membership[] }>('/organizations/workspace')
  const member = memberships.find(item => item.organization_id === id)
  if (!isOrganizationLead(member)) return { member, operations: undefined, staff: [], relationship: undefined }
  const [operations, { staff }, { households }] = await Promise.all([
    api.get<Operations>(`${path}/pond-operations`),
    api.get<{ staff: OrganizationStaff[] }>(`${path}/staff`),
    member?.role === 'REPRESENTATIVE' ? api.get<{ households: HouseholdRelationship[] }>(`${path}/households`) : { households: [] },
  ])
  return { member, operations, staff: staff.filter(item => item.role === 'STAFF'), relationship: households.find(item => !item.ended_at) }
})

const ponds = computed(() => data.value?.operations?.ponds ?? [])
const assignments = computed(() => data.value?.operations?.assignments ?? [])
const handovers = computed(() => data.value?.operations?.handovers ?? [])
const relationship = computed(() => data.value?.relationship)
const pondNames = computed(() => new Map([
  ...handovers.value.map(item => [item.pond_id, item.pond_name] as const),
  ...ponds.value.map(item => [item.id, item.pond_name] as const),
]))
const managedPonds = computed(() => ponds.value.filter(pond => pond.operator_organization_id === props.orgId))
const handoverCandidates = computed(() => managedPonds.value.filter(pond => pond.owner_organization_id === props.orgId
  && !handovers.value.some(item => item.pond_id === pond.id && (item.status === 'PENDING' || item.status === 'ACCEPTED'))))
const staff = computed(() => data.value?.staff ?? [])

const pondId = ref('')
const selectedPond = computed(() => managedPonds.value.find(pond => pond.id === pondId.value))
const userId = ref('')
const startsAt = ref('')
const note = ref('')
const permissions = ref<PondPermission[]>([])
const handoverPondId = ref('')
const saving = ref('')
const actionError = ref('')
const success = ref('')

function reset() {
  pondId.value = ''
  userId.value = ''
  startsAt.value = ''
  note.value = ''
  permissions.value = []
  handoverPondId.value = ''
}
watch(scope, () => { reset(); actionError.value = ''; success.value = '' })

async function mutate(task: string, request: () => Promise<unknown>, message: string, after?: () => void) {
  if (saving.value || !isOrganizationLead(data.value?.member)) return
  const context = props.orgId
  saving.value = task
  actionError.value = ''
  success.value = ''
  try {
    await request()
    if (context === props.orgId) {
      after?.()
      success.value = message
      await load()
    }
  } catch (cause) {
    if (context === props.orgId) actionError.value = errorText(cause)
  } finally {
    saving.value = ''
  }
}
function assign() {
  if (!selectedPond.value || !userId.value || selectedPond.value.scheduled_assignment_id) return
  const scheduled = startsAt.value ? new Date(`${startsAt.value}:00+07:00`) : null
  if (scheduled && Number.isNaN(scheduled.getTime())) {
    actionError.value = 'Thời điểm bắt đầu không hợp lệ.'
    return
  }
  const expectedAssignmentId = selectedPond.value.current_assignment_id
  if (expectedAssignmentId && !window.confirm('Thay đổi người phụ trách ao? Quyền của người cũ theo phân công sẽ kết thúc tại thời điểm người mới tiếp nhận. Hồ sơ đã tạo vẫn giữ tác giả.')) return
  const payload = {
    pondId: pondId.value,
    userId: userId.value,
    note: note.value.trim() || null,
    permissions: ['READ', ...permissions.value],
    expectedAssignmentId,
    ...(scheduled ? { startsAt: scheduled.toISOString() } : {}),
  }
  void mutate('assignment', () => api.post(`${organizationsPath(props.orgId)}/assignments`, payload), 'Đã lưu phân công.', reset)
}
function assignmentState(item: PondAssignment) {
  const pond = ponds.value.find(pond => pond.id === item.pond_id)
  if (pond?.current_assignment_id === item.id) return 'Đang phụ trách'
  if (pond?.scheduled_assignment_id === item.id) return 'Sắp tiếp nhận'
  if (item.ends_at === item.starts_at) return 'Đã hủy'
  return 'Đã kết thúc'
}
function endAssignment(item: PondAssignment) {
  const isScheduled = assignmentState(item) === 'Sắp tiếp nhận'
  const confirmed = window.confirm(isScheduled
    ? 'Hủy phân công sắp tới? Người được phân công sẽ không tiếp nhận ao theo lịch này.'
    : 'Kết thúc phân công? Quyền truy cập theo phân công của người phụ trách sẽ kết thúc. Hồ sơ đã tạo vẫn được lưu.')
  if (!confirmed) return
  void mutate(item.id, () => api.post(`${organizationsPath(props.orgId)}/assignments/${item.id}/end`), 'Đã cập nhật phân công.')
}
function proposeHandover() {
  if (!relationship.value || !handoverPondId.value || !window.confirm('Đề nghị bàn giao quyền vận hành ao? Khi hợp tác xã tiếp nhận, đơn vị vận hành sẽ thay đổi. Hộ tiếp tục sở hữu ao và toàn bộ hồ sơ hiện có được lưu.')) return
  const payload = { pondId: handoverPondId.value, cooperativeId: relationship.value.cooperative_id }
  void mutate('handover', () => api.post(`${organizationsPath(props.orgId)}/handovers`, payload), 'Đã gửi đề nghị bàn giao.', () => { handoverPondId.value = '' })
}
function respondHandover(item: PondHandover, accept: boolean) {
  if (accept && !window.confirm('Tiếp nhận vận hành ao? Hợp tác xã sẽ chịu trách nhiệm vận hành ao từ thời điểm tiếp nhận. Hộ tiếp tục sở hữu ao.')) return
  void mutate(item.id, () => api.post(`${organizationsPath(props.orgId)}/handovers/${item.id}/respond`, { accept }),
    accept ? 'Đã tiếp nhận vận hành ao.' : 'Đã từ chối bàn giao.')
}
function endHandover(item: PondHandover) {
  const confirmed = window.confirm(item.status === 'PENDING'
    ? 'Hủy đề nghị bàn giao? Lời đề nghị sẽ hết hiệu lực.'
    : 'Kết thúc bàn giao? Quyền vận hành ao sẽ trở lại hộ. Quyền truy cập phát sinh từ việc bàn giao sẽ kết thúc.')
  if (!confirmed) return
  void mutate(item.id, () => api.post(`${organizationsPath(props.orgId)}/handovers/${item.id}/end`), 'Đã cập nhật bàn giao.')
}
</script>

<template>
  <main class="page-container org-page" :aria-busy="loading">
    <RouterLink :to="{ name: 'organizations', query: { org: orgId } }">← Tổ chức của tôi</RouterLink>
    <PageHeader :title="viewTitle" />
    <VaAlert v-if="success" color="success" outline role="status">{{ success }}</VaAlert>
    <VaAlert v-if="actionError" color="danger" outline role="alert">{{ actionError }}</VaAlert>
    <LoadingState v-if="loading" />
    <VaAlert v-else-if="error" color="danger" role="alert">
      {{ error }} <VaButton size="small" preset="secondary" @click="load">Thử lại</VaButton>
    </VaAlert>
    <EmptyState v-else-if="!isOrganizationLead(data?.member)" title="Bạn không có quyền quản lý vận hành của đơn vị này" icon="water" />
    <template v-else>
      <section v-if="view === 'assignment'" class="org-panel org-stack">
        <h2>Ao đang vận hành</h2>
        <p v-if="!managedPonds.length" class="org-muted">Đơn vị chưa có ao đang vận hành.</p>
        <ul v-else class="org-list org-records">
          <li v-for="pond in managedPonds" :key="pond.id" class="org-row">
            <div>
              <strong>{{ pond.pond_name }} · {{ pond.pond_code }}</strong>
              <p>{{ pond.owner_organization_id === orgId ? 'Ao thuộc sở hữu của đơn vị' : 'Ao đang vận hành theo bàn giao' }}</p>
            </div>
            <RouterLink v-if="pond.farm_id" :to="{ name: 'pond-batches', params: { farmId: pond.farm_id, pondId: pond.id } }">Mở vụ nuôi</RouterLink>
          </li>
        </ul>
      </section>

      <section v-if="view === 'assignment'" class="org-panel org-stack">
        <h2>Phân công người phụ trách</h2>
        <p v-if="!managedPonds.length || !staff.length" class="org-muted">
          {{ !managedPonds.length ? 'Cần có ao đang vận hành để phân công.' : 'Mời nhân sự tham gia đơn vị để phân công.' }}
        </p>
        <form v-else class="org-stack" @submit.prevent="assign">
          <div class="org-form-grid">
            <label class="org-select">Ao nuôi
              <select v-model="pondId" required :disabled="Boolean(saving)">
                <option value="" disabled>Chọn ao</option>
                <option v-for="pond in managedPonds" :key="pond.id" :value="pond.id">{{ pond.pond_name }} · {{ pond.pond_code }}</option>
              </select>
            </label>
            <label class="org-select">Người phụ trách
              <select v-model="userId" required :disabled="Boolean(saving)">
                <option value="" disabled>Chọn nhân sự</option>
                <option v-for="person in staff" :key="person.user_id" :value="person.user_id">{{ person.full_name }}</option>
              </select>
            </label>
            <label class="org-select">Thời điểm bắt đầu (giờ Việt Nam)
              <input v-model="startsAt" type="datetime-local" :disabled="Boolean(saving)" />
            </label>
            <VaInput v-model="note" label="Ghi chú phân công" maxlength="2000" :disabled="Boolean(saving)" />
          </div>
          <p class="org-muted">Để trống thời điểm bắt đầu nếu muốn áp dụng ngay.</p>
          <p v-if="selectedPond?.scheduled_assignment_id">Ao đã có lịch tiếp nhận. Hủy phân công sắp tới để đặt lịch mới.</p>
          <fieldset class="org-fields" :disabled="Boolean(saving)">
            <legend>Quyền nghiệp vụ</legend>
            <p>Người được phân công có quyền xem ao và hồ sơ vụ nuôi.</p>
            <div class="org-form-grid">
              <label v-for="permission in assignmentPermissions" :key="permission" class="org-choice">
                <input v-model="permissions" type="checkbox" :value="permission" />
                <span>{{ permissionLabels[permission] }}</span>
              </label>
            </div>
          </fieldset>
          <div class="org-actions">
            <VaButton type="submit" :loading="saving === 'assignment'" :disabled="Boolean(saving) || !selectedPond || !userId || Boolean(selectedPond.scheduled_assignment_id)">Lưu phân công</VaButton>
          </div>
        </form>
      </section>
      <section v-if="view !== 'handover'" class="org-panel org-stack">
        <h2>Lịch sử phân công</h2>
        <p v-if="!assignments.length" class="org-muted">Chưa có phân công.</p>
        <ul v-else class="org-list org-records">
          <li v-for="item in assignments" :key="item.id" class="org-row">
            <div>
              <strong>{{ item.full_name }}<template v-if="pondNames.has(item.pond_id)"> · {{ pondNames.get(item.pond_id) }}</template></strong>
              <p>{{ assignmentState(item) }} · Từ {{ date(item.starts_at, true) }}<template v-if="item.ends_at"> đến {{ date(item.ends_at, true) }}</template></p>
              <p>{{ item.permissions.map(permission => permissionLabels[permission]).join(' · ') }}</p>
              <p v-if="item.note" class="org-muted">{{ item.note }}</p>
            </div>
            <VaButton v-if="view === 'assignment' && ['Đang phụ trách', 'Sắp tiếp nhận'].includes(assignmentState(item))"
              preset="secondary" color="danger" :loading="saving === item.id" :disabled="Boolean(saving)" @click="endAssignment(item)">
              {{ assignmentState(item) === 'Sắp tiếp nhận' ? 'Hủy lịch tiếp nhận' : 'Kết thúc phân công' }}
            </VaButton>
          </li>
        </ul>
      </section>

      <section v-if="view !== 'assignment'" class="org-panel org-stack">
        <h2>{{ view === 'history' ? 'Lịch sử bàn giao' : 'Đề nghị và bàn giao đang hiệu lực' }}</h2>
        <form v-if="view === 'handover' && relationship && handoverCandidates.length" class="org-search" @submit.prevent="proposeHandover">
          <label class="org-select">Ao đề nghị bàn giao cho {{ relationship.cooperative_name }}
            <select v-model="handoverPondId" required :disabled="Boolean(saving)">
              <option value="" disabled>Chọn ao</option>
              <option v-for="pond in handoverCandidates" :key="pond.id" :value="pond.id">{{ pond.pond_name }} · {{ pond.pond_code }}</option>
            </select>
          </label>
          <VaButton type="submit" :loading="saving === 'handover'" :disabled="Boolean(saving) || !handoverPondId">Gửi đề nghị</VaButton>
        </form>
        <p v-if="!visibleHandovers.length" class="org-muted">Chưa có đề nghị hoặc lịch sử bàn giao.</p>
        <ul v-else class="org-list org-records">
          <li v-for="item in visibleHandovers" :key="item.id" class="org-row">
            <div>
              <strong>{{ item.pond_name }} · {{ item.pond_code }}</strong>
              <p>{{ item.household_name }} → {{ item.cooperative_name }}</p>
              <p>{{ handoverStatuses[item.status] }} · Đề nghị {{ date(item.requested_at) }}<template v-if="item.responded_at"> · Phản hồi {{ date(item.responded_at) }}</template><template v-if="item.returned_at"> · Hoàn tất {{ date(item.returned_at) }}</template></p>
            </div>
            <div class="org-actions">
              <VaButton v-if="handoverActions(item, orgId).respond" :disabled="Boolean(saving)" @click="respondHandover(item, true)">Tiếp nhận</VaButton>
              <VaButton v-if="handoverActions(item, orgId).respond" preset="secondary" :disabled="Boolean(saving)" @click="respondHandover(item, false)">Từ chối</VaButton>
              <VaButton v-if="handoverActions(item, orgId).end" preset="secondary" color="danger" :loading="saving === item.id" :disabled="Boolean(saving)" @click="endHandover(item)">
                {{ item.status === 'PENDING' ? 'Hủy đề nghị' : 'Kết thúc bàn giao' }}
              </VaButton>
            </div>
          </li>
        </ul>
      </section>
      <div v-if="view === 'history'" class="org-actions">
        <VaButton preset="secondary" :to="{ name: 'org-staff', params: { orgId }, hash: '#lich-su-nhan-su' }">Lịch sử nhân sự</VaButton>
        <VaButton preset="secondary" :to="{ name: 'org-households', params: { orgId }, hash: '#lich-su-thanh-vien' }">Lịch sử thành viên</VaButton>
      </div>
    </template>
  </main>
</template>

<style src="./organizations.css"></style>
