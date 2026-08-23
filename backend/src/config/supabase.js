const { createClient } = require('@supabase/supabase-js')

const env = require('./env')

const clientOptions = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
}

// Client quản trị chỉ dùng cho truy vấn database và xác thực JWT.
// Không gọi signIn/signUp trên client này vì các hàm đó thay đổi session
// nội bộ, khiến những truy vấn tiếp theo không còn dùng quyền service_role.
const supabase = createClient(
  env.supabaseUrl,
  env.supabaseSecretKey,
  clientOptions,
)

// Tạo client Auth riêng cho từng thao tác đăng nhập/đăng ký để session của
// người dùng không làm thay đổi client quản trị dùng chung ở trên.
function createAuthClient() {
  return createClient(env.supabaseUrl, env.supabaseAnonKey, clientOptions)
}

module.exports = supabase
module.exports.createAuthClient = createAuthClient
