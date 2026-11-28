<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { VaAlert, VaButton, VaIcon } from 'vuestic-ui'
import { api } from '../../api/client'
import PageHeader from '../../components/PageHeader.vue'
import LoadingState from '../../components/LoadingState.vue'
import { useAuthStore } from '../../stores/auth.store'
import { errorText, organizationsPath } from './model'
import { useOrganizationData } from './useOrganizationData'

interface OwnedFarm {
  id: string
  farm_name: string
  address: string | null
  pond_count: number
}

interface HouseholdSetupOptions {
  can_create: boolean
  farms: OwnedFarm[]
  households: { id: string; name: string; cooperative_id: string | null; cooperative_name: string | null }[]
}

interface SavedHousehold {
  id: string
  name: string
  linked_count: number
}

const route = useRoute()
const auth = useAuthStore()
const scope = () => route.query.org
const { data, loading, error, load } = useOrganizationData(scope, () =>
  api.get<HouseholdSetupOptions>('/organizations/household-setup'))

const creating = computed(() => scope() === undefined)
const household = computed(() => data.value?.households.find(item => item.id === scope()))
const allowed = computed(() => creating.value ? data.value?.can_create === true : Boolean(household.value))
const farms = computed(() => data.value?.farms ?? [])
const term = ref('')
const shownFarms = computed(() => {
  const termValue = term.value.trim().toLocaleLowerCase('vi')
  return farms.value.filter(farm => `${farm.farm_name} ${farm.address ?? ''}`.toLocaleLowerCase('vi').includes(termValue))
})
const selected = ref<string[]>([])
const selectedFarms = computed(() => farms.value.filter(farm => selected.value.includes(farm.id)))
const pondCount = computed(() => selectedFarms.value.reduce((sum, farm) => sum + farm.pond_count, 0))
const name = ref('')
const address = ref('')
const saving = ref(false)
const saveError = ref('')
const saved = ref<SavedHousehold>()
const requestId = ref('')
let active = true
onScopeDispose(() => { active = false })
watch(scope, () => {
  selected.value = []
  name.value = ''
  address.value = ''
  term.value = ''
  requestId.value = ''
  saveError.value = ''
  saved.value = undefined
})
const canSave = computed(() => !saving.value && allowed.value &&
  (creating.value ? Boolean(name.value.trim()) : selectedFarms.value.length > 0))

