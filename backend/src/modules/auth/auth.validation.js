const { ORG_TYPES, USER_ROLES } = require('./auth.constants')

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function createValidationError(message) {
  const error = new Error(message)
  error.status = 400
  return error
}

function validateRegister({ fullName, email, password, role, organizationType }) {
  if (!fullName || !String(fullName).trim()) {
    throw createValidationError('Vui lòng nhập họ và tên')
  }
  if (!email || !EMAIL_PATTERN.test(email)) {
    throw createValidationError('Email không hợp lệ')
  }
  if (!password || String(password).length < 8) {
    throw createValidationError('Mật khẩu phải có ít nhất 8 ký tự')
  }
  if (role !== undefined && role !== null && !USER_ROLES.includes(role)) {
    throw createValidationError('Vai trò không hợp lệ')
  }
  if (organizationType && !ORG_TYPES.includes(organizationType)) {
    throw createValidationError('Loại tổ chức không hợp lệ')
  }
}

function validateLogin({ email, password }) {
  if (!email || !password) {
    throw createValidationError('Vui lòng nhập email và mật khẩu')
  }
}

module.exports = { validateLogin, validateRegister }
