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
async function createForPond(profile, farmId, pondId, input) {
  await requireOwnedPond(profile, farmId, pondId)
  const normalized = normalizeBatchInput(input)
  let batch
  try {
    batch = await batchesRepository.create(pondId, normalized)
  } catch (error) {
    mapWriteError(error)
  }

  // Anchor the initial snapshot. Later edits must not overwrite this event.
  const payload = {
    batchId: batch.id,
    farmId,
    pondId: batch.pond_id,
    batchCode: batch.batch_code,
    species: batch.species,
    seedSource: batch.seed_source ?? null,
    seedQuantity: batch.seed_quantity,
    stockingDate: new Date(batch.stocking_date).toISOString(),
    expectedHarvestDate: batch.expected_harvest_date
      ? new Date(batch.expected_harvest_date).toISOString() : null,
    status: batch.status,
    note: batch.note ?? null,
  }
  try {
    const { record } = await blockchainService.createRecord({
      batchId: batch.id,
      entityType: 'BATCH',
      entityId: batch.id,
      eventType: 'BATCH_CREATED',
      payload,
    })
    return { batch, blockchain: { status: record.status, transactionHash: record.transaction_hash } }
  } catch (error) {
    // The batch already exists, and the chain may have accepted the transaction.
    // Do not return a creation error that would encourage a duplicate submission.
    console.error('Không thể lưu kết quả blockchain cho vụ nuôi:', error)
    return { batch, blockchain: { status: 'UNKNOWN', transactionHash: null } }
  }
}
async function updateForPond(profile, farmId, pondId, id, input) {
  await requireOwnedPond(profile, farmId, pondId)
  validId(id, 'Mã vụ nuôi')
  const existing = await batchesRepository.findById(id)
  if (!existing || existing.pond_id !== pondId) throw httpError('Không tìm thấy vụ nuôi', 404)
  const reason = String(input?.correctionReason ?? '').trim()
  if (reason.length < 3 || reason.length > 1000) throw httpError('Lý do đính chính phải có từ 3 đến 1000 ký tự', 400)
  if (!Number.isInteger(input?.expectedVersion) || input.expectedVersion !== existing.current_version) {
    throw httpError('Vụ nuôi đã thay đổi hoặc thiếu phiên bản. Vui lòng tải lại danh sách trước khi đính chính', 409)
  }
  const changes = normalizeBatchInput({
    ...input, currentStockingDate: existing.stocking_date, currentStatus: existing.status,
  }, { partial: true })
  let batch
  try {
    batch = await batchesRepository.correctByPond(id, pondId, changes, input.expectedVersion, reason, profile.id)
  } catch (error) {
    if (error.code === '40001') throw httpError('Vụ nuôi đã có phiên bản mới. Vui lòng tải lại danh sách', 409)
    if (error.code === 'P0002') throw httpError('Không tìm thấy vụ nuôi', 404)
    mapWriteError(error)
  }
  const eventId = `BATCH_CORRECTED:${id}:v${batch.current_version}`
  // The snapshot is already durable before sending a transaction. Preserve it
  // even if the chain is unavailable so a later reconciliation remains possible.
  try {
    const { record } = await blockchainService.createRecord({
      batchId: id, entityType: 'BATCH', entityId: id,
      eventType: 'BATCH_CORRECTED', eventId,
      payload: { batch, correctionReason: reason, correctedBy: profile.id },
    })
    return { batch, blockchain: { status: record.status, transactionHash: record.transaction_hash } }
  } catch (error) {
    console.error('Không thể lưu kết quả blockchain cho đính chính vụ nuôi:', error)
    return { batch, blockchain: { status: 'UNKNOWN', transactionHash: null } }
  }
}

async function historyForPond(profile, farmId, pondId, id) {
  await requireOwnedPond(profile, farmId, pondId)
  validId(id, 'Mã vụ nuôi')
  const batch = await batchesRepository.findById(id)
  if (!batch || batch.pond_id !== pondId) throw httpError('Không tìm thấy vụ nuôi', 404)
  const [items, records] = await Promise.all([
    batchesRepository.findVersions(id), blockchainService.getRecordsByBatch(id),
  ])
  return { items: items.map((version) => ({
    ...version, blockchain: records.find((record) => record.event_id === version.blockchain_event_id) ?? null,
  })) }
}

async function removeForPond(profile, farmId, pondId, id) { await requireOwnedPond(profile, farmId, pondId); validId(id, 'Mã vụ nuôi'); try { const item = await batchesRepository.removeByPond(id, pondId); if (!item) throw httpError('Không tìm thấy vụ nuôi', 404) } catch (e) { mapWriteError(e) } }

module.exports = { historyForPond, createForPond, detail, list, listByPond, removeForPond, updateForPond }
