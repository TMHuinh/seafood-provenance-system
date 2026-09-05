const POND_STATUSES = ['ACTIVE', 'INACTIVE', 'MAINTENANCE']

function validationError(message) {
  const error = new Error(message)
  error.status = 400
  return error
}

function text(value, label, max, required = false) {
  if (value === undefined) return undefined
  const normalized = String(value ?? '').trim()
  if (required && !normalized) throw validationError(`Vui lòng nhập ${label}`)
  if (!normalized) return null
  if (normalized.length > max) throw validationError(`${label} không được vượt quá ${max} ký tự`)
  return normalized
}

function positiveNumber(value, label) {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  const normalized = Number(value)
  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw validationError(`${label} phải là số lớn hơn 0`)
  }
  return normalized
}

function normalizePondInput(input, { partial = false } = {}) {
  const source = input && typeof input === 'object' ? input : {}
  const pond = {}

  if (!partial || Object.hasOwn(source, 'pondCode')) {
    pond.pond_code = text(source.pondCode, 'mã ao', 100, true).toUpperCase()
  }
  if (!partial || Object.hasOwn(source, 'pondName')) pond.pond_name = text(source.pondName, 'tên ao', 255, true)
  if (Object.hasOwn(source, 'area')) pond.area = positiveNumber(source.area, 'Diện tích')
  if (Object.hasOwn(source, 'depth')) pond.depth = positiveNumber(source.depth, 'Độ sâu')
  if (Object.hasOwn(source, 'waterType')) pond.water_type = text(source.waterType, 'Loại nước', 100)
  if (Object.hasOwn(source, 'status')) {
    if (!POND_STATUSES.includes(source.status)) throw validationError('Trạng thái ao không hợp lệ')
    pond.status = source.status
  }
  if (partial && Object.keys(pond).length === 0) throw validationError('Không có dữ liệu hợp lệ để cập nhật')
  return pond
}

module.exports = { normalizePondInput }
