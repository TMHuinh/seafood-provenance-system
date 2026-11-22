const supabase = require('../../config/supabase')
const env = require('../../config/env')
const { createAuthClient } = supabase

const authRepository = require('./auth.repository')
const { ORG_TYPES, USER_ROLES } = require('./auth.constants')
const {
  validateEmail,
  validateLogin,
  validatePasswordReset,
  validateRegister,
} = require('./auth.validation')

function createHttpError(message, status = 400) {
  const error = new Error(message)
  error.status = status
  return error
}

function mapAuthError(error) {
  const lower = String(error?.message ?? '').toLowerCase()

  if (lower.includes('already registered')) {
    return createHttpError('Email này đã được đăng ký', 409)
  }
  if (lower.includes('invalid login credentials')) {
    return createHttpError('Email hoặc mật khẩu không đúng', 401)
  }
  if (lower.includes('email not confirmed')) {
    return createHttpError('Email chưa được xác nhận. Vui lòng kiểm tra hộp thư', 400)
  }
  if (lower.includes('rate limit')) {
    return createHttpError('Quá nhiều yêu cầu. Vui lòng thử lại sau', 429)
  }
  if (lower.includes('refresh token') || lower.includes('invalid token') || lower.includes('token has expired')) {
    return createHttpError('Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu liên kết mới', 400)
  }
  if (lower.includes('database error saving new user')) {
    return createHttpError('Không thể tạo tài khoản do lỗi hệ thống', 500)
  }
  return createHttpError(error?.message || 'Lỗi xác thực', 400)
}

async function register(input = {}) {
  const {
    fullName,
    email,
    password,
    phone,
    role,
    organizationName,
    organizationType,
    organizationAddress,
    walletAddress,
  } = input

  validateRegister({ fullName, email, password, role, organizationType })

  let organizationId = null
  if (organizationName) {
    const organization = await authRepository.createOrganization({
      name: organizationName,
      type: organizationType,
      address: organizationAddress,
    })
    organizationId = organization.id
  }

  const authClient = createAuthClient()
  const { data: authResult, error } = await authClient.auth.signUp({
    email: String(email).toLowerCase(),
    password,
    options: {
      data: {
        full_name: String(fullName).trim(),
        role: role ?? 'FARMER',
      },
    },
  })

  if (error) {
    throw mapAuthError(error)
  }
  if (!authResult.user) {
    throw createHttpError('Không thể tạo tài khoản. Vui lòng thử lại', 500)
  }

  const profile = await authRepository.createProfile(authResult.user, {
    fullName,
    email,
    phone,
    role,
    organizationId,
    walletAddress,
  })

  return {
    requiresConfirmation: authResult.session === null,
    accessToken: authResult.session?.access_token ?? null,
    user: profile,
  }
}

async function login(input) {
  validateLogin(input)

  const authClient = createAuthClient()
  const { data, error } = await authClient.auth.signInWithPassword({
    email: String(input.email).toLowerCase(),
    password: String(input.password),
  })

  if (error) {
    throw mapAuthError(error)
  }

  const profile = await authRepository.findProfileById(data.user.id)

  if (!profile || profile.status !== true) throw Object.assign(createHttpError('Tài khoản không hoạt động hoặc chưa có hồ sơ', 403), { code: 'ACCOUNT_DISABLED' })
  return { accessToken: data.session.access_token, user: profile }
}

async function forgotPassword(email) {
  validateEmail(email)

  const normalizedEmail = String(email).trim().toLowerCase()
  const profile = await authRepository.findProfileByEmail(normalizedEmail)
  if (!profile) return { registered: false }

  const authClient = createAuthClient()
  const { error } = await authClient.auth.resetPasswordForEmail(
    normalizedEmail,
    { redirectTo: `${env.frontendUrl}/reset-password` },
  )
  if (error) throw mapAuthError(error)
  return { registered: true }
}

async function resetPassword(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) input = {}
  const { accessToken, refreshToken, password } = input
  validatePasswordReset({ accessToken, refreshToken, password })

  const authClient = createAuthClient()
  const { error: sessionError } = await authClient.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  })
  if (sessionError) throw mapAuthError(sessionError)

  const { error } = await authClient.auth.updateUser({ password: String(password) })
  if (error) throw mapAuthError(error)
}

async function listUsers() {
  return authRepository.listProfiles()
}

async function updateUser(userId, input = {}, actorId) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) input = {}
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(userId))) {
    throw createHttpError('Mã người dùng không hợp lệ')
  }

  const changes = {}
  if (Object.hasOwn(input, 'fullName')) {
    const fullName = String(input.fullName ?? '').trim()
    if (!fullName || fullName.length > 255) {
      throw createHttpError('Họ tên không được để trống và tối đa 255 ký tự')
    }
    changes.full_name = fullName
  }
  if (Object.hasOwn(input, 'phone')) {
    const phone = input.phone === null ? null : String(input.phone).trim()
    if (phone && phone.length > 20) throw createHttpError('Số điện thoại tối đa 20 ký tự')
    changes.phone = phone || null
  }
  if (Object.hasOwn(input, 'walletAddress')) {
    const walletAddress = input.walletAddress === null ? null : String(input.walletAddress).trim()
    if (walletAddress && walletAddress.length > 255) throw createHttpError('Địa chỉ ví tối đa 255 ký tự')
    changes.wallet_address = walletAddress || null
  }
  if (Object.hasOwn(input, 'role')) {
    if (!USER_ROLES.includes(input.role)) throw createHttpError('Vai trò không hợp lệ')
    changes.role = input.role
  }
  if (Object.hasOwn(input, 'status')) {
    if (typeof input.status !== 'boolean') throw createHttpError('Trạng thái tài khoản không hợp lệ')
    changes.status = input.status
  }
  if (Object.keys(changes).length === 0) throw createHttpError('Không có thông tin nào để cập nhật')

  const current = await authRepository.findProfileById(userId)
  if (!current) throw createHttpError('Không tìm thấy người dùng', 404)

  if (userId === actorId && (changes.role && changes.role !== 'ADMIN' || changes.status === false)) {
    throw createHttpError('Bạn không thể tự hạ quyền hoặc khóa tài khoản quản trị của mình')
  }

  const removesActiveAdmin = current.role === 'ADMIN' && current.status &&
    ((changes.role && changes.role !== 'ADMIN') || changes.status === false)
  if (removesActiveAdmin && (await authRepository.countActiveAdmins()) <= 1) {
    throw createHttpError('Không thể hạ quyền hoặc khóa quản trị viên đang hoạt động cuối cùng')
  }

  return authRepository.updateProfile(userId, changes)
}

async function getMe(userId) {
  const profile = await authRepository.findProfileById(userId)
  if (!profile) {
    throw createHttpError('Hồ sơ người dùng chưa được khởi tạo', 404)
  }
  if (profile.status !== true) throw Object.assign(createHttpError('Tài khoản đã bị khóa hoặc ngừng hoạt động', 403), { code: 'ACCOUNT_DISABLED' })
  return profile
}

async function logout(token) {
  const { error } = await supabase.auth.admin.signOut(token, 'local')
  if (error) throw mapAuthError(error)
  return true
}

module.exports = {
  getMe,
  forgotPassword,
  listUsers,
  login,
  logout,
  register,
  resetPassword,
  updateUser,
  ORG_TYPES,
  USER_ROLES,
}
