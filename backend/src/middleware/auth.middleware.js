const supabase = require('../config/supabase')

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

async function loadProfile(userId) {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*, organization:organizations(*)')
    .eq('id', userId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      return null
    }
    throw error
  }

  return data
}

/**
 * Bảo vệ các route: xác thực JWT của Supabase Auth và nạp hồ sơ
 * (user_profiles) của người dùng. Backend là nơi duy nhất tiếp xúc
 * với khóa bí mật; frontend không bao giờ tự kiểm tra token.
 */
async function requireAuth(request, response, next) {
  try {
    const token = extractToken(request)
    if (!token) {
      throw createUnauthorized('Vui lòng đăng nhập để tiếp tục')
    }

    const { data, error } = await supabase.auth.getUser(token)
    if (error || !data.user) {
      throw createUnauthorized('Phiên đăng nhập không hợp lệ hoặc đã hết hạn')
    }

    const profile = await loadProfile(data.user.id)
    if (!profile) {
      throw createUnauthorized('Hồ sơ người dùng chưa được khởi tạo')
    }

    request.auth = {
      token,
      user: data.user,
      profile,
    }

    next()
  } catch (error) {
    next(error)
  }
}

module.exports = { requireAuth }