async function save() {
  if (!canSave.value) return
  const context = scope()
  const target = household.value
  const farmIds = selectedFarms.value.map(farm => farm.id)
  saving.value = true
  saveError.value = ''
  try {
    let result: SavedHousehold
    if (target) {
      result = await api.post(`${organizationsPath(target.id)}/household-farms`, {
        farmIds, cooperativeId: target.cooperative_id,
      })
    } else {
      requestId.value ||= crypto.randomUUID()
      result = await api.post('/organizations/household-setup', {
        requestId: requestId.value, name: name.value.trim(),
        address: address.value.trim() || null, farmIds,
      })
      await auth.fetchMe()
    }
    if (active && context === scope()) saved.value = result
  } catch (cause) {
    if (active && context === scope()) saveError.value = errorText(cause)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <main class="page-container org-page household-setup" :aria-busy="loading || saving">
    <RouterLink :to="{ name: 'organizations', query: household ? { org: household.id } : {} }">← Tổ chức của tôi</RouterLink>
    <PageHeader
      :title="creating ? 'Tạo hồ sơ hộ nuôi' : 'Gắn cơ sở vào hộ nuôi'"
      :context="household?.name"
      :description="creating ? 'Dùng tài khoản hiện có để đại diện hộ và tham gia hợp tác xã.' : undefined"
    />

    <section v-if="saved" class="org-panel org-stack setup-success" role="status">
      <VaIcon name="check_circle" size="large" color="primary" aria-hidden="true" />
      <h2>{{ creating ? 'Đã tạo hồ sơ hộ nuôi' : 'Đã lưu cơ sở của hộ' }}</h2>
      <p><strong>{{ saved.name }}</strong> · {{ saved.linked_count }} cơ sở mới được gắn</p>
      <div class="org-actions">
        <VaButton :to="{ name: 'organizations', query: { org: saved.id } }">Mở hồ sơ hộ nuôi</VaButton>
        <VaButton preset="secondary" :to="{ name: 'farms' }">Xem cơ sở nuôi</VaButton>
      </div>
    </section>

    <LoadingState v-else-if="loading" label="Đang tải cơ sở nuôi…" />
    <VaAlert v-else-if="error" color="danger" outline role="alert">
      {{ error }} <VaButton size="small" preset="secondary" @click="load">Thử lại</VaButton>
    </VaAlert>

    <section v-else-if="!allowed" class="org-panel org-stack">
      <h2>{{ creating ? 'Tài khoản đã có hồ sơ tổ chức' : 'Bạn cần quyền đại diện của hộ này' }}</h2>
      <RouterLink :to="{ name: 'organizations' }">Mở Tổ chức của tôi</RouterLink>
    </section>

    <form v-else class="setup-grid" @submit.prevent="save">
      <div class="org-stack">
        <section v-if="creating" class="org-panel org-stack" aria-labelledby="household-details">
          <h2 id="household-details">Thông tin hộ nuôi</h2>
          <label class="org-select">
            Tên hộ nuôi
            <input v-model="name" required maxlength="255" placeholder="Ví dụ Hộ nuôi Tôm Xanh" :disabled="saving" />
          </label>
          <label class="org-select">
            Địa chỉ (tùy chọn)
            <input v-model="address" maxlength="1000" :disabled="saving" />
          </label>
        </section>

        <section class="org-panel org-stack" aria-labelledby="household-farms">
          <h2 id="household-farms">Cơ sở nuôi hiện có</h2>
          <p v-if="farms.length" class="org-muted">
            Chọn các cơ sở muốn đưa vào hộ. Cơ sở bỏ trống vẫn do bạn quản lý độc lập.
          </p>
          <p v-else class="org-muted">
            {{ creating ? 'Bạn có thể tạo hồ sơ trước rồi thêm cơ sở sau.' : 'Bạn chưa có cơ sở độc lập để gắn vào hộ này.' }}
          </p>
          <label v-if="farms.length > 4" class="org-select">
            Tìm theo tên hoặc địa chỉ
            <input v-model="term" type="search" :disabled="saving" />
          </label>
          <p v-if="farms.length && !shownFarms.length" class="org-muted">Không tìm thấy cơ sở phù hợp.</p>
          <ul v-if="shownFarms.length" class="org-list setup-farms">
            <li v-for="farm in shownFarms" :key="farm.id">
              <label class="org-choice setup-farm" :class="{ 'setup-farm--selected': selected.includes(farm.id) }">
                <input v-model="selected" type="checkbox" :value="farm.id" :disabled="saving" />
                <span>
                  <strong>{{ farm.farm_name }}</strong>
                  <span class="org-muted">{{ farm.pond_count }} ao<span v-if="farm.address"> · {{ farm.address }}</span></span>
                </span>
              </label>
            </li>
          </ul>
        </section>
      </div>

      <section class="org-panel org-stack setup-review" aria-labelledby="household-review">
        <h2 id="household-review">Xem lại trước khi lưu</h2>
        <p>{{ household?.name || name.trim() || 'Chưa nhập tên hộ nuôi' }}</p>
        <p class="setup-count" role="status" aria-atomic="true">{{ selectedFarms.length }} cơ sở · {{ pondCount }} ao</p>
        <ul v-if="selectedFarms.length" class="org-bullets">
          <li v-for="farm in selectedFarms" :key="farm.id">{{ farm.farm_name }}</li>
        </ul>
        <p v-if="household?.cooperative_name" class="setup-sharing">
          Các cơ sở được gắn sẽ áp dụng phạm vi chia sẻ của hộ với {{ household.cooperative_name }}.
        </p>
        <p v-else class="org-muted">
          {{ creating ? 'Bạn sẽ là đại diện hộ. HTX có quyền xem dữ liệu sau khi hộ chấp nhận lời mời và phạm vi chia sẻ.' : 'Các ao, vụ nuôi và nhật ký của cơ sở sẽ hiển thị trong hồ sơ hộ.' }}
        </p>
        <VaAlert v-if="saveError" color="danger" outline role="alert">
          {{ saveError }}
          <VaButton type="button" size="small" preset="secondary" @click="load">Tải lại danh sách</VaButton>
        </VaAlert>
        <div class="org-actions">
          <VaButton type="submit" :loading="saving" :disabled="!canSave">
            {{ creating ? 'Tạo hồ sơ hộ nuôi' : 'Gắn cơ sở đã chọn' }}
          </VaButton>
          <VaButton v-if="!saving" preset="secondary" :to="{ name: 'organizations', query: household ? { org: household.id } : {} }">
            Quay lại
          </VaButton>
        </div>
      </section>
    </form>
  </main>
</template>

<style src="./organizations.css"></style>

<style scoped>
.setup-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr);
  align-items: start;
  gap: var(--app-space-4);
}
.setup-count, .setup-sharing {
  padding: var(--app-space-3);
  border-radius: var(--app-control-radius);
  background: var(--app-primary-soft);
}
.setup-count { color: var(--app-primary-dark); font-weight: 650; }
.setup-sharing { border-inline-start: 3px solid var(--app-primary); }
.setup-farm {
  padding: var(--app-space-3);
  border: 1px solid var(--app-control-line);
  border-radius: var(--app-control-radius);
}
.setup-farm--selected, .setup-farm:focus-within { border-color: var(--app-primary); }
.setup-farm strong, .setup-farm .org-muted { display: block; }
.setup-review :deep(.va-button), .setup-success :deep(.va-button) { min-height: 44px; }
@media (max-width: 760px) {
  .setup-grid { grid-template-columns: minmax(0, 1fr); }
}
</style>
