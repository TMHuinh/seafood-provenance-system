const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const LOT_STATUSES = ['CREATED', 'PACKAGED', 'SHIPPED', 'COMPLETED']
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }) }
function requireManager(profile) {
  if (!['ADMIN', 'FARMER'].includes(profile?.role)) fail('Chỉ chủ cơ sở hoặc quản trị viên được xem dữ liệu sản xuất', 403)
}
function day(value, label) {
  if (value === undefined || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`${label} không hợp lệ`)
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) fail(`${label} không hợp lệ`)
  return value
}
function filters(input = {}, { paginated = false } = {}) {
  const result = {}
  for (const key of ['farmId', 'pondId']) {
    if (input[key] && (typeof input[key] !== 'string' || !UUID.test(input[key]))) fail('Mã cơ sở hoặc ao không hợp lệ')
    result[key] = input[key] || null
  }
  if (input.species && !['SHRIMP', 'CRAB'].includes(input.species)) fail('Loài nuôi không hợp lệ')
  result.species = input.species || null
  result.from = day(input.from, 'Ngày bắt đầu')
  result.to = day(input.to, 'Ngày kết thúc')
  if (result.from && result.to && result.from > result.to) fail('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc')
  if (paginated) {
    if (input.search !== undefined && (typeof input.search !== 'string' || input.search.length > 100 || /[\u0000-\u001f]/.test(input.search))) fail('Từ khóa tìm kiếm tối đa 100 ký tự hợp lệ')
    if (input.status && !LOT_STATUSES.includes(input.status)) fail('Trạng thái lô không hợp lệ')
    result.search = (input.search || '').trim()
    result.status = input.status || null
    result.page = Number(input.page ?? 1)
    result.pageSize = Number(input.pageSize ?? 12)
    if (!Number.isSafeInteger(result.page) || result.page < 1 || result.page > 100000 || !Number.isInteger(result.pageSize) || result.pageSize < 1 || result.pageSize > 100) fail('Phân trang không hợp lệ')
  }
  return result
}
function dateBounds(options) {
  return {
    from: options.from ? `${options.from}T00:00:00+07:00` : null,
    until: options.to ? new Date(new Date(`${options.to}T00:00:00+07:00`).getTime() + 86400000).toISOString() : null,
  }
}
// Escape regex syntax first, then PostgREST's quoted literal syntax.
// imatch avoids LIKE's wildcard aliases (% and *), keeping every search literal.
function searchPattern(value) {
  const literal = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return `"${literal.replace(/[\\"]/g, '\\$&')}"`
}
module.exports = { UUID, fail, requireManager, filters, dateBounds, searchPattern }
