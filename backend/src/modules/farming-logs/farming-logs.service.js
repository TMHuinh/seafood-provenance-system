const { requirePondAction } = require('../ponds/pond-access')
const farmingLogsRepository = require('./farming-logs.repository')
const { normalizeFarmingLogInput, UUID_PATTERN } = require('./farming-logs.validation')
const blockchainService = require('../blockchain/blockchain.service')
const batchesRepository = require('../batches/batches.repository')
const LOG_NOT_FOUND = 'Không tìm thấy nhật ký nuôi'

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

async function requireAccessibleBatch(profile, batchId, action, notFound = 'Không tìm thấy lô nuôi') {
  validateId(batchId, 'Mã lô nuôi (batchId)')

  const batch = await batchesRepository.findById(batchId)
  if (!batch) {
    throw createHttpError(notFound, 404)
  }

  await requirePondAction(profile, batch.pond_id, action, { notFound })
  return batch
}

async function requireAccessibleLog(profile, id, action) {
  validateId(id, 'Mã nhật ký')
  const log = await farmingLogsRepository.findById(id)
  if (!log) throw createHttpError(LOG_NOT_FOUND, 404)
  const batch = await requireAccessibleBatch(profile, log.batch_id, action, LOG_NOT_FOUND)
  return { log, batch }
}

async function create(profile, input) {
  const logData = normalizeFarmingLogInput(input)
  await requireAccessibleBatch(profile, logData.batch_id, 'LOG_CREATE')
  return farmingLogsRepository.create(profile.id, logData)
}

async function authorizeImageUpload(profile, batchId) {
  await requireAccessibleBatch(profile, batchId, 'LOG_CREATE')
}

async function update(profile, id, input) {
  const { log: existing } = await requireAccessibleLog(profile, id, 'LOG_EDIT')
  if (existing.lifecycle_status !== 'DRAFT') throw createHttpError('Nhật ký đã xác nhận; hãy dùng chức năng Đính chính', 409)

  const changes = normalizeFarmingLogInput({
    ...input,
    batchId: existing.batch_id,
  })

  return farmingLogsRepository.applyChange(profile.id, existing, 'EDIT', { changes })
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
  return farmingLogsRepository.createVersion(anchored, profile.id, correctionReason, eventId, { ...options, blockNumber: result.record.block_number })
}

function reserveAnchor(profile, log, action, payload) {
  if (!blockchainService.isContractConfigured()) throw createHttpError('Thiếu cấu hình chứng thực trên Blockchain', 502)
  return farmingLogsRepository.reserveAnchor(profile.id, log, action, blockchainService.hashData(payload))
}

async function confirm(profile, id) {
  const { log: existing } = await requireAccessibleLog(profile, id, 'LOG_CONFIRM')
  if (existing.lifecycle_status !== 'DRAFT') throw createHttpError('Chỉ bản nháp mới có thể xác nhận', 409)
  const eventId = await reserveAnchor(profile, existing, 'CONFIRM', blockchainPayload(existing))
  const version = await anchorVersion(existing, profile, eventId)
  return farmingLogsRepository.applyChange(profile.id, existing, 'CONFIRM', { version: version.id })
}

async function correct(profile, id, input) {
  const { log: existing, batch } = await requireAccessibleLog(profile, id, 'LOG_EDIT')
  await requirePondAction(profile, batch.pond_id, 'LOG_CONFIRM', { notFound: LOG_NOT_FOUND })
  if (existing.lifecycle_status !== 'CONFIRMED') throw createHttpError('Chỉ nhật ký đã xác nhận mới có thể đính chính', 409)
  if (Number(input?.expectedVersion) !== existing.current_version) throw createHttpError('Nhật ký đã có phiên bản mới hơn', 409)
  const reason = String(input?.correctionReason ?? '').trim()
  if (reason.length < 3 || reason.length > 1000) throw createHttpError('Lý do đính chính phải có từ 3 đến 1000 ký tự', 400)
  const changes = normalizeFarmingLogInput({ ...input, batchId: existing.batch_id })
  const nextVersion = existing.current_version + 1
  const candidate = { ...existing, ...changes, current_version: nextVersion }
  const eventId = await reserveAnchor(profile, existing, 'CORRECT', blockchainPayload(candidate))
  const version = await anchorVersion(candidate, profile, eventId, reason, { supersedesVersionId: existing.current_version_id, evidenceUrl: input.evidenceUrl })
  return farmingLogsRepository.applyChange(profile.id, existing, 'CORRECT', { version: version.id })
}

