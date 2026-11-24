const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function createValidationError(message) {
  const error = new Error(message)
  error.status = 400
  return error
}

const VALID_LOG_TYPES = ['FEEDING', 'MEDICINE', 'WATER_QUALITY', 'CARE', 'ENVIRONMENT', 'MORTALITY', 'OTHER']
const vietnamDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
})

function farmingLogIssue(log, batch) {
  const date = new Date(log.log_date)
  if (!log.log_date || !Number.isFinite(date.getTime())) return 'Thời gian nhật ký không hợp lệ'
  const day = vietnamDay.format(date)
  if (day < vietnamDay.format(new Date(batch.stocking_date))) return 'Ngày nhật ký phải từ ngày thả giống trở đi'
  if (date.getTime() > Date.now()) return 'Thời gian nhật ký không được ở tương lai'
  if (batch.actual_harvest_date && day > vietnamDay.format(new Date(batch.actual_harvest_date))) {
    return 'Ngày nhật ký phải trước hoặc trong ngày kết thúc thu hoạch'
  }
  const details = log.details
  if (!details || typeof details !== 'object' || Array.isArray(details)) return 'Chi tiết nhật ký phải là một đối tượng'
  const named = key => typeof details[key] === 'string' && details[key].trim().length > 0
  const supplied = key => details[key] != null
  const number = (key, min, max = Infinity) => Number.isFinite(details[key]) && details[key] >= min && details[key] <= max
  switch (log.log_type) {
    case 'FEEDING':
      if (!named('feedType') || (supplied('feedAmount') && (!number('feedAmount', 0) || details.feedAmount === 0))) return 'Nhập tên thức ăn và kiểm tra lượng thức ăn nếu có'
      break
    case 'MEDICINE':
      if (!named('medicineName') || (supplied('dose') && !named('dose'))) return 'Nhập tên thuốc và kiểm tra liều dùng nếu có'
      break
    case 'WATER_QUALITY': {
      const ranges = { temperature: [-273.15, Infinity], salinity: [0, Infinity], ph: [0, 14], dissolvedOxygen: [0, Infinity] }
      const measurements = Object.keys(ranges).filter(supplied)
      if (!measurements.length || measurements.some(key => !number(key, ...ranges[key]))) return 'Nhập ít nhất một chỉ số nước hợp lệ, pH từ 0 đến 14'
      break
    }
    case 'MORTALITY':
      if (!Number.isInteger(details.mortalityCount) || details.mortalityCount < 0) return 'Số con chết phải là số nguyên không âm'
      break
    default:
      if (!named('description')) return 'Vui lòng nhập mô tả'
  }
  return null
}

function validateFarmingLog(log, batch) {
  const issue = farmingLogIssue(log, batch)
  if (issue) throw createValidationError(issue)
}

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
  if (!source.logDate || isNaN(logDate.getTime())) {
    throw createValidationError('Ngày ghi nhật ký (logDate) không hợp lệ')
  }
  log.log_date = logDate.toISOString()

  if (!source.details || typeof source.details !== 'object' || Array.isArray(source.details)) {
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

module.exports = { normalizeFarmingLogInput, validateFarmingLog, farmingLogIssue, UUID_PATTERN }
