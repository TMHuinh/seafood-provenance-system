function invalid(message) {
  throw Object.assign(new Error(message), { status: 400 })
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function id(value, label = 'Mã định danh') {
  if (typeof value !== 'string' || !UUID.test(value)) invalid(`${label} không hợp lệ`)
  return value.toLowerCase()
}

function text(value, label, max, { optional = false, min = 1 } = {}) {
  if (optional && (value === undefined || value === null || value === '')) return null
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) {
    invalid(`${label} phải có từ ${min} đến ${max} ký tự`)
  }
  return value.trim()
}

function bool(value, label) {
  if (typeof value !== 'boolean') invalid(`${label} không hợp lệ`)
  return value
}

function farmIds(value) {
  if (!Array.isArray(value)) invalid('Danh sách cơ sở nuôi không hợp lệ')
  return [...new Set(value.map(item => id(item, 'Mã cơ sở nuôi')))].sort()
}

function sharing(input = {}) {
  const logs = bool(input?.shareLogs ?? false, 'Lựa chọn chia sẻ nhật ký')
  const batches = input?.sharedBatchIds ?? []
  if (!Array.isArray(batches) || batches.length > 200) invalid('Danh sách vụ nuôi được chia sẻ không hợp lệ')
  return { p_share_logs: logs, p_batch_ids: [...new Set(batches.map(value => id(value, 'Mã vụ nuôi')))].sort() }
}

function email(value) {
  const normalized = text(value, 'Email tài khoản', 255).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) invalid('Email tài khoản không hợp lệ')
  return normalized
}

function permissions(value, supported) {
  if (!Array.isArray(value) || value.length > supported.length || value.some(item => !supported.includes(item))) {
    invalid('Phạm vi quyền không hợp lệ')
  }
  return [...new Set(value)]
}

function startsAt(value) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value)
    || !Number.isFinite(Date.parse(value))) invalid('Thời điểm bắt đầu không hợp lệ')
  return new Date(value).toISOString()
}

const confirmationPermissions = ['LOG_CONFIRM', 'HARVEST_CONFIRM']
const assignmentPermissions = ['READ', 'BATCH_CREATE', 'BATCH_EDIT', 'LOG_CREATE', 'LOG_EDIT', 'HARVEST_CREATE', 'HARVEST_EDIT',
  ...confirmationPermissions]

module.exports = { id, text, bool, sharing, farmIds, email, permissions, startsAt, confirmationPermissions, assignmentPermissions }
