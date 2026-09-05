const blockchainService = require('../blockchain/blockchain.service')
const batchesRepository = require('./batches.repository')
const farmsRepository = require('../farms/farms.repository')
const pondsRepository = require('../ponds/ponds.repository')
const { normalizeBatchInput } = require('./batches.validation')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function httpError(message, status) { const error = new Error(message); error.status = status; return error }
function validId(id, label) { if (!UUID.test(String(id))) throw httpError(`${label} không hợp lệ`, 400) }
async function requireOwnedPond(profile, farmId, pondId) {
  validId(farmId, 'Mã cơ sở'); validId(pondId, 'Mã ao')
  const farm = await farmsRepository.findByIdAndOwner(farmId, profile.id)
  if (!farm) throw httpError('Không tìm thấy cơ sở nuôi', 404)
  const pond = await pondsRepository.findByIdAndFarm(pondId, farmId)
  if (!pond) throw httpError('Không tìm thấy ao nuôi', 404)
  return pond
}
function mapWriteError(error) { if (error.code === '23505') throw httpError('Mã vụ nuôi đã tồn tại', 409); if (error.code === '23503') throw httpError('Không thể xóa vụ nuôi đang có dữ liệu liên quan', 409); throw error }

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

async function listByPond(profile, farmId, pondId) { await requireOwnedPond(profile, farmId, pondId); const items = await batchesRepository.findAllByPond(pondId); return { count: items.length, items } }
async function createForPond(profile, farmId, pondId, input) { await requireOwnedPond(profile, farmId, pondId); try { return await batchesRepository.create(pondId, normalizeBatchInput(input)) } catch (e) { mapWriteError(e) } }
async function updateForPond(profile, farmId, pondId, id, input) { await requireOwnedPond(profile, farmId, pondId); validId(id, 'Mã vụ nuôi'); const existing = await batchesRepository.findById(id); if (!existing || existing.pond_id !== pondId) throw httpError('Không tìm thấy vụ nuôi', 404); try { const changes = normalizeBatchInput({ ...input, currentStockingDate: existing.stocking_date, currentStatus: existing.status }, { partial: true }); return await batchesRepository.updateByPond(id, pondId, changes) } catch (e) { mapWriteError(e) } }
async function removeForPond(profile, farmId, pondId, id) { await requireOwnedPond(profile, farmId, pondId); validId(id, 'Mã vụ nuôi'); try { const item = await batchesRepository.removeByPond(id, pondId); if (!item) throw httpError('Không tìm thấy vụ nuôi', 404) } catch (e) { mapWriteError(e) } }

module.exports = { createForPond, detail, list, listByPond, removeForPond, updateForPond }
