<script setup lang="ts">
import { computed } from 'vue'
import { VaAlert, VaButton } from 'vuestic-ui'
import { api } from '../../api/client'
import EmptyState from '../../components/EmptyState.vue'
import LoadingState from '../../components/LoadingState.vue'
import PageHeader from '../../components/PageHeader.vue'
import { FARMING_LOG_TYPE_LABELS, SPECIES_LABELS, STATUS_LABELS, type BatchStatusCode, type FarmingLog, type Species } from '../../types'
import { detailsRows } from '../batches/farming-log-details'
import { quantity } from '../lots/lot-utils'
import { date, organizationsPath, type DirectoryOrganization, type HouseholdRelationship, type SharingCandidate } from './model'
import { useOrganizationData } from './useOrganizationData'

interface SharedHousehold {
  household: DirectoryOrganization
  relationship: HouseholdRelationship
  batches: (SharingCandidate & { species: Species; status: BatchStatusCode })[]
  lots: { id: string; lot_code: string; quantity: number; harvest_date: string; batch_code: string; species: Species; pond_name: string }[]
  logs: Pick<FarmingLog, 'id' | 'batch_id' | 'log_type' | 'log_date' | 'details'>[]
  sharingHistory: { created_at: string; action: string; share_logs: boolean; shared_batch_ids: string[] }[]
}

const props = defineProps<{ orgId: string; relationId: string }>()
const path = computed(() => `${organizationsPath(props.orgId)}/households/${encodeURIComponent(props.relationId)}`)
const { data, loading, error, load } = useOrganizationData(path, () => api.get<SharedHousehold>(path.value))
const batchCodes = computed(() => new Map(data.value?.batches.map(batch => [batch.id, batch.batch_code])))
</script>

<template>
  <main class="page-container org-page" :aria-busy="loading">
    <RouterLink :to="{ name: 'org-households', params: { orgId } }">← Hộ thành viên</RouterLink>
    <PageHeader title="Dữ liệu hộ thành viên" :context="data?.household.name" description="Dữ liệu hộ đồng ý chia sẻ với hợp tác xã. Bạn có quyền xem." />
    <LoadingState v-if="loading" />
    <VaAlert v-else-if="error" color="danger" role="alert">
      {{ error }} <VaButton size="small" preset="secondary" @click="load">Thử lại</VaButton>
    </VaAlert>
    <EmptyState v-else-if="!data" title="Không tìm thấy hộ thành viên" icon="groups" />
    <template v-else>
      <section class="org-panel">
        <h2>{{ data.household.name }}</h2>
        <dl>
          <dt>Địa chỉ</dt><dd>{{ data.household.address || '—' }}</dd>
          <dt>Tham gia từ</dt><dd>{{ date(data.relationship.joined_at) }}</dd>
          <dt>Chia sẻ nhật ký</dt><dd>{{ data.relationship.share_logs ? 'Đang chia sẻ' : 'Chưa chia sẻ' }}</dd>
        </dl>
      </section>
      <section class="org-panel">
        <h2>Vụ nuôi</h2>
        <p v-if="!data.batches.length" class="org-muted">Chưa có vụ nuôi được chia sẻ.</p>
        <ul v-else class="org-list org-records">
          <li v-for="batch in data.batches" :key="batch.id">
            <strong>{{ batch.batch_code }}</strong>
            <p>{{ batch.pond_name }} · {{ SPECIES_LABELS[batch.species] }} · {{ STATUS_LABELS[batch.status] }} · {{ date(batch.stocking_date) }}</p>
          </li>
        </ul>
      </section>
      <section class="org-panel">
        <h2>Lô thu hoạch</h2>
        <p v-if="!data.lots.length" class="org-muted">Chưa có lô thu hoạch được chia sẻ.</p>
        <ul v-else class="org-list org-records">
          <li v-for="lot in data.lots" :key="lot.id">
            <strong>{{ lot.lot_code }}</strong>
            <p>{{ lot.pond_name }} · {{ lot.batch_code }} · {{ SPECIES_LABELS[lot.species] }} · {{ quantity(lot.quantity) }} kg · {{ date(lot.harvest_date) }}</p>
          </li>
        </ul>
      </section>
      <section v-if="data.relationship.share_logs" class="org-panel">
        <h2>Nhật ký được chia sẻ</h2>
        <p v-if="!data.logs.length" class="org-muted">Chưa có nhật ký được chia sẻ.</p>
        <ul v-else class="org-list org-records">
          <li v-for="log in data.logs" :key="log.id">
            <details>
              <summary>{{ FARMING_LOG_TYPE_LABELS[log.log_type] }} · {{ date(log.log_date) }}<template v-if="batchCodes.get(log.batch_id)"> · {{ batchCodes.get(log.batch_id) }}</template></summary>
              <dl v-if="detailsRows(log).length">
                <template v-for="entry in detailsRows(log)" :key="entry.label">
                  <dt>{{ entry.label }}</dt><dd>{{ entry.value }}</dd>
                </template>
              </dl>
              <p v-else class="org-muted">Nhật ký chưa có nội dung chi tiết.</p>
            </details>
          </li>
        </ul>
      </section>
      <section v-if="data.sharingHistory.length" class="org-panel">
        <h2>Lịch sử chia sẻ</h2>
        <ul class="org-list org-records">
          <li v-for="(event, index) in data.sharingHistory" :key="index">
            <strong>{{ date(event.created_at) }}</strong>
            <p>{{ event.share_logs ? 'Chia sẻ nhật ký' : 'Tắt chia sẻ nhật ký' }} · {{ event.shared_batch_ids.length }} vụ cũ được chia sẻ</p>
          </li>
        </ul>
      </section>
    </template>
  </main>
</template>

<style src="./organizations.css"></style>
