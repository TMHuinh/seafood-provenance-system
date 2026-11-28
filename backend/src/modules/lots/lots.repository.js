const { dateBounds, searchPattern, fail } = require('./lots.validation')
const PAGE_SIZE = 500
const MAX_ROWS = 20000
const PARENTS = 'batch:batches!inner(id,batch_code,species,pond_id,pond:ponds!inner(id,pond_name,pond_code,farm_id,farm:farms!inner(id,farm_name,owner_id)))'
function createLotsRepository(db) {
  async function result(query) {
    const response = await query.abortSignal(AbortSignal.timeout(15000))
    if (response.error) throw response.error
    return response
  }
  function scope(query, profile, options = {}) {
    if (options.farmId) query = query.eq('batch.pond.farm_id', options.farmId)
    if (options.pondId) query = query.eq('batch.pond_id', options.pondId)
    return query
  }
  // Read every page, including the sentinel row. Never return a silently truncated total.
  async function all(build, maximum = MAX_ROWS) {
    const rows = []
    for (let offset = 0; offset <= maximum; offset += PAGE_SIZE) {
      const size = Math.min(PAGE_SIZE, maximum + 1 - offset)
      const { data } = await result(build().range(offset, offset + size - 1))
      rows.push(...data)
      if (rows.length > maximum) fail('Phạm vi dữ liệu quá lớn. Vui lòng thu hẹp bộ lọc để thống kê', 422)
      if (data.length < size) break
    }
    return rows
  }
  function lotQuery(profile, options = {}) {
    let query = scope(db.rpc('production_lots', { p_actor: profile.id }, { get: true, count: 'exact' }).select(`id,lot_code,batch_id,quantity,status,created_at,provenance,blockchain_event_id,${PARENTS},harvest:harvests!inner(harvest_date),qr:lot_trace_codes(trace_code,status)`), profile, options)
      .order('status', { referencedTable: 'qr' })
      .order('created_at', { referencedTable: 'qr', ascending: false })
      .order('trace_code', { referencedTable: 'qr', ascending: false })
      .limit(1, { referencedTable: 'qr' })
    const bounds = dateBounds(options)
    if (bounds.from) query = query.gte('harvest.harvest_date', bounds.from)
    if (bounds.until) query = query.lt('harvest.harvest_date', bounds.until)
    if (options.species) query = query.eq('provenance->batch->>species', options.species)
    if (options.status) query = query.eq('status', options.status)
    if (options.search) {
      const pattern = searchPattern(options.search)
      query = query.or(['lot_code', 'provenance->batch->>batch_code', 'provenance->farm->>name', 'provenance->pond->>name', 'provenance->pond->>code', 'provenance->batch->>seed_source'].map(field => `${field}.imatch.${pattern}`).join(','))
    }
    return query
  }
  return {
    async page(profile, options) {
      const { data, count } = await result(lotQuery(profile, options)
        .order('created_at', { ascending: false }).order('id')
        .range((options.page - 1) * options.pageSize, options.page * options.pageSize - 1))
      return { items: data, count: count ?? 0 }
    },
    async find(profile, id) { return (await result(lotQuery(profile).eq('id', id).maybeSingle())).data },
    async harvests(profile, options) {
      const bounds = dateBounds(options)
      const cutoff = new Date().toISOString()
      return all(() => {
        let query = scope(db.rpc('production_harvests', { p_actor: profile.id }, { get: true }).select(`id,quantity,harvest_date,${PARENTS},lots:harvest_lots(id,provenance)`).lte('created_at', cutoff), profile, options)
        if (bounds.from) query = query.gte('harvest_date', bounds.from)
        if (bounds.until) query = query.lt('harvest_date', bounds.until)
        // Species is taken from the harvest snapshot in the service, including legacy harvests.
        return query.order('id')
      })
    },
    async options(profile) {
      const farms = await all(() => db.rpc('production_farms', { p_actor: profile.id }, { get: true })
        .select('id,farm_name').order('id'))
      const ponds = await all(() => db.rpc('production_ponds', { p_actor: profile.id }, { get: true })
        .select('id,farm_id,pond_name,pond_code').order('id'))
      return { farms, ponds }
    },
    async history(batchId) {
      return all(() => db.from('batch_versions').select('version_number,correction_reason,created_at')
        .eq('batch_id', batchId).order('version_number'), 2000)
    },
  }
}
module.exports = { createLotsRepository }
