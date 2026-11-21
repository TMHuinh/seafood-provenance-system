<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { VaAlert, VaButton } from 'vuestic-ui'
import { useRouter } from 'vue-router'
import PageHeader from '../../components/PageHeader.vue'
import EmptyState from '../../components/EmptyState.vue'
import { useFarmsStore } from '../../stores/farms.store'
import { usePondsStore } from '../../stores/ponds.store'
import { usePondBatchesStore } from '../../stores/pond-batches.store'
import { SPECIES_LABELS } from '../../types'

const props = defineProps<{ section: 'ponds' | 'batches' | 'logs' | 'harvest' }>()
const router = useRouter()
const farms = useFarmsStore()
const ponds = usePondsStore()
const batches = usePondBatchesStore()
const farmId = ref('')
const pondId = ref('')
const batchId = ref('')
const needsPond = computed(() => props.section !== 'ponds')
const needsBatch = computed(() => props.section === 'logs' || props.section === 'harvest')
const titles = { ponds: 'Ao nuôi', batches: 'Vụ nuôi', logs: 'Nhật ký nuôi', harvest: 'Thu hoạch & Lô hàng' }
const error = computed(() => farms.error || (needsPond.value && farmId.value && ponds.error)
  || (needsBatch.value && pondId.value && batches.error))
const loading = computed(() => farms.loading || (needsPond.value && !!farmId.value && ponds.loading)
  || (needsBatch.value && !!pondId.value && batches.loading))
const ready = computed(() => !!farmId.value && (!needsPond.value || !!pondId.value)
  && (!needsBatch.value || !!batchId.value) && !loading.value && !error.value)

watch(farmId, (id) => {
  pondId.value = ''
  batchId.value = ''
  if (id && needsPond.value) void ponds.load(id)
})
watch(pondId, (id) => {
  batchId.value = ''
  if (id && needsBatch.value) void batches.load(farmId.value, id)
})
watch(() => props.section, () => {
  farmId.value = ''
  pondId.value = ''
  batchId.value = ''
})

function retry() {
  if (farms.error) void farms.load()
  else if (ponds.error && farmId.value) void ponds.load(farmId.value)
  else if (pondId.value) void batches.load(farmId.value, pondId.value)
}

function open(createLog = false) {
  if (!ready.value) return
  if (props.section === 'ponds') {
    void router.push({ name: 'ponds', params: { farmId: farmId.value } })
    return
  }
  const params = { farmId: farmId.value, pondId: pondId.value }
  if (props.section === 'logs') {
    void router.push({ name: 'farming-logs', params: { ...params, batchId: batchId.value }, query: createLog ? { create: 'log' } : {} })
    return
  }
  void router.push({ name: 'pond-batches', params, query: needsBatch.value ? { harvest: batchId.value } : {} })
}

onMounted(() => farms.load())
</script>

<template>
  <main class="page-container">
    <PageHeader :title="titles[section]" description="Chọn phạm vi quản lý để mở đúng hồ sơ." />
    <div class="scope-card" :aria-busy="loading">
      <va-alert v-if="error" color="danger" role="alert">
        {{ error }} <va-button size="small" preset="secondary" @click="retry">Thử lại</va-button>
      </va-alert>
      <EmptyState v-if="!farms.loading && !farms.error && !farms.items.length" title="Chưa có cơ sở nuôi">
        <RouterLink :to="{ name: 'farms' }">Mở quản lý cơ sở</RouterLink>
      </EmptyState>
      <form v-else class="scope-form" @submit.prevent="open()">
        <label>Cơ sở nuôi
          <select v-model="farmId" :disabled="farms.loading">
            <option value="">Chọn cơ sở</option>
            <option v-for="farm in farms.items" :key="farm.id" :value="farm.id">{{ farm.farm_name }}</option>
          </select>
        </label>
        <label v-if="needsPond">Ao nuôi
          <select v-model="pondId" :disabled="!farmId || ponds.loading">
            <option value="">{{ farmId && !ponds.loading && !ponds.items.length ? 'Cơ sở chưa có ao' : 'Chọn ao' }}</option>
            <option v-for="pond in farmId ? ponds.items : []" :key="pond.id" :value="pond.id">
              {{ pond.pond_name }} · {{ pond.pond_code }}
            </option>
          </select>
        </label>
        <label v-if="needsBatch">Vụ nuôi
          <select v-model="batchId" :disabled="!pondId || batches.loading">
            <option value="">{{ pondId && !batches.loading && !batches.items.length ? 'Ao chưa có vụ nuôi' : 'Chọn vụ' }}</option>
            <option v-for="batch in pondId ? batches.items : []" :key="batch.id" :value="batch.id">
              {{ batch.batch_code }} · {{ SPECIES_LABELS[batch.species] }}
            </option>
          </select>
        </label>
        <div class="scope-actions">
        <va-button type="submit" icon="arrow_forward" :disabled="!ready" :loading="loading">
          Mở {{ titles[section].toLocaleLowerCase('vi') }}
        </va-button>
        <va-button v-if="section === 'logs'" type="button" preset="secondary" icon="add" :disabled="!ready" @click="open(true)">
          Ghi nhật ký mới
        </va-button>
        </div>
      </form>
      <RouterLink v-if="needsPond && farmId && !ponds.loading && !ponds.error && !ponds.items.length"
        :to="{ name: 'ponds', params: { farmId } }">Quản lý ao tại cơ sở này</RouterLink>
      <RouterLink v-if="needsBatch && pondId && !batches.loading && !batches.error && !batches.items.length"
        :to="{ name: 'pond-batches', params: { farmId, pondId } }">Quản lý vụ tại ao này</RouterLink>
    </div>
  </main>
</template>

<style scoped>
.scope-card { max-width: 760px; padding: clamp(16px, 4vw, 28px); border: 1px solid var(--app-line); border-radius: var(--app-radius); background: var(--app-surface); }
.scope-form { display: grid; gap: 14px; }
.scope-card > * + * { margin-top: 12px; }
.scope-form label { display: grid; gap: 6px; font-weight: 600; }
.scope-form select { width: 100%; min-height: 44px; padding: 8px 12px; border: 1px solid var(--app-control-line); border-radius: var(--app-control-radius); background: var(--app-surface); color: var(--app-ink); font: inherit; }
.scope-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.scope-form .va-button { justify-self: start; min-height: 44px; }
a { color: var(--app-primary-dark); text-decoration: underline; }
</style>
