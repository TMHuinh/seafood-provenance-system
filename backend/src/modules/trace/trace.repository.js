const QR_FIELDS = 'lot_id,trace_code,status,created_at,revoked_at,revocation_reason,issuer_organization_id,issuer:organizations!issuer_organization_id(name)'
function createTraceRepository(db) {
  async function result(query) { const {data,error}=await query.abortSignal(AbortSignal.timeout(5000)); if(error) throw error; return data }
  async function bounded(query, limit) {
    const data = await result(query.limit(limit + 1))
    if (data.length > limit) throw Object.assign(new Error('Hồ sơ quá lớn, vui lòng liên hệ cơ sở'), {status:503})
    return data
  }
  async function ownedLot(profile, scope) {
    const farm=await result(db.from('farms').select('id').eq('id',scope.farmId).eq('owner_id',profile.id).maybeSingle())
    if(!farm) return null
    const pond=await result(db.from('ponds').select('id').eq('id',scope.pondId).eq('farm_id',scope.farmId).maybeSingle())
    if(!pond) return null
    const batch=await result(db.from('batches').select('id').eq('id',scope.id).eq('pond_id',scope.pondId).maybeSingle())
    if(!batch) return null
    return result(db.from('harvest_lots').select('id').eq('id',scope.lotId).eq('batch_id',scope.id).maybeSingle())
  }
  function findQrByLot(lotId, { legacyOnly = false } = {}) {
    let query = db.from('lot_trace_codes').select(QR_FIELDS).eq('lot_id', lotId)
    if (legacyOnly) query = query.is('issuance_transport_id', null)
    return result(query.order('status').order('issuance_transport_id', { nullsFirst: true })
      .order('created_at', { ascending: false }).order('trace_code', { ascending: false }).limit(1).maybeSingle())
  }
  async function logs(batchId, before) {
    const logs = await bounded(db.from('farming_logs')
      .select('batch_id,lifecycle_status,current_version_id,version:farming_log_versions!farming_logs_current_version_id_fkey(id,status,log_type,log_date,details,image_url,blockchain_event_id)')
      .eq('batch_id',batchId).eq('lifecycle_status','CONFIRMED').lt('log_date',before).order('log_date'),500)
    const ids = logs.map(log => log.version?.blockchain_event_id).filter(Boolean)
    if (!ids.length) return logs
    const records = await bounded(db.from('blockchain_records').select('event_id,status').in('event_id', ids),500)
    const statusByEvent = new Map(records.map(record => [record.event_id, record.status]))
    return logs.map(log => ({...log,recordedStatus:statusByEvent.get(log.version?.blockchain_event_id) ?? null}))
  }
  async function transports(lotId, transportId) {
    let query = db.from('transport_logs').select('id,harvest_lot_id,transport_code,transport_date,status,quantity,received_quantity,receipt_outcome,recipient:organizations!recipient_organization_id(name)').eq('harvest_lot_id',lotId)
    if (transportId) query = query.eq('id', transportId)
    const trips = await bounded(query.order('transport_date'), 100)
    if(!trips.length) return []
    const events=await bounded(db.from('transport_events').select('transport_id,event_type,occurred_at,payload,blockchain_status').in('transport_id',trips.map(trip=>trip.id)).order('sequence'),500)
    return trips.map(trip=>({...trip,events:events.filter(event=>event.transport_id===trip.id)}))
  }
  async function packaging(lotId, transportId) {
    let query = db.from('lot_packaging').select('transport_id,snapshot,event_id').eq('lot_id', lotId)
    if (transportId) query = query.eq('transport_id', transportId)
    const rows = await bounded(query.order('transport_id'), 100)
    if (!rows.length) return []
    const records = await bounded(db.from('blockchain_records').select('event_id,status,transaction_hash,data_hash,contract_address,chain_id').in('event_id', rows.map(row => row.event_id)), 100)
    const byEvent = new Map(records.map(record => [record.event_id, record]))
    return rows.map(row => ({ snapshot: row.snapshot, eventId: row.event_id, record: byEvent.get(row.event_id) }))
  }
  return { ownedLot,findQrByLot,logs,transports,packaging,
    findQr: code => result(db.from('lot_trace_codes').select('lot_id,status,issuance_transport_id').eq('trace_code',code).maybeSingle()),
    findLot: id => result(db.from('harvest_lots').select('id,batch_id,lot_code,quantity,provenance,blockchain_event_id').eq('id',id).maybeSingle()),
    proof: eventId => result(db.from('blockchain_records').select('status,data_hash,transaction_hash,contract_address,chain_id').eq('event_id',eventId).maybeSingle()),
  }
}
module.exports = { createTraceRepository }
