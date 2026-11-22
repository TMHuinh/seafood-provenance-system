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

module.exports = {
  createOrganization,
  createProfile,
  countActiveAdmins,
  findProfileByEmail,
  findProfileById,
  listProfiles,
  updateProfile,
}
