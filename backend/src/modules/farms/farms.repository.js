const supabase = require('../../config/supabase')

const FARM_FIELDS =
  'id, owner_id, organization_id, farm_name, address, area, certification, status, created_at, updated_at'

async function create(ownerId, organizationId, farm) {
  const { data, error } = await supabase
    .from('farms')
    .insert({ ...farm, owner_id: ownerId, organization_id: organizationId })
    .select(FARM_FIELDS)
    .single()

  if (error) throw error
  return data
}

async function visible(profile, id) {
  let query = supabase.rpc('production_farms', { p_actor: profile.id }, { get: true })
  query = id ? query.eq('id', id).maybeSingle() : query.order('created_at', { ascending: false })
  const { data, error } = await query
  if (error) throw error
  return data
}

async function canCreateIn(profile, organizationId) {
  const { data, error } = await supabase.rpc('farm_org_can_create', { p_actor: profile.id, p_org: organizationId })
  if (error) throw error
  return data === true
}

async function update(id, changes) {
  const { data, error } = await supabase
    .from('farms')
    .update(changes)
    .eq('id', id)
    .select(FARM_FIELDS)
    .maybeSingle()

  if (error) throw error
  return data
}

async function remove(id) {
  const { data, error } = await supabase
    .from('farms')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) throw error
  return data
}

module.exports = { canCreateIn, create, visible, remove, update }
