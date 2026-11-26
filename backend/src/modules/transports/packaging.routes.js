const { UUID_PATTERN } = require('../farming-logs/farming-logs.validation')
const { packaging } = require('./receiving.service')

async function handlePackaging(request, response, next) {
  const transportId = request.params.transportId
  if (!UUID_PATTERN.test(transportId)) return response.status(404).json({ message: 'Không tìm thấy chuyến' })
  const input = request.method === 'POST' ? request.body : null
  if (request.method === 'POST' && (!input || typeof input !== 'object' || Array.isArray(input))) {
    return response.status(400).json({ message: 'Vui lòng nhập đủ thông tin đóng gói và kiểm định' })
  }
  try {
    const result = await packaging(request.auth.profile.id, transportId, input)
    return response.json({ success: true, packaging: result })
  } catch (error) { next(error) }
}

module.exports = handlePackaging
