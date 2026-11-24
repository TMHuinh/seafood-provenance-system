const farmingLogsRepository = require('./farming-logs.repository')
const { normalizeFarmingLogInput, UUID_PATTERN } = require('./farming-logs.validation')
const blockchainService = require('../blockchain/blockchain.service')
const outbox = require('../blockchain/blockchain.outbox')
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

async function authorizeImageUpload(profile, batchId) {
  await requireAccessibleBatch(profile, batchId)
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

  const log = await farmingLogsRepository.update(id, changes, existing)
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

async function deliverCommitted(log, eventId) {
  try { await outbox.deliver(eventId) }
  catch (error) { console.error('Bằng chứng nhật ký đang chờ worker:', error.message) }
  // A failed chain call must not turn a committed business operation into an HTTP error.
  try { return await farmingLogsRepository.findById(log.id) ?? log } catch { return log }
}

async function confirm(profile, id) {
  validateId(id, 'Mã nhật ký')
  const existing = await farmingLogsRepository.findById(id)
  if (!existing) throw createHttpError('Không tìm thấy nhật ký nuôi', 404)
  await requireAccessibleBatch(profile, existing.batch_id)
  if (existing.lifecycle_status !== 'DRAFT') throw createHttpError('Chỉ bản nháp mới có thể xác nhận', 409)
  const eventId = blockchainService.buildEventId('FARMING_LOG_RECORDED', id)
  const payload = blockchainPayload(existing)
  const log = await farmingLogsRepository.commitLifecycle(existing, profile.id, 'CONFIRM', {}, null, payload, blockchainService.hashData(payload))
  return deliverCommitted(log, eventId)
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
  const payload = blockchainPayload(candidate)
  const log = await farmingLogsRepository.commitLifecycle(existing, profile.id, 'CORRECT', changes, reason, payload, blockchainService.hashData(payload), input.evidenceUrl ?? null)
  return deliverCommitted(log, eventId)
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
  const payload = { targetEventId: existing.current_version_id, reason }
  const log = await farmingLogsRepository.commitLifecycle(existing, profile.id, 'REVOKE', {}, reason, payload, blockchainService.hashData(payload))
  return deliverCommitted(log, eventId)
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
    let onChainDataHash = '', unavailable = false
    if (log.lifecycle_status === 'CONFIRMED' && record?.status === 'SUCCESS') {
      try { onChainDataHash = await blockchainService.getDataHashFromContract(eventId, record.contract_address, record.chain_id) }
      catch { unavailable = true }
    }

    const issues = []
    if (log.lifecycle_status === 'CONFIRMED') {
      if (!log.data_hash) issues.push('Chưa có data_hash trên nhật ký')
      else if (!storedMatches) issues.push('Văn bản dữ liệu hiện tại không khớp data_hash đã lưu')
      if (!record) issues.push('Không có bản ghi trên blockchain_records')
      else if (record.status === 'FAILED') issues.push('Giao dịch trên blockchain đã thất bại')
      else if (record.status === 'PENDING') issues.push('Giao dịch chưa được xác nhận trên blockchain')
      else if (!validPayloadHashes.has(record.data_hash)) issues.push('data_hash của blockchain_records không khớp')
      if (unavailable) issues.push('Không thể đối soát Blockchain tại thời điểm kiểm tra')
      else if (record?.status === 'SUCCESS' && !onChainDataHash) issues.push('Không có bằng chứng trên Smart Contract')
      else if (onChainDataHash && !validPayloadHashes.has(onChainDataHash)) issues.push('data_hash trên Smart Contract không khớp dữ liệu hiện tại')
      if (onChainDataHash && log.data_hash && onChainDataHash !== log.data_hash) issues.push('data_hash trong nhật ký không khớp Smart Contract')
      if (onChainDataHash && record && onChainDataHash !== record.data_hash) issues.push('blockchain_records không khớp Smart Contract')
    }

    const mismatch = !storedMatches || (record && !validPayloadHashes.has(record.data_hash))
    const verificationStatus = log.lifecycle_status === 'DRAFT' ? 'DRAFT'
      : log.lifecycle_status === 'REVOKED' ? 'REVOKED'
      : mismatch ? 'DESYNCED'
      : !record || record.status !== 'SUCCESS' ? 'PENDING'
      : unavailable ? 'UNAVAILABLE' : issues.length ? 'DESYNCED' : 'SYNCED'
    return {
      id: log.id,
      eventId,
      logType: log.log_type,
      logDate: log.log_date,
      dataHash: log.data_hash,
      onChainDataHash: onChainDataHash || null,
      status: verificationStatus,
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
    pending: details.filter((item) => item.status === 'PENDING').length,
    unavailable: details.filter((item) => item.status === 'UNAVAILABLE').length,
    revoked: details.filter((item) => item.status === 'REVOKED').length,
  }

  return { batchId, checkedAt: new Date().toISOString(), summary, details }
}

// Local fast rejection; commit_farming_log also locks/CAS-checks across processes.
// Its transaction commits business data + outbox, with chain delivery afterwards.
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
