const supabase = require('../../config/supabase')

const LOG_FIELDS =
  'id, batch_id, created_by, log_date, log_type, details, image_url, data_hash, tx_hash, current_version, current_version_id, lifecycle_status, created_at, updated_at'

async function create(userId, logData) {
  const { data, error } = await supabase
    .from('farming_logs')
    .insert({ ...logData, created_by: userId })
    .select(LOG_FIELDS)
    .single()

  if (error) throw error
  return data
}

async function findById(id) {
  const { data, error } = await supabase
    .from('farming_logs')
    .select(LOG_FIELDS)
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  return data
}

async function update(id, changes, expected) {
  if (!expected) throw new Error('Expected log state is required')
  let query = supabase.from('farming_logs').update(changes).eq('id', id)
    .eq('lifecycle_status', expected.lifecycle_status).eq('current_version', expected.current_version)
    .eq('updated_at', expected.updated_at)
  query = expected.current_version_id ? query.eq('current_version_id', expected.current_version_id) : query.is('current_version_id', null)
  const { data, error } = await query.select(LOG_FIELDS).maybeSingle()
  if (error) throw error
  if (!data) throw Object.assign(new Error('Nhật ký đã thay đổi. Vui lòng tải lại trước khi thao tác'), { status: 409 })
  return data
}

async function findVersionByEvent(eventId) {
  const { data, error } = await supabase.from('farming_log_versions').select('*').eq('blockchain_event_id', eventId).maybeSingle()
  if (error) throw error
  return data
}
async function findCurrentVersions(ids) {
  const rows = []
  const unique = [...new Set(ids.filter(Boolean))]
  for (let i = 0; i < unique.length; i += 100) {
    const { data, error } = await supabase.from('farming_log_versions').select('id,blockchain_event_id').in('id', unique.slice(i, i + 100))
    if (error) throw error
    rows.push(...data)
  }
  return rows
}

async function createVersion(log, correctedBy, correctionReason, blockchainEventId, options = {}) {
  function reusable(version) {
    if (version && version.farming_log_id === log.id && version.version_number === log.current_version && version.data_hash === log.data_hash && version.status === 'ACTIVE' &&
      (version.image_url ?? null) === (log.image_url ?? null) &&
      (version.correction_reason ?? null) === correctionReason &&
      (version.evidence_url ?? null) === (options.evidenceUrl ?? null) &&
      (version.supersedes_version_id ?? null) === (options.supersedesVersionId ?? null)) return version
    throw Object.assign(new Error('Phiên bản nhật ký đã thay đổi hoặc dữ liệu chứng thực khác nhau'), { status: 409 })
  }
  const existing = await findVersionByEvent(blockchainEventId)
  if (existing) return reusable(existing)
  const { data, error } = await supabase
    .from('farming_log_versions')
    .insert({
      farming_log_id: log.id,
      version_number: log.current_version,
      log_date: log.log_date,
      log_type: log.log_type,
      details: log.details,
      image_url: log.image_url,
      data_hash: log.data_hash,
      tx_hash: log.tx_hash,
      blockchain_event_id: blockchainEventId,
      correction_reason: correctionReason,
      corrected_by: correctedBy,
      status: 'ACTIVE',
      confirmed_at: new Date().toISOString(),
      supersedes_version_id: options.supersedesVersionId ?? null,
      evidence_url: options.evidenceUrl ?? null,
      block_number: options.blockNumber ?? null,
    })
    .select()
    .single()

  if (error?.code === '23505') return reusable(await findVersionByEvent(blockchainEventId))
  if (error) throw error
  return data
}

async function updateVersion(id, changes) {
  const { data, error } = await supabase.from('farming_log_versions').update(changes).eq('id', id).select().single()
  if (error) throw error
  return data
}

async function findVersions(logId) {
  const { data, error } = await supabase.from('farming_log_versions').select('*').eq('farming_log_id', logId).order('version_number', { ascending: false })
  if (error) throw error
  return data ?? []
}

async function createAudit(userId, entityId, action, oldData, newData) {
  const { error } = await supabase.from('audit_logs').insert({ user_id: userId, entity_type: 'FARMING_LOG', entity_id: entityId, action, old_data: oldData, new_data: newData })
  if (error) throw error
}

async function updateHashes(id, dataHash, txHash) {
  const { data, error } = await supabase
    .from('farming_logs')
    .update({ data_hash: dataHash, tx_hash: txHash })
    .eq('id', id)
    .select(LOG_FIELDS)
    .maybeSingle()

  if (error) throw error
  return data
}

async function findAllByBatch(batchId) {
  const { data, error } = await supabase
    .from('farming_logs')
    .select(LOG_FIELDS)
    .eq('batch_id', batchId)
    .order('log_date', { ascending: false })

  if (error) throw error
  return data ?? []
}

module.exports = { findCurrentVersions, create, findById, update, createVersion, updateVersion, findVersions, createAudit, updateHashes, findAllByBatch }
