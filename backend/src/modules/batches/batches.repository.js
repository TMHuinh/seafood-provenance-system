const supabase = require('../../config/supabase')

async function findRecent() {
  const { data, count, error } = await supabase
    .from('batches')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    throw error
  }

  return { items: data ?? [], count }
}

async function findPondsByIds(pondIds) {
  if (pondIds.length === 0) {
    return []
  }

  const { data, error } = await supabase
    .from('ponds')
    .select('id, pond_code, pond_name, status, farm_id, farm:farms(farm_name, organization_id)')
    .in('id', pondIds)

  if (error) {
    throw error
  }

  return data ?? []
}

async function findById(id) {
  const { data, error } = await supabase
    .from('batches')
    .select('*, pond:ponds(*, farm:farms(*, organization:organizations(*)))')
    .eq('id', id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      return null
    }
    throw error
  }

  return data
}

async function countFarmingLogs(batchId) {
  const { count, error } = await supabase
    .from('farming_logs')
    .select('id', { count: 'exact', head: true })
    .eq('batch_id', batchId)

  if (error) {
    throw error
  }

  return count ?? 0
}

async function findHarvests(batchId) {
  const { data, error } = await supabase
    .from('harvests')
    .select('id, harvest_date, quantity, average_weight, quality_grade, note, created_at')
    .eq('batch_id', batchId)
    .order('harvest_date', { ascending: true })

  return error ? [] : data
}

async function findTransports(batchId) {
  const { data, error } = await supabase
    .from('transport_logs')
    .select('id, transport_code, transport_date, from_location, to_location, temperature, status')
    .eq('batch_id', batchId)
    .order('transport_date', { ascending: true })
    .limit(20)

  return error ? [] : data
}

async function findDistributions(batchId) {
  const { data, error } = await supabase
    .from('distribution_logs')
    .select('id, distribution_date, quantity, location, status')
    .eq('batch_id', batchId)
    .order('distribution_date', { ascending: true })
    .limit(20)

  return error ? [] : data
}

module.exports = {
  countFarmingLogs,
  findById,
  findDistributions,
  findHarvests,
  findPondsByIds,
  findRecent,
  findTransports,
}
