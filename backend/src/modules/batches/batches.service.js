const blockchainService = require('../blockchain/blockchain.service')
const batchesRepository = require('./batches.repository')

function createNotFound(message = 'Không tìm thấy lô hàng') {
  const error = new Error(message)
  error.status = 404
  return error
}

function resolveVisibility(profile) {
  if (profile.role === 'ADMIN') {
    return { kind: 'all' }
  }
  if (profile.organization_id) {
    return { kind: 'organization', organizationId: profile.organization_id }
  }
  return { kind: 'none' }
}

async function createPondsMap(items) {
  const pondIds = [...new Set(items.map((batch) => batch.pond_id))]
  const ponds = await batchesRepository.findPondsByIds(pondIds)
  return new Map(ponds.map((pond) => [pond.id, pond]))
}

async function list(profile) {
  const visibility = resolveVisibility(profile)
  if (visibility.kind === 'none') {
    return { count: 0, items: [], summary: { total: 0, byStatus: {} } }
  }

  const result = await batchesRepository.findRecent()
  let visible = result.items
  let pondsMap = await createPondsMap(visible)

  if (visibility.kind === 'organization') {
    visible = visible.filter(
      (batch) => pondsMap.get(batch.pond_id)?.farm?.organization_id === visibility.organizationId,
    )
    pondsMap = await createPondsMap(visible)
  }

  const items = visible.map((batch) => {
    const pond = pondsMap.get(batch.pond_id)
    return {
      ...batch,
      pond: pond
        ? {
            id: pond.id,
            pond_code: pond.pond_code,
            pond_name: pond.pond_name,
            status: pond.status,
            farm_name: pond.farm?.farm_name ?? null,
          }
        : null,
    }
  })

  const count = visibility.kind === 'all' ? (result.count ?? items.length) : items.length
  const byStatus = {}
  for (const batch of items) {
    byStatus[batch.status] = (byStatus[batch.status] ?? 0) + 1
  }

  return { count, items, summary: { total: count, byStatus } }
}

async function detail(id) {
  const batch = await batchesRepository.findById(id)
  if (!batch) {
    throw createNotFound()
  }

  const [blockchain, farmingLogs, harvests, transports, distributions] = await Promise.all([
    blockchainService.getRecordsByBatch(id, '*'),
    batchesRepository.countFarmingLogs(id),
    batchesRepository.findHarvests(id),
    batchesRepository.findTransports(id),
    batchesRepository.findDistributions(id),
  ])

  return {
    batch,
    summary: { farmingLogs },
    blockchain,
    harvests,
    transports,
    distributions,
  }
}

module.exports = { detail, list }
