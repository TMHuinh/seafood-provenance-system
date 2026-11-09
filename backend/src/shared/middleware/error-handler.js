function notFoundHandler(request, response) {
  response.status(404).json({ success: false, message: 'Không tìm thấy đường dẫn yêu cầu' })
}
function errorHandler(error, request, response, next) {
  void request; void next
  if (error.code === 'LIMIT_FILE_SIZE') {
    error.status = 413
    error.message = 'Ảnh không được lớn hơn 10 MB'
  }
  const known = {
    '23505': [409, 'Dữ liệu đã tồn tại. Vui lòng tải lại trước khi tiếp tục'],
    '23503': [409, 'Dữ liệu liên quan đã thay đổi hoặc đang được sử dụng'],
    '40001': [409, 'Dữ liệu đã thay đổi. Vui lòng tải lại'],
    PT409: [409, 'Trạng thái hiện tại không cho phép thao tác này'],
    '23514': [400, 'Thông tin không đáp ứng điều kiện nghiệp vụ'],
  }[error.code]
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : known?.[0] ?? 500
  const message = known?.[1] ?? (status < 500 && error.status ? error.message : 'Hệ thống tạm thời không xử lý được yêu cầu. Vui lòng thử lại')
  // Do not print upstream requests, credentials or database error details.
  console.error('Request failed', { status, code: error.code ?? null, name: error.name })
  response.status(status).json({ success: false, message,
    ...(error.code === 'ACCOUNT_DISABLED' ? { code: error.code } : {}),
  })
}
module.exports = { errorHandler, notFoundHandler }
