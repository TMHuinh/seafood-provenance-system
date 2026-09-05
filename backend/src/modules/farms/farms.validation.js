function createValidationError(message) {
  const error = new Error(message)
  error.status = 400
  return error
}

function optionalText(value, fieldName) {
  if (value === undefined) return undefined
  if (value === null || String(value).trim() === '') return null
  const normalized = String(value).trim()
  if (normalized.length > 255) {
    throw createValidationError(`${fieldName} không được vượt quá 255 ký tự`)
  }
  return normalized
}

function optionalNumber(value, fieldName, { min, max } = {}) {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  const normalized = Number(value)
  if (!Number.isFinite(normalized)) {
    throw createValidationError(`${fieldName} phải là một số hợp lệ`)
  }
  if (min !== undefined && normalized < min) {
    throw createValidationError(`${fieldName} phải lớn hơn hoặc bằng ${min}`)
  }
  if (max !== undefined && normalized > max) {
    throw createValidationError(`${fieldName} phải nhỏ hơn hoặc bằng ${max}`)
  }
  return normalized
}

function normalizeFarmInput(input, { partial = false } = {}) {
  const source = input && typeof input === 'object' ? input : {}
  const farm = {}

  if (!partial || Object.hasOwn(source, 'farmName')) {
    const farmName = String(source.farmName ?? '').trim()
    if (!farmName) throw createValidationError('Vui lòng nhập tên cơ sở nuôi')
    if (farmName.length > 255) {
      throw createValidationError('Tên cơ sở nuôi không được vượt quá 255 ký tự')
    }
    farm.farm_name = farmName
  }

  const fields = [
    ['address', 'address', 'Địa chỉ'],
    ['certification', 'certification', 'Chứng nhận'],
  ]
  for (const [inputKey, databaseKey, label] of fields) {
    if (Object.hasOwn(source, inputKey)) {
      farm[databaseKey] = optionalText(source[inputKey], label)
    }
  }

  const numbers = [
    ['area', 'area', 'Diện tích', { min: Number.EPSILON }],
  ]
  for (const [inputKey, databaseKey, label, limits] of numbers) {
    if (Object.hasOwn(source, inputKey)) {
      farm[databaseKey] = optionalNumber(source[inputKey], label, limits)
    }
  }

  if (Object.hasOwn(source, 'status')) {
    if (typeof source.status !== 'boolean') {
      throw createValidationError('Trạng thái phải là true hoặc false')
    }
    farm.status = source.status
  }

  if (partial && Object.keys(farm).length === 0) {
    throw createValidationError('Không có dữ liệu hợp lệ để cập nhật')
  }

  return farm
}

module.exports = { normalizeFarmInput }
