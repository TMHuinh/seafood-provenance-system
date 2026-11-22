const authService = require('./auth.service')

async function register(request, response, next) {
  try {
    const result = await authService.register(request.body)
    response.status(201).json({ success: true, ...result })
  } catch (error) {
    next(error)
  }
}

async function login(request, response, next) {
  try {
    const result = await authService.login({
      email: request.body?.email,
      password: request.body?.password,
    })
    response.json({ success: true, ...result })
  } catch (error) {
    next(error)
  }
}

async function forgotPassword(request, response, next) {
  try {
    const result = await authService.forgotPassword(request.body?.email)
    response.json({
      success: true,
      registered: result.registered,
      message: result.registered
        ? 'Hướng dẫn đặt lại mật khẩu đã được gửi đến hộp thư của bạn'
        : 'Email này chưa được đăng ký. Vui lòng kiểm tra lại hoặc tạo tài khoản mới',
    })
  } catch (error) {
    next(error)
  }
}

async function resetPassword(request, response, next) {
  try {
    await authService.resetPassword(request.body)
    response.json({ success: true, message: 'Mật khẩu đã được cập nhật' })
  } catch (error) {
    next(error)
  }
}

async function listUsers(request, response, next) {
  try {
    const users = await authService.listUsers()
    response.json({ success: true, users })
  } catch (error) {
    next(error)
  }
}

async function updateUser(request, response, next) {
  try {
    const user = await authService.updateUser(request.params.userId, request.body, request.auth.user.id)
    response.json({ success: true, user })
  } catch (error) {
    next(error)
  }
}

async function me(request, response, next) {
  try {
    const user = await authService.getMe(request.auth.user.id)
    response.json({ success: true, user })
  } catch (error) {
    next(error)
  }
}

async function logout(request, response, next) {
  try {
    await authService.logout(request.auth.token)
    response.json({ success: true })
  } catch (error) {
    next(error)
  }
}

module.exports = { forgotPassword, listUsers, login, logout, me, register, resetPassword, updateUser }
