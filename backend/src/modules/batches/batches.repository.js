const supabase = require('../../config/supabase')
const BATCH_FIELDS = 'id, pond_id, batch_code, species, seed_source, seed_quantity, stocking_date, expected_harvest_date, actual_harvest_date, yield_quantity, status, note, created_at, updated_at, current_version'

async function create(pondId, batch) {
  const { data, error } = await supabase.from('batches').insert({ ...batch, pond_id: pondId }).select(BATCH_FIELDS).single()
  if (error) throw error
  return data
}

async function findAllByPond(pondId) {
  const { data, error } = await supabase.from('batches').select(BATCH_FIELDS).eq('pond_id', pondId).order('stocking_date', { ascending: false })
  if (error) throw error
  return data ?? []
}

async function correctByPond(id, pondId, changes, expectedVersion, reason, actorId) {
  const { data, error } = await supabase.rpc('correct_batch', {
    p_id: id, p_pond_id: pondId, p_changes: changes,
    p_expected_version: expectedVersion, p_reason: reason, p_actor: actorId,
  }).single()
  if (error) throw error
  return data
}

async function findVersions(batchId) {
  const { data, error } = await supabase.from('batch_versions').select('*')
    .eq('batch_id', batchId).order('version_number', { ascending: false })
  if (error) throw error
  return data ?? []
}

async function removeByPond(id, pondId) {
  const { data, error } = await supabase.from('batches').delete().eq('id', id).eq('pond_id', pondId).select('id').maybeSingle()
  if (error) throw error
  return data
}

const BATCH_STATUSES = ['PREPARING', 'GROWING', 'READY_FOR_HARVEST', 'HARVESTED', 'COMPLETED', 'CANCELLED']
function scopedQuery(profile, { search = '', status = '' } = {}, head = false) {
  // Inner joins ensure scope filtering happens in SQL before count/range.
  const fields = head ? 'id,pond:ponds!inner(id,farm:farms!inner(id))'
    : `${BATCH_FIELDS},pond:ponds!inner(id,pond_code,pond_name,status,farm:farms!inner(farm_name,organization_id,owner_id))`
  let query = supabase.from('batches').select(fields, { count: 'exact', head })
  if (profile.role !== 'ADMIN') {
    if (profile.organization_id) {
      query = query.or(`owner_id.eq.${profile.id},organization_id.eq.${profile.organization_id}`, { referencedTable: 'pond.farm' })
    } else query = query.eq('pond.farm.owner_id', profile.id)
  }
  if (search) query = query.ilike('batch_code', `%${search.replace(/[\\%_]/g, '\\$&')}%`)
  if (status) query = query.eq('status', status)
  return query
}
async function findPage(profile, options) {
  const { data, count, error } = await scopedQuery(profile, options)
    .order('created_at', { ascending: false }).order('id')
    .range((options.page - 1) * options.pageSize, options.page * options.pageSize - 1)
  if (error) throw error
  return { items: data ?? [], count: count ?? 0 }
}
async function summarize(profile, search) {
  const counts = await Promise.all(BATCH_STATUSES.map(async status => {
    const { count, error } = await scopedQuery(profile, { search, status }, true)
    if (error) throw error
    return [status, count ?? 0]
  }))
  const byStatus = Object.fromEntries(counts)
  return { total: counts.reduce((sum, [, count]) => sum + count, 0), byStatus }
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
  create,
  countFarmingLogs,
  findById,
  findDistributions,
  findHarvests,
  findPondsByIds,
  findPage,
  summarize,
  BATCH_STATUSES,
  findAllByPond,
  removeByPond,
  findTransports,
  correctByPond,
  findVersions,
}
