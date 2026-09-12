const farmingLogsRepository = require('./farming-logs.repository')
const { normalizeFarmingLogInput, UUID_PATTERN } = require('./farming-logs.validation')
const blockchainService = require('../blockchain/blockchain.service')
const batchesRepository = require('../batches/batches.repository')

function createHttpError(message, status) {
  const error = new Error(message)
  error.status = status
  return error
}

function validateId(id, fieldName = 'ID') {
  if (!UUID_PATTERN.test(String(id))) {
    throw createHttpError(`${fieldName} không hợp lệ`, 400)
  }
}

async function requireAccessibleBatch(profile, batchId) {
  validateId(batchId, 'Mã lô nuôi (batchId)')

  const batch = await batchesRepository.findById(batchId)
  if (!batch) {
    throw createHttpError('Không tìm thấy lô nuôi', 404)
  }

  if (profile.role === 'ADMIN') {
    return batch
  }

  const farmOwnerId = batch.pond?.farm?.owner_id
  if (!farmOwnerId || farmOwnerId !== profile.id) {
    throw createHttpError('Bạn không có quyền thao tác trên lô nuôi này', 403)
  }

  return batch
}

async function create(profile, input) {
  const logData = normalizeFarmingLogInput(input)
  await requireAccessibleBatch(profile, logData.batch_id)
  const log = await farmingLogsRepository.create(profile.id, { ...logData, lifecycle_status: 'DRAFT' })
  await farmingLogsRepository.createAudit(profile.id, log.id, 'CREATE', null, log)
  return log
}

async function update(profile, id, input) {
  validateId(id, 'Mã nhật ký')

  const existing = await farmingLogsRepository.findById(id)
  if (!existing) {
    throw createHttpError('Không tìm thấy nhật ký nuôi', 404)
  }

  await requireAccessibleBatch(profile, existing.batch_id)
  if (existing.lifecycle_status !== 'DRAFT') throw createHttpError('Nhật ký đã xác nhận; hãy dùng chức năng Đính chính', 409)

  const changes = normalizeFarmingLogInput({
    ...input,
    batchId: existing.batch_id,
  })

  const log = await farmingLogsRepository.update(id, changes)
  await farmingLogsRepository.createAudit(profile.id, id, 'UPDATE', existing, log)
  return log
}

function blockchainPayload(log) {
  return {
    batchId: log.batch_id,
    logType: log.log_type,
    logDate: new Date(log.log_date).toISOString(),
    details: log.details,
  }
}

function legacyInputOrderDetails(logType, details) {
  switch (logType) {
    case 'FEEDING': return { feedType: details.feedType, feedAmount: details.feedAmount, note: details.note }
    case 'WATER_QUALITY': return { temperature: details.temperature, salinity: details.salinity, ph: details.ph, dissolvedOxygen: details.dissolvedOxygen, note: details.note }
    case 'MEDICINE': return { medicineName: details.medicineName, dose: details.dose, note: details.note }
    case 'MORTALITY': return { mortalityCount: details.mortalityCount, cause: details.cause, note: details.note }
    default: return { description: details.description }
  }
}

async function anchorVersion(log, profile, eventId, correctionReason = null, options = {}) {
  const result = await blockchainService.createRecord({ batchId: log.batch_id, entityType: 'FARMING_LOG', entityId: log.id, eventType: 'FARMING_LOG_RECORDED', eventId, payload: blockchainPayload(log), status: 'PENDING' })
  if (!result.submitted) throw createHttpError('Không thể xác nhận dữ liệu trên Blockchain', 502)
  const anchored = { ...log, data_hash: result.dataHash, tx_hash: result.record.transaction_hash }
  const version = await farmingLogsRepository.createVersion(anchored, profile.id, correctionReason, eventId, { ...options, blockNumber: result.record.block_number })
  return { anchored, version }
}

