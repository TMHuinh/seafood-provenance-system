const supabase = require('../../config/supabase')

const FIELDS = 'id, farm_id, pond_code, pond_name, area, depth, water_type, status, created_at, updated_at'

async function create(farmId, pond) {
  const { data, error } = await supabase.from('ponds').insert({ ...pond, farm_id: farmId }).select(FIELDS).single()
  if (error) throw error
  return data
}

async function findAll(farmId) {
  const { data, error } = await supabase.from('ponds').select(FIELDS).eq('farm_id', farmId).order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

async function findByIdAndFarm(id, farmId) {
  const { data, error } = await supabase.from('ponds').select(FIELDS).eq('id', id).eq('farm_id', farmId).maybeSingle()
  if (error) throw error
  return data
}

async function update(id, farmId, changes) {
  const { data, error } = await supabase.from('ponds').update(changes).eq('id', id).eq('farm_id', farmId).select(FIELDS).maybeSingle()
  if (error) throw error
  return data
}

async function remove(id, farmId) {
  const { data, error } = await supabase.from('ponds').delete().eq('id', id).eq('farm_id', farmId).select('id').maybeSingle()
  if (error) throw error
  return data
}

module.exports = { create, findAll, findByIdAndFarm, remove, update }
