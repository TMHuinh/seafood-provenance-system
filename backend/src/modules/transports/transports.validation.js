const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function invalid(message, status = 400) {
  const error = new Error(message)
  error.status = status
  throw error
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function record(value) {
  if (value === undefined) return {}
  if (!isRecord(value)) invalid('Dữ liệu gửi lên không hợp lệ')
  return value
}

function only(source, allowed) {
  const unexpected = Object.keys(source).filter((key) => !allowed.includes(key))
  if (unexpected.length) invalid(`Trường dữ liệu không được hỗ trợ: ${unexpected.join(', ')}`)
  return source
}

function requiredText(value, label, { min = 1, max = 500 } = {}) {
  if (typeof value !== 'string') invalid(`${label} phải là chuỗi ký tự`)
  const normalized = value.trim()
  if (normalized.length < min || normalized.length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(normalized)) {
    invalid(`${label} phải có từ ${min} đến ${max} ký tự hợp lệ`)
  }
  return normalized
}

function optionalText(value, label, max) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') invalid(`${label} phải là chuỗi ký tự`)
  const normalized = value.trim()
  if (!normalized) return null
  if (normalized.length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(normalized)) {
    invalid(`${label} không được vượt quá ${max} ký tự hoặc chứa ký tự điều khiển`)
  }
  return normalized
}

function uuid(value, label) {
  if (typeof value !== 'string' || !UUID.test(value)) invalid(`${label} không hợp lệ`)
  return value
}

function number(value, label, { min = -Infinity, max = Infinity, decimals = null, integer = false } = {}) {
  if (typeof value !== 'number' && typeof value !== 'string') invalid(`${label} phải là số`)
  if (typeof value === 'string' && !value.trim()) invalid(`${label} phải là số`)
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isInteger(parsed)) ||
    (decimals !== null && Math.abs(parsed * (10 ** decimals) - Math.round(parsed * (10 ** decimals))) > 0.001)) {
    invalid(`${label} không hợp lệ`)
  }
  return parsed
}

function optionalNumber(value, label, limits) {
  if (value === undefined || value === null || value === '') return null
  return number(value, label, limits)
}

function timestamp(value, label) {
  const match = typeof value === 'string'
    ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|([+-])(\d{2}):(\d{2}))$/i.exec(value)
    : null
  if (!match) {
    invalid(`${label} phải là ngày giờ ISO-8601 có múi giờ`)
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText = '0', , , offsetHourText = '0', offsetMinuteText = '0'] = match
  const year = Number(yearText); const month = Number(monthText); const day = Number(dayText)
  const hour = Number(hourText); const minute = Number(minuteText); const second = Number(secondText)
  const offsetHour = Number(offsetHourText); const offsetMinute = Number(offsetMinuteText)
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) {
    invalid(`${label} không hợp lệ`)
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) invalid(`${label} không hợp lệ`)
  return parsed.toISOString()
}

module.exports = { invalid, isRecord, number, only, optionalNumber, optionalText, record, requiredText, timestamp, uuid }
