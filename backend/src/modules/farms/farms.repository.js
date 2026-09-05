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

async function findAllByOwner(ownerId) {
  const { data, error } = await supabase
    .from('farms')
    .select(FARM_FIELDS)
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data ?? []
}

async function findByIdAndOwner(id, ownerId) {
  const { data, error } = await supabase
    .from('farms')
    .select(FARM_FIELDS)
    .eq('id', id)
    .eq('owner_id', ownerId)
    .maybeSingle()

  if (error) throw error
  return data
}

async function update(id, ownerId, changes) {
  const { data, error } = await supabase
    .from('farms')
    .update(changes)
    .eq('id', id)
    .eq('owner_id', ownerId)
    .select(FARM_FIELDS)
    .maybeSingle()

  if (error) throw error
  return data
}

async function remove(id, ownerId) {
  const { data, error } = await supabase
    .from('farms')
    .delete()
    .eq('id', id)
    .eq('owner_id', ownerId)
    .select('id')
    .maybeSingle()

  if (error) throw error
  return data
}

module.exports = { create, findAllByOwner, findByIdAndOwner, remove, update }
