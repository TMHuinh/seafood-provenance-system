const supabase = require('../config/supabase')
const { createAuthClient } = supabase

const USER_ROLES = ['ADMIN', 'FARMER', 'TRANSPORTER', 'DISTRIBUTOR']
const ORG_TYPES = [
  'FARMER_HOUSEHOLD',
  'COOPERATIVE',
  'COMPANY',
  'PROCESSOR',
  'DISTRIBUTOR',
  'RETAILER',
  'EXPORTER',
]

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function createValidationError(message) {
  const error = new Error(message)
  error.status = 400
  return error
}

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

async function createOrganization({ name, type, address }) {
  const { data, error } = await supabase
    .from('organizations')
    .insert({
      name: String(name).trim(),
      type: type ?? 'COMPANY',
      address: address ?? null,
    })
    .select()
    .single()

  if (error) {
    throw error
  }
  return data
}

async function createProfile(authUser, profile) {
  const { data, error } = await supabase
    .from('user_profiles')
    .insert({
      id: authUser.id,
      organization_id: profile.organizationId ?? null,
      full_name: String(profile.fullName).trim(),
      email: String(profile.email).toLowerCase(),
      phone: profile.phone ?? null,
      role: profile.role ?? 'FARMER',
      wallet_address: profile.walletAddress ?? null,
      status: true,
    })
    .select('*, organization:organizations(*)')
    .single()

  if (error) {
    throw error
  }
  return data
}

/**
 * Đăng ký tài khoản mới (backend là bộ não xử lý mọi thứ):
 * 1. Tạo tài khoản trên Supabase Auth (khóa thông tin đăng nhập)
 * 2. Tạo tổ chức nếu người dùng cung cấp thông tin
 * 3. Tạo hồ sơ chi tiết trong bảng user_profiles
 */
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
    const organization = await createOrganization({
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

  const profile = await createProfile(authResult.user, {
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

/**
 * Đăng nhập: xác nhận thông tin qua Supabase Auth,
 * sau đó tải hồ sơ user_profiles kèm tổ chức.
 */
async function login({ email, password }) {
  if (!email || !password) {
    throw createValidationError('Vui lòng nhập email và mật khẩu')
  }

  const authClient = createAuthClient()
  const { data, error } = await authClient.auth.signInWithPassword({
    email: String(email).toLowerCase(),
    password: String(password),
  })

  if (error) {
    throw mapAuthError(error)
  }

  const profile = await loadProfile(data.user.id)

  return {
    accessToken: data.session.access_token,
    user: profile ?? {
      id: data.user.id,
      email: data.user.email,
      role: 'FARMER',
    },
  }
}

/**
 * Hồ sơ người dùng hiện tại.
 */
async function getMe(userId) {
  const profile = await loadProfile(userId)
  if (!profile) {
    throw createHttpError('Hồ sơ người dùng chưa được khởi tạo', 404)
  }
  return profile
}

/**
 * Đăng xuất: thu hồi session trên Supabase Auth.
 */
async function logout(token) {
  const { error } = await supabase.auth.signOut(token)
  void error
  return true
}

module.exports = {
  register,
  login,
  getMe,
  logout,
  USER_ROLES,
  ORG_TYPES,
}
