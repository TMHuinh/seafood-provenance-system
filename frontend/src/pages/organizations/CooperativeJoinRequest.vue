<script setup lang="ts">
import { ref, watch } from 'vue'
import { VaAlert, VaButton } from 'vuestic-ui'
import { api } from '../../api/client'
import { errorText, organizationsPath, type DirectoryOrganization, type SharingCandidate } from './model'
import SharedScopeFields from './SharedScopeFields.vue'

const props = defineProps<{ orgId: string }>()
const term = ref('')
const matches = ref<DirectoryOrganization[]>([])
const candidates = ref<SharingCandidate[]>([])
const chosen = ref<DirectoryOrganization>()
const shareLogs = ref(false)
const sharedBatchIds = ref<string[]>([])
const searching = ref(false)
const searched = ref(false)
const loadingScope = ref(false)
const ready = ref(false)
const saving = ref(false)
const error = ref('')
const sentId = ref('')
let revision = 0
watch(() => props.orgId, () => {
  revision++
  term.value = ''; matches.value = []; searched.value = false; searching.value = false
  chosen.value = undefined; loadingScope.value = false; saving.value = false; sentId.value = ''; error.value = ''
})

async function search() {
  const q = term.value.trim()
  if (searching.value || q.length < 2) return
  const version = revision
  searching.value = true
  error.value = ''
  try {
    const result = await api.get<{ cooperatives: DirectoryOrganization[] }>(
      organizationsPath(props.orgId) + '/cooperative-search?' + new URLSearchParams({ q }))
    if (version === revision) { matches.value = result.cooperatives; searched.value = true }
  } catch (cause) {
    if (version === revision) error.value = errorText(cause)
  } finally {
    if (version === revision) searching.value = false
  }
}

async function choose(item: DirectoryOrganization) {
  const version = ++revision
  chosen.value = item
  shareLogs.value = false
  sharedBatchIds.value = []
  candidates.value = []
  error.value = ''
  ready.value = false
  loadingScope.value = true
  try {
    const result = await api.get<{ batches: SharingCandidate[] }>(organizationsPath(props.orgId) + '/share-candidates')
    if (version === revision) { candidates.value = result.batches; ready.value = true }
  } catch (cause) {
    if (version === revision) error.value = errorText(cause)
  } finally {
    if (version === revision) loadingScope.value = false
  }
}

async function send() {
  if (!chosen.value || !ready.value || saving.value) return
  const version = revision
  saving.value = true
  error.value = ''
  try {
    const result = await api.post<{ id: string }>(organizationsPath(props.orgId) + '/join-requests', {
      cooperativeId: chosen.value.id, shareLogs: shareLogs.value, sharedBatchIds: sharedBatchIds.value,
    })
    if (version === revision) sentId.value = result.id
  } catch (cause) {
    if (version === revision) error.value = errorText(cause)
  } finally {
    if (version === revision) saving.value = false
  }
}
</script>

<template>
  <section class="org-panel org-stack">
    <h2>Tìm hợp tác xã để gia nhập</h2>
    <VaAlert v-if="sentId" color="success" outline role="status">
      Đã gửi yêu cầu đến {{ chosen?.name }}.
      <RouterLink :to="{ name: 'org-invitation', params: { invitationId: sentId }, query: { org: orgId } }">Xem yêu cầu</RouterLink>
    </VaAlert>
    <template v-else-if="chosen">
      <form class="org-stack" @submit.prevent="send">
        <div><strong>{{ chosen.name }}</strong><p v-if="chosen.address" class="org-muted">{{ chosen.address }}</p></div>
        <p>Khi HTX duyệt, thông tin cơ bản của hộ, ao liên quan, vụ nuôi và lô thu hoạch mới được chia sẻ theo quy định hiện hành.</p>
        <p v-if="loadingScope" role="status">Đang tải các vụ nuôi có thể chia sẻ…</p>
        <SharedScopeFields v-else-if="ready" v-model:share-logs="shareLogs" v-model:shared-batch-ids="sharedBatchIds" :candidates="candidates" :disabled="saving" />
        <div class="org-actions">
          <VaButton type="submit" :loading="saving" :disabled="!ready || saving">Gửi yêu cầu gia nhập</VaButton>
          <VaButton v-if="!ready && !loadingScope" type="button" preset="secondary" @click="choose(chosen)">Thử tải lại</VaButton>
          <VaButton type="button" preset="secondary" :disabled="saving" @click="chosen = undefined; error = ''; revision++">Chọn HTX khác</VaButton>
        </div>
      </form>
    </template>
    <template v-else>
      <form class="org-search" @submit.prevent="search">
        <label class="org-select">Tên hợp tác xã
          <input v-model="term" type="search" maxlength="100" :disabled="searching" />
        </label>
        <VaButton type="submit" :loading="searching" :disabled="searching || term.trim().length < 2">Tìm kiếm</VaButton>
      </form>
      <p v-if="searched && !matches.length" class="org-muted" role="status">Không tìm thấy hợp tác xã phù hợp.</p>
      <ul v-if="matches.length" class="org-list org-records">
        <li v-for="item in matches" :key="item.id" class="org-row">
          <div><strong>{{ item.name }}</strong><p v-if="item.address" class="org-muted">{{ item.address }}</p></div>
          <VaButton preset="secondary" :disabled="searching" @click="choose(item)">Chọn hợp tác xã</VaButton>
        </li>
      </ul>
    </template>
    <VaAlert v-if="error" color="danger" role="alert">{{ error }}</VaAlert>
  </section>
</template>