async function revoke(profile, id, input) {
  const { log: existing } = await requireAccessibleLog(profile, id, 'LOG_CONFIRM')
  if (existing.lifecycle_status !== 'CONFIRMED') throw createHttpError('Nhật ký không ở trạng thái có thể thu hồi', 409)
  const reason = String(input?.reason ?? '').trim()
  if (reason.length < 3 || reason.length > 1000) throw createHttpError('Lý do thu hồi phải có từ 3 đến 1000 ký tự', 400)
  const payload = { targetEventId: existing.current_version_id, reason }
  const eventId = await reserveAnchor(profile, existing, 'REVOKE', payload)
  const result = await blockchainService.createRecord({ batchId: existing.batch_id, entityType: 'FARMING_LOG', entityId: id, eventType: 'FARMING_LOG_RECORDED', eventId, payload, status: 'PENDING' })
  if (!result.submitted) throw createHttpError('Không thể ghi nhận thu hồi trên Blockchain', 502)
  return farmingLogsRepository.applyChange(profile.id, existing, 'REVOKE', { reason })
}

async function history(profile, id) {
  const { log } = await requireAccessibleLog(profile, id, 'READ')
  return {
    currentVersion: log.current_version,
    items: log.lifecycle_status === 'DRAFT' ? [] : await farmingLogsRepository.findVersions(id, log.current_version),
  }
}

async function listByBatch(profile, batchId) {
  await requireAccessibleBatch(profile, batchId, 'READ')
  const items = await farmingLogsRepository.findAllByBatch(batchId)
  return { count: items.length, items }
}

async function verify(profile, batchId) {
  await requireAccessibleBatch(profile, batchId, 'READ')

  const logs = await farmingLogsRepository.findAllByBatch(batchId)
  const records = await blockchainService.getRecordsByBatch(batchId)
  const recordByEventId = new Map(records.map((record) => [record.event_id, record]))
  const versions = await farmingLogsRepository.findCurrentVersions(logs.map(log => log.current_version_id))
  const versionsById = new Map(versions.map(version => [version.id, version]))

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
    const baseEventId = blockchainService.buildEventId('FARMING_LOG_RECORDED', log.id)
    const eventId = versionsById.get(log.current_version_id)?.blockchain_event_id ?? (log.current_version > 1 ? `${baseEventId}:v${log.current_version}` : baseEventId)
    const record = recordByEventId.get(eventId) ?? null
    const onChainDataHash = log.lifecycle_status === 'DRAFT'
      ? ''
      : await blockchainService.getDataHashFromContract(eventId, record?.contract_address)

    const issues = []
    if (log.lifecycle_status !== 'DRAFT') {
      if (!log.data_hash) issues.push('Chưa có data_hash trên nhật ký')
      else if (!storedMatches) issues.push('Văn bản dữ liệu hiện tại không khớp data_hash đã lưu')
      if (!record) issues.push('Không có bản ghi trên blockchain_records')
      else if (record.status === 'FAILED') issues.push('Giao dịch trên blockchain đã thất bại')
      else if (record.status === 'PENDING') issues.push('Giao dịch chưa được xác nhận trên blockchain')
      else if (!validPayloadHashes.has(record.data_hash)) issues.push('data_hash của blockchain_records không khớp')
      if (!onChainDataHash) issues.push('Không có bằng chứng trên Smart Contract')
      else if (!validPayloadHashes.has(onChainDataHash)) issues.push('data_hash trên Smart Contract không khớp dữ liệu hiện tại')
      if (onChainDataHash && log.data_hash && onChainDataHash !== log.data_hash) issues.push('data_hash trong nhật ký không khớp Smart Contract')
      if (onChainDataHash && record && onChainDataHash !== record.data_hash) issues.push('blockchain_records không khớp Smart Contract')
    }

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

// The database reserves shared proof state; also avoid duplicate work within this process.
const mutatingLogs = new Set()
async function mutate(id, operation) {
  validateId(id, 'Mã nhật ký')
  if (mutatingLogs.has(id)) throw createHttpError('Nhật ký đang được xử lý. Vui lòng tải lại sau', 409)
  if (mutatingLogs.size >= 100) throw createHttpError('Hệ thống đang xử lý nhiều nhật ký. Vui lòng thử lại', 503)
  mutatingLogs.add(id)
  try { return await operation() } finally { mutatingLogs.delete(id) }
}
module.exports = {
  create, authorizeImageUpload, history, listByBatch, verify,
  update: (profile, id, input) => mutate(id, () => update(profile, id, input)),
  confirm: (profile, id) => mutate(id, () => confirm(profile, id)),
  correct: (profile, id, input) => mutate(id, () => correct(profile, id, input)),
  revoke: (profile, id, input) => mutate(id, () => revoke(profile, id, input)),
}
