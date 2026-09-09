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
  // 1. Validate dữ liệu
  const logData = normalizeFarmingLogInput(input)

  // 2. Kiểm tra lô nuôi tồn tại và thuộc quyền sở hữu
  await requireAccessibleBatch(profile, logData.batch_id)

  // 3. Lưu SQL trước để lấy được ID của bản ghi
  let log = await farmingLogsRepository.create(profile.id, logData)

  try {
    // 4. Đóng gói dữ liệu để băm lên Blockchain
    const blockchainPayload = {
      batchId: log.batch_id,
      logType: log.log_type,
      logDate: log.log_date,
      details: log.details
    }

    // 5. Gọi Service dùng chung để lưu vào Blockchain và bảng blockchain_records
    const { record, dataHash } = await blockchainService.createRecord({
      batchId: log.batch_id,
      entityType: 'FARMING_LOG',
      entityId: log.id,
      eventType: 'FARMING_LOG_RECORDED',
      payload: blockchainPayload,
      status: 'PENDING'
    })

    // 6. Cập nhật lại data_hash và tx_hash vào bảng farming_logs
    if (record) {
      log = await farmingLogsRepository.updateHashes(log.id, dataHash, record.transaction_hash)
    }
  } catch (error) {
    console.error('Lỗi khi tích hợp Blockchain:', error)
    // Tùy theo yêu cầu nghiệp vụ: Có thể throw error hoặc vẫn cho pass nếu lỗi mạng Blockchain
    // throw createHttpError('Ghi nhận Blockchain thất bại', 500)
  }

  return log
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

  const details = logs.map((log) => {
    const payload = { batchId: log.batch_id, logType: log.log_type, logDate: log.log_date, details: log.details }
    const recomputedHash = blockchainService.hashData(payload)
    const storedMatches = Boolean(log.data_hash) && log.data_hash === recomputedHash
    const record = recordByEntityId.get(log.id) ?? null

    const issues = []
    if (!log.data_hash) issues.push('Chưa có data_hash trên nhật ký')
    else if (!storedMatches) issues.push('Văn bản dữ liệu hiện tại không khớp data_hash đã lưu')
    if (!record) issues.push('Không có bản ghi trên blockchain_records')
    else if (record.status === 'FAILED') issues.push('Giao dịch trên blockchain đã thất bại')
    else if (record.status === 'PENDING') issues.push('Giao dịch chưa được xác nhận trên blockchain')
    else if (record.data_hash !== recomputedHash) issues.push('data_hash của blockchain_records không khớp')

    return {
      id: log.id,
      logType: log.log_type,
      logDate: log.log_date,
      dataHash: log.data_hash,
      status: issues.length === 0 ? 'SYNCED' : 'DESYNCED',
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
  })

  const summary = {
    total: details.length,
    verified: details.filter((item) => item.status === 'SYNCED').length,
    desynced: details.filter((item) => item.status === 'DESYNCED').length,
  }

  return { batchId, checkedAt: new Date().toISOString(), summary, details }
}

module.exports = { create, listByBatch, verify }