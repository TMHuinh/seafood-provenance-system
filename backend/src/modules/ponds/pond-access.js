function missing(message) {
  return Object.assign(new Error(message), { status: 404 })
}

async function requirePondAction(profile, pondId, action, {
  db = require('../../config/supabase'), notFound = 'Không tìm thấy ao nuôi',
} = {}) {
  const { data, error } = await db.rpc('pond_can', { p_actor: profile.id, p_pond: pondId, p_action: action })
  if (error) throw error
  if (!data) throw missing(notFound)
}

async function requireFarmManager(profile, farmId, db = require('../../config/supabase')) {
  const { data, error } = await db.rpc('farm_can_manage', { p_actor: profile.id, p_farm: farmId })
  if (error) throw error
  if (!data) throw missing('Không tìm thấy cơ sở nuôi')
}

module.exports = { requireFarmManager, requirePondAction }
