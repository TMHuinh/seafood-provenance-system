const supabase = require('../../config/supabase')
const { createAuthClient } = supabase

const authRepository = require('./auth.repository')
const { ORG_TYPES, USER_ROLES } = require('./auth.constants')
const { validateLogin, validateRegister } = require('./auth.validation')

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
  if (lower.includes('database error saving new user')) {
    return createHttpError('Không thể tạo tài khoản do lỗi hệ thống', 500)
  }
  return createHttpError(error?.message || 'Lỗi xác thực', 400)
}

async function register(input) {
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

  return {
    accessToken: data.session.access_token,
    user: profile ?? {
      id: data.user.id,
      email: data.user.email,
      role: 'FARMER',
    },
  }
}

async function getMe(userId) {
  const profile = await authRepository.findProfileById(userId)
  if (!profile) {
    throw createHttpError('Hồ sơ người dùng chưa được khởi tạo', 404)
  }
  return profile
}

async function logout(token) {
  const { error } = await supabase.auth.signOut(token)
  void error
  return true
}

module.exports = {
  getMe,
  login,
  logout,
  register,
  ORG_TYPES,
  USER_ROLES,
}
