const authService = require('../services/auth.service')

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

module.exports = { register, login, me, logout }