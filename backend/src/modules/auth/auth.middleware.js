const supabase = require('../../config/supabase')
const authRepository = require('./auth.repository')

function createUnauthorized(message = 'Unauthorized') {
  const error = new Error(message)
  error.status = 401
  return error
}

function extractToken(request) {
  const header = request.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return null
  }
  return header.slice('Bearer '.length).trim()
}

async function requireAuth(request, response, next) {
  void response

  try {
    const token = extractToken(request)
    if (!token) {
      throw createUnauthorized('Vui lòng đăng nhập để tiếp tục')
    }

    const { data, error } = await supabase.auth.getUser(token)
    if (error || !data.user) {
      throw createUnauthorized('Phiên đăng nhập không hợp lệ hoặc đã hết hạn')
    }

    const profile = await authRepository.findProfileById(data.user.id)
    if (!profile) {
      throw createUnauthorized('Hồ sơ người dùng chưa được khởi tạo')
    }

    request.auth = { token, user: data.user, profile }
    next()
  } catch (error) {
    next(error)
  }
}

module.exports = { requireAuth }