async function confirm(profile, id) {
  validateId(id, 'Mã nhật ký')
  const existing = await farmingLogsRepository.findById(id)
  if (!existing) throw createHttpError('Không tìm thấy nhật ký nuôi', 404)
  await requireAccessibleBatch(profile, existing.batch_id)
  if (existing.lifecycle_status !== 'DRAFT') throw createHttpError('Chỉ bản nháp mới có thể xác nhận', 409)
  const eventId = blockchainService.buildEventId('FARMING_LOG_RECORDED', id)
  const { anchored, version } = await anchorVersion(existing, profile, eventId)
  const log = await farmingLogsRepository.update(id, { data_hash: anchored.data_hash, tx_hash: anchored.tx_hash, lifecycle_status: 'CONFIRMED', current_version_id: version.id })
  await farmingLogsRepository.createAudit(profile.id, id, 'CONFIRM', existing, log)
  return log
}

async function correct(profile, id, input) {
  validateId(id, 'Mã nhật ký')
  const existing = await farmingLogsRepository.findById(id)
  if (!existing) throw createHttpError('Không tìm thấy nhật ký nuôi', 404)
  await requireAccessibleBatch(profile, existing.batch_id)
  if (existing.lifecycle_status !== 'CONFIRMED') throw createHttpError('Chỉ nhật ký đã xác nhận mới có thể đính chính', 409)
  if (Number(input?.expectedVersion) !== existing.current_version) throw createHttpError('Nhật ký đã có phiên bản mới hơn', 409)
  const reason = String(input?.correctionReason ?? '').trim()
  if (reason.length < 3 || reason.length > 1000) throw createHttpError('Lý do đính chính phải có từ 3 đến 1000 ký tự', 400)
  const changes = normalizeFarmingLogInput({ ...input, batchId: existing.batch_id })
  const nextVersion = existing.current_version + 1
  const candidate = { ...existing, ...changes, current_version: nextVersion }
  const eventId = `${blockchainService.buildEventId('FARMING_LOG_RECORDED', id)}:v${nextVersion}`
  const { anchored, version } = await anchorVersion(candidate, profile, eventId, reason, { supersedesVersionId: existing.current_version_id, evidenceUrl: input.evidenceUrl })
  await farmingLogsRepository.updateVersion(existing.current_version_id, { status: 'SUPERSEDED' })
  const log = await farmingLogsRepository.update(id, { ...changes, current_version: nextVersion, current_version_id: version.id, data_hash: anchored.data_hash, tx_hash: anchored.tx_hash })
  await farmingLogsRepository.createAudit(profile.id, id, 'UPDATE', existing, log)
  return log
}

async function revoke(profile, id, input) {
  validateId(id, 'Mã nhật ký')
  const existing = await farmingLogsRepository.findById(id)
  if (!existing) throw createHttpError('Không tìm thấy nhật ký nuôi', 404)
  await requireAccessibleBatch(profile, existing.batch_id)
  if (existing.lifecycle_status !== 'CONFIRMED') throw createHttpError('Nhật ký không ở trạng thái có thể thu hồi', 409)
  const reason = String(input?.reason ?? '').trim()
  if (reason.length < 3 || reason.length > 1000) throw createHttpError('Lý do thu hồi phải có từ 3 đến 1000 ký tự', 400)
  const eventId = `${blockchainService.buildEventId('FARMING_LOG_RECORDED', id)}:revoke:v${existing.current_version}`
  const result = await blockchainService.createRecord({ batchId: existing.batch_id, entityType: 'FARMING_LOG', entityId: id, eventType: 'FARMING_LOG_RECORDED', eventId, payload: { targetEventId: existing.current_version_id, reason }, status: 'PENDING' })
  if (!result.submitted) throw createHttpError('Không thể ghi nhận thu hồi trên Blockchain', 502)
  await farmingLogsRepository.updateVersion(existing.current_version_id, { status: 'REVOKED', revoked_by: profile.id, revoked_at: new Date().toISOString(), revocation_reason: reason })
  const log = await farmingLogsRepository.update(id, { lifecycle_status: 'REVOKED' })
  await farmingLogsRepository.createAudit(profile.id, id, 'REVOKE', existing, log)
  return log
}

async function history(profile, id) {
  validateId(id, 'Mã nhật ký')
  const log = await farmingLogsRepository.findById(id)
  if (!log) throw createHttpError('Không tìm thấy nhật ký nuôi', 404)
  await requireAccessibleBatch(profile, log.batch_id)
  return { currentVersion: log.current_version, items: await farmingLogsRepository.findVersions(id) }
}

async function listByBatch(profile, batchId) {
  await requireAccessibleBatch(profile, batchId)
  const items = await farmingLogsRepository.findAllByBatch(batchId)
  return { count: items.length, items }
}

async function verify(profile, batchId) {
  await requireAccessibleBatch(profile, batchId)

  const logs = await farmingLogsRepository.findAllByBatch(batchId)
  const records = await blockchainService.getRecordsByBatch(batchId)
  const recordByEntityId = new Map(records.map((record) => [record.entity_id, record]))

  const details = await Promise.all(logs.map(async (log) => {
    const payload = blockchainPayload(log)
    const legacyPayload = { batchId: log.batch_id, logType: log.log_type, logDate: log.log_date, details: log.details }
    const recomputedHash = blockchainService.hashData(payload)
    const legacyHash = blockchainService.hashLegacyData(legacyPayload)
    const legacyInputHash = blockchainService.hashLegacyData({
      ...payload,
      details: legacyInputOrderDetails(log.log_type, log.details),
    })
    const validPayloadHashes = new Set([recomputedHash, legacyHash, legacyInputHash])
    const storedMatches = Boolean(log.data_hash) && validPayloadHashes.has(log.data_hash)
    const record = recordByEntityId.get(log.id) ?? null
    const eventId = record?.event_id ?? blockchainService.buildEventId('FARMING_LOG_RECORDED', log.id)
    const onChainDataHash = log.lifecycle_status === 'DRAFT'
      ? ''
      : await blockchainService.getDataHashFromContract(eventId, record?.contract_address)

    const issues = []
    if (log.lifecycle_status !== 'DRAFT' && !log.data_hash) issues.push('Chưa có data_hash trên nhật ký')
    else if (!storedMatches) issues.push('Văn bản dữ liệu hiện tại không khớp data_hash đã lưu')
    if (!record) issues.push('Không có bản ghi trên blockchain_records')
    else if (record.status === 'FAILED') issues.push('Giao dịch trên blockchain đã thất bại')
    else if (record.status === 'PENDING') issues.push('Giao dịch chưa được xác nhận trên blockchain')
    else if (!validPayloadHashes.has(record.data_hash)) issues.push('data_hash của blockchain_records không khớp')
    if (log.lifecycle_status !== 'DRAFT' && !onChainDataHash) issues.push('Không có bằng chứng trên Smart Contract')
    else if (!validPayloadHashes.has(onChainDataHash)) issues.push('data_hash trên Smart Contract không khớp dữ liệu hiện tại')
    if (onChainDataHash && log.data_hash && onChainDataHash !== log.data_hash) issues.push('data_hash trong nhật ký không khớp Smart Contract')
    if (onChainDataHash && record && onChainDataHash !== record.data_hash) issues.push('blockchain_records không khớp Smart Contract')

    return {
      id: log.id,
      eventId,
      logType: log.log_type,
      logDate: log.log_date,
      dataHash: log.data_hash,
      onChainDataHash: onChainDataHash || null,
      status: log.lifecycle_status === 'DRAFT' ? 'DRAFT' : (issues.length === 0 ? 'SYNCED' : 'DESYNCED'),
      issues,
      record: record
        ? {
            eventType: record.event_type,
            status: record.status,
            txHash: record.transaction_hash,
            dataHash: record.data_hash,
          }
        : null,
    }
  }))

  const summary = {
    total: details.length,
    verified: details.filter((item) => item.status === 'SYNCED').length,
    desynced: details.filter((item) => item.status === 'DESYNCED').length,
    drafts: details.filter((item) => item.status === 'DRAFT').length,
  }

  return { batchId, checkedAt: new Date().toISOString(), summary, details }
}

module.exports = { create, update, confirm, correct, revoke, history, listByBatch, verify }
