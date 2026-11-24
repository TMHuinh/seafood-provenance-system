const db = require('../../config/supabase')
const { UUID_PATTERN } = require('../farming-logs/farming-logs.validation')

async function packaging(request, response, next) {
  const transportId = request.params.transportId
  if (!UUID_PATTERN.test(transportId)) return response.status(404).json({ message: 'Không tìm thấy chuyến' })
  const input = request.method === 'POST' ? request.body : null
  if (request.method === 'POST' && (!input || typeof input !== 'object' ||
      !Number.isFinite(input.quantity) ||
      !['packagedDate', 'inspectionDate'].every(key => typeof input[key] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input[key])) ||
      !['specification', 'inspectionUnit', 'inspectionResult'].every(key => typeof input[key] === 'string'))) {
    return response.status(400).json({ message: 'Vui lòng nhập đủ thông tin đóng gói và kiểm định' })
  }
  try {
    const { data, error } = await db.rpc('received_lot_packaging', {
      p_actor: request.auth.profile.id, p_transport: transportId, p_input: input,
    }).abortSignal(AbortSignal.timeout(5000))
    if (!error) return response.json({ success: true, packaging: data })
    const mapped = {
      '42501': [403, 'Chỉ nhà phân phối đang hoạt động được quản lý hồ sơ đóng gói'],
      P0002: [404, 'Không tìm thấy chuyến nhận hàng'],
      PT409: [409, 'Chuyến chưa xác nhận nhận hàng hoặc đã có hồ sơ đóng gói khác'],
      '22023': [400, 'Kiểm tra ngày, nội dung kiểm định và khối lượng thực nhận'],
      '22007': [400, 'Ngày đóng gói hoặc kiểm định không hợp lệ'],
      '22008': [400, 'Ngày đóng gói hoặc kiểm định không hợp lệ'],
    }[error.code]
    if (mapped) return response.status(mapped[0]).json({ message: mapped[1] })
    throw error
  } catch (error) { next(error) }
}

module.exports = packaging
