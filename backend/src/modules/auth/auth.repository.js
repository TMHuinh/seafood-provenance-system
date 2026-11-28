const supabase = require('../../config/supabase')

async function findProfileById(userId) {
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

async function findProfileByEmail(email) {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('id')
    .eq('email', String(email).trim().toLowerCase())
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data
}

async function listProfiles() {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*, organization:organizations(*)')
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

async function countActiveAdmins() {
  const { count, error } = await supabase
    .from('user_profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'ADMIN')
    .eq('status', true)

  if (error) throw error
  return count ?? 0
}

async function updateProfile(userId, changes) {
  const { data, error } = await supabase
    .from('user_profiles')
    .update(changes)
    .eq('id', userId)
    .select('*, organization:organizations(*)')
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw error
  }
  return data
}

async function createProfile(authUser, profile) {
  const { error } = await supabase.rpc('register_production_profile', {
    p_user: authUser.id,
    p_name: String(profile.fullName).trim(),
    p_email: String(profile.email).toLowerCase(),
    p_phone: profile.phone ?? null,
    p_role: profile.role ?? 'FARMER',
    p_wallet: profile.walletAddress ?? null,
    p_org_name: profile.organizationName?.trim() || null,
    p_org_type: profile.organizationType || null,
    p_org_address: profile.organizationAddress ?? null,
  })
  if (error) throw error
  return findProfileById(authUser.id)
}

module.exports = {
  createProfile,
  countActiveAdmins,
  findProfileByEmail,
  findProfileById,
  listProfiles,
  updateProfile,
}
