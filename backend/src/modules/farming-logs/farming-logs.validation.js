const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function createValidationError(message) {
  const error = new Error(message)
  error.status = 400
  return error
}

const VALID_LOG_TYPES = ['FEEDING', 'MEDICINE', 'WATER_QUALITY', 'CARE', 'ENVIRONMENT', 'MORTALITY', 'OTHER']

function normalizeFarmingLogInput(input) {
  const source = input && typeof input === 'object' ? input : {}
  const log = {}

  if (!UUID_PATTERN.test(String(source.batchId))) {
    throw createValidationError('Mã lô nuôi (batchId) không hợp lệ')
  }
  log.batch_id = source.batchId

  if (!VALID_LOG_TYPES.includes(source.logType)) {
    throw createValidationError('Loại nhật ký (logType) không hợp lệ')
  }
  log.log_type = source.logType

  const logDate = new Date(source.logDate)
  if (isNaN(logDate.getTime())) {
    throw createValidationError('Ngày ghi nhật ký (logDate) không hợp lệ')
  }
  log.log_date = logDate.toISOString()

  if (!source.details || typeof source.details !== 'object') {
    throw createValidationError('Chi tiết nhật ký (details) phải là một đối tượng (object)')
  }
  log.details = source.details

  if (source.imageUrl !== undefined && source.imageUrl !== null && String(source.imageUrl).trim() !== '') {
    log.image_url = String(source.imageUrl).trim()
  } else {
    log.image_url = null
  }

  return log
}

module.exports = { normalizeFarmingLogInput, UUID_PATTERN }