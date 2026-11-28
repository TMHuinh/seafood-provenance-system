import { api } from '../../api/client'
import { handoverActions, organizationsPath, type HouseholdRelationship, type OperationPond,
  type OrganizationInvitation, type OrganizationStaff, type PondHandover } from './model'

const activeStatuses = new Set(['PREPARING', 'GROWING', 'READY_FOR_HARVEST'])
interface BatchSummary { id: string; status: string }

export function countActiveBatches(groups: BatchSummary[][]) {
  return new Set(groups.flat().filter(batch => activeStatuses.has(batch.status)).map(batch => batch.id)).size
}

export function operationGroups(ponds: OperationPond[], orgId: string) {
  const unique = [...new Map(ponds.map(pond => [pond.id, pond])).values()]
  const operated = unique.filter(pond => pond.operator_organization_id === orgId)
  const remaining = unique.filter(pond => pond.operator_organization_id && pond.operator_organization_id !== orgId)
  return { unique, operated, remaining }
}

export function pendingInvitations(items: OrganizationInvitation[], orgId: string, actorId?: string) {
  return items.filter(item => item.status === 'PENDING' && item.canRespond &&
    (item.target_organization_id === orgId || (item.organization_id === orgId && item.target_user_id === actorId)))
}

export async function loadOverview(orgId: string, includeShared: boolean) {
  const path = organizationsPath(orgId)
  const results = await Promise.allSettled([
    api.get<{ households: HouseholdRelationship[] }>(path + '/households'),
    api.get<{ staff: OrganizationStaff[] }>(path + '/staff'),
    api.get<{ ponds: OperationPond[]; handovers: PondHandover[] }>(path + '/pond-operations'),
    api.get<{ invitations: OrganizationInvitation[] }>('/organizations/invitations'),
  ] as const)
  const [relations, people, operations, invites] = results
  const households = relations.status === 'fulfilled' ? relations.value.households.filter(item => !item.ended_at) : undefined
  const staff = people.status === 'fulfilled' ? people.value.staff.filter(item => item.role === 'STAFF') : undefined
  const ponds = operations.status === 'fulfilled' ? operationGroups(operations.value.ponds, orgId) : undefined
  const handovers = operations.status === 'fulfilled' ? operations.value.handovers.filter(item => handoverActions(item, orgId).respond) : []
  const invitations = invites.status === 'fulfilled' ? invites.value.invitations : []
  const queries = [
    ...(ponds?.unique ?? []).map(pond => () => api.get<{ items: BatchSummary[] }>(
      `/farms/${encodeURIComponent(pond.farm_id)}/ponds/${encodeURIComponent(pond.id)}/batches`).then(result => result.items)),
    ...(includeShared ? households ?? [] : []).map(row => () => api.get<{ batches: BatchSummary[] }>(
      path + '/households/' + encodeURIComponent(row.id)).then(result => result.batches)),
  ]
  const groups: BatchSummary[][] = []
  let batchesFailed = !ponds || (includeShared && !households)
  for (let start = 0; !batchesFailed && start < queries.length; start += 6) {
    try {
      groups.push(...await Promise.all(queries.slice(start, start + 6).map(query => query())))
    } catch {
      batchesFailed = true
    }
  }
  return { households, staff, ponds, invitations, handovers,
    batches: batchesFailed ? undefined : countActiveBatches(groups),
    incomplete: batchesFailed || results.some(result => result.status === 'rejected') }
}
