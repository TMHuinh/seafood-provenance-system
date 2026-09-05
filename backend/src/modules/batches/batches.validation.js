const SPECIES = ['SHRIMP', 'CRAB']
const STATUSES = ['PREPARING', 'GROWING', 'READY_FOR_HARVEST', 'HARVESTED', 'COMPLETED', 'CANCELLED']

function invalid(message) { const error = new Error(message); error.status = 400; return error }
function text(value, label, max, required = false) {
  if (value === undefined) return undefined
  const result = String(value ?? '').trim()
  if (required && !result) throw invalid(`Vui lòng nhập ${label}`)
  if (!result) return null
  if (result.length > max) throw invalid(`${label} không được vượt quá ${max} ký tự`)
  return result
}
function number(value, label, { integer = false, allowZero = false } = {}) {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  const result = Number(value)
  if (!Number.isFinite(result) || (integer && !Number.isInteger(result)) || (allowZero ? result < 0 : result <= 0)) throw invalid(`${label} không hợp lệ`)
  return result
}
function date(value, label, required = false) {
  if (value === undefined) return undefined
  if (value === null || value === '') { if (required) throw invalid(`Vui lòng nhập ${label}`); return null }
  const result = new Date(value)
  if (Number.isNaN(result.getTime())) throw invalid(`${label} không hợp lệ`)
  return result.toISOString()
}

function normalizeBatchInput(input, { partial = false } = {}) {
  const source = input && typeof input === 'object' ? input : {}; const batch = {}
  if (!partial || Object.hasOwn(source, 'batchCode')) batch.batch_code = text(source.batchCode, 'mã vụ nuôi', 100, true).toUpperCase()
  if (!partial || Object.hasOwn(source, 'species')) { if (!SPECIES.includes(source.species)) throw invalid('Loài nuôi không hợp lệ'); batch.species = source.species }
  if (!partial || Object.hasOwn(source, 'seedQuantity')) { const value = number(source.seedQuantity, 'Số lượng con giống', { integer: true }); if (value === null) throw invalid('Vui lòng nhập số lượng con giống'); batch.seed_quantity = value }
  if (!partial || Object.hasOwn(source, 'stockingDate')) batch.stocking_date = date(source.stockingDate, 'ngày thả giống', true)
  if (Object.hasOwn(source, 'seedSource')) batch.seed_source = text(source.seedSource, 'Nguồn giống', 255)
  if (Object.hasOwn(source, 'expectedHarvestDate')) batch.expected_harvest_date = date(source.expectedHarvestDate, 'Ngày dự kiến thu hoạch')
  if (Object.hasOwn(source, 'actualHarvestDate')) batch.actual_harvest_date = date(source.actualHarvestDate, 'Ngày thu hoạch')
  if (Object.hasOwn(source, 'yieldQuantity')) batch.yield_quantity = number(source.yieldQuantity, 'Sản lượng', { allowZero: true })
  if (Object.hasOwn(source, 'status')) { if (!STATUSES.includes(source.status)) throw invalid('Trạng thái vụ nuôi không hợp lệ'); batch.status = source.status }
  if (Object.hasOwn(source, 'note')) batch.note = text(source.note, 'Ghi chú', 5000)
  const effectiveStatus = batch.status ?? source.currentStatus ?? 'PREPARING'
  if (!partial && !['PREPARING', 'GROWING'].includes(effectiveStatus)) {
    throw invalid('Vụ nuôi mới chỉ có thể ở trạng thái chuẩn bị hoặc đang nuôi')
  }
  if (!['HARVESTED', 'COMPLETED'].includes(effectiveStatus)) {
    if (batch.actual_harvest_date) throw invalid('Chỉ nhập ngày thu hoạch thực tế khi vụ nuôi đã thu hoạch')
    if (batch.yield_quantity !== undefined && batch.yield_quantity !== null) throw invalid('Chỉ nhập sản lượng khi vụ nuôi đã thu hoạch')
  }
  const stocking = batch.stocking_date ?? source.currentStockingDate
  if (stocking && batch.expected_harvest_date && new Date(batch.expected_harvest_date) < new Date(stocking)) throw invalid('Ngày dự kiến thu hoạch phải sau ngày thả giống')
  if (partial && Object.keys(batch).length === 0) throw invalid('Không có dữ liệu hợp lệ để cập nhật')
  return batch
}

module.exports = { normalizeBatchInput }
