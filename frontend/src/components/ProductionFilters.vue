<script setup lang="ts">
import { computed } from 'vue'
import type { LotOptions, ProductionFilters } from '../types/lots'
const model = defineModel<ProductionFilters>({ required: true })
const props = defineProps<{ options: LotOptions; disabled?: boolean }>()
const ponds = computed(() => props.options.ponds.filter(pond => !model.value.farmId || pond.farm_id === model.value.farmId))
function farmChanged(event: Event) {
  model.value = { ...model.value, farmId: (event.target as HTMLSelectElement).value, pondId: '' }
}
</script>

<template>
  <div class="production-filters">
    <label>Cơ sở nuôi<select :value="model.farmId" :disabled="disabled" @change="farmChanged">
      <option value="">Tất cả cơ sở</option><option v-for="farm in options.farms" :key="farm.id" :value="farm.id">{{ farm.farm_name }}</option>
    </select></label>
    <label>Ao nuôi<select v-model="model.pondId" :disabled="disabled">
      <option value="">Tất cả ao</option><option v-for="pond in ponds" :key="pond.id" :value="pond.id">{{ pond.pond_name }} · {{ pond.pond_code }}</option>
    </select></label>
    <label>Loài nuôi<select v-model="model.species" :disabled="disabled"><option value="">Tôm và cua</option><option value="SHRIMP">Tôm</option><option value="CRAB">Cua</option></select></label>
    <label>Thu hoạch từ ngày<input v-model="model.from" type="date" :max="model.to || undefined" :disabled="disabled" /></label>
    <label>Đến ngày<input v-model="model.to" type="date" :min="model.from || undefined" :disabled="disabled" /></label>
  </div>
</template>

<style scoped>
.production-filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
label { display: grid; gap: 6px; font-size: .85rem; font-weight: 600; }
select, input { width: 100%; min-height: 44px; padding: 8px 10px; border: 1px solid var(--app-control-line); border-radius: var(--app-control-radius); background: var(--app-surface); color: var(--app-ink); font: inherit; }
</style>
