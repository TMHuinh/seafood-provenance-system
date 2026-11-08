const QR_FIELDS = 'lot_id,trace_code,status,created_at,revoked_at,revocation_reason'
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
  const findQrByLot = lotId => result(db.from('lot_trace_codes').select(QR_FIELDS).eq('lot_id',lotId).maybeSingle())
  async function issue(lotId) {
    // ON CONFLICT DO NOTHING: simultaneous issuance never rotates a code or reactivates a revoked QR.
    await result(db.from('lot_trace_codes').upsert({lot_id:lotId},{onConflict:'lot_id',ignoreDuplicates:true}))
    return findQrByLot(lotId)
  }
  async function revoke(lotId, reason) {
    await result(db.from('lot_trace_codes').update({status:'REVOKED',revoked_at:new Date().toISOString(),revocation_reason:reason}).eq('lot_id',lotId).eq('status','ACTIVE'))
    return findQrByLot(lotId)
  }
  async function logs(batchId, before) {
    const logs = await bounded(db.from('farming_logs')
      .select('batch_id,lifecycle_status,current_version_id,version:farming_log_versions!farming_logs_current_version_id_fkey(id,status,log_type,log_date,details,blockchain_event_id)')
      .eq('batch_id',batchId).eq('lifecycle_status','CONFIRMED').lt('log_date',before).order('log_date'),500)
    const ids = logs.map(log => log.version?.blockchain_event_id).filter(Boolean)
    if (!ids.length) return logs
    const records = await bounded(db.from('blockchain_records').select('event_id,status').in('event_id', ids),500)
    const statusByEvent = new Map(records.map(record => [record.event_id, record.status]))
    return logs.map(log => ({...log,recordedStatus:statusByEvent.get(log.version?.blockchain_event_id) ?? null}))
  }
  async function transports(lotId) {
    const trips=await bounded(db.from('transport_logs').select('id,harvest_lot_id,transport_code,transport_date,status,quantity,recipient:organizations!recipient_organization_id(name)').eq('harvest_lot_id',lotId).order('transport_date'),100)
    if(!trips.length) return []
    const events=await bounded(db.from('transport_events').select('transport_id,event_type,occurred_at,payload,blockchain_status').in('transport_id',trips.map(trip=>trip.id)).order('sequence'),500)
    return trips.map(trip=>({...trip,events:events.filter(event=>event.transport_id===trip.id)}))
  }
  return { ownedLot,findQrByLot,issue,revoke,logs,transports,
    findQr: code => result(db.from('lot_trace_codes').select('lot_id,status').eq('trace_code',code).maybeSingle()),
    findLot: id => result(db.from('harvest_lots').select('id,batch_id,lot_code,quantity,provenance,blockchain_event_id').eq('id',id).maybeSingle()),
    proof: eventId => result(db.from('blockchain_records').select('status,data_hash,transaction_hash,contract_address').eq('event_id',eventId).maybeSingle()),
  }
}
module.exports = { createTraceRepository }
