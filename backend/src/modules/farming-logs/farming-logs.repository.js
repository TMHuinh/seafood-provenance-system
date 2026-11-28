const supabase = require('../../config/supabase')

const LOG_FIELDS =
  'id, batch_id, created_by, log_date, log_type, details, image_url, data_hash, tx_hash, current_version, current_version_id, lifecycle_status, created_at, updated_at,' +
  'author:user_profiles!farming_logs_created_by_fkey(full_name),' +
  'confirmation:farming_log_versions!farming_logs_current_version_id_fkey(confirmed_at,confirmed_by,confirmer:user_profiles!farming_log_versions_confirmed_by_fkey(full_name))'

function projectLog(row) {
  if (!row) return null
  const { author, confirmation, ...log } = row
  return {
    ...log,
    author_name: author?.full_name ?? null,
    confirmed_at: confirmation?.confirmed_at ?? null,
    confirmed_by: confirmation?.confirmed_by ?? null,
    confirmer_name: confirmation?.confirmer?.full_name ?? null,
  }
}

async function create(userId, logData) {
  return callWriteRpc('create_farming_log_draft', {
    p_actor: userId, p_batch: logData.batch_id, p_date: logData.log_date,
    p_type: logData.log_type, p_details: logData.details, p_image: logData.image_url,
  })
}

async function callWriteRpc(name, args) {
  const { data, error } = await supabase.rpc(name, args)
  if (error?.code === 'P0002') {
    throw Object.assign(new Error('Không tìm thấy nhật ký nuôi'), { status: 404 })
  }
  if (error?.code === 'PT409') {
    throw Object.assign(new Error('Nhật ký đã thay đổi hoặc đang chờ chứng thực. Vui lòng tải lại trước khi thao tác'), { status: 409 })
  }
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
  return projectLog(data)
}

function reserveAnchor(actor, log, operation, hash) {
  return callWriteRpc('reserve_farming_log_anchor', {
    p_actor: actor, p_log: log.id, p_updated_at: log.updated_at, p_mode: operation, p_hash: hash,
  })
}

function applyChange(actor, log, operation, { changes = null, version = null, reason = null } = {}) {
  return callWriteRpc('apply_farming_log_change', {
    p_actor: actor, p_log: log.id, p_updated_at: log.updated_at, p_mode: operation,
    p_changes: changes, p_version: version, p_reason: reason,
  })
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

async function findVersions(logId, maxVersion) {
  const { data, error } = await supabase.from('farming_log_versions').select('*').eq('farming_log_id', logId).order('version_number', { ascending: false })
    .lte('version_number', maxVersion)
  if (error) throw error
  return data ?? []
}

async function findAllByBatch(batchId) {
  const { data, error } = await supabase
    .from('farming_logs')
    .select(LOG_FIELDS)
    .eq('batch_id', batchId)
    .order('log_date', { ascending: false })

  if (error) throw error
  return (data ?? []).map(projectLog)
}

module.exports = { findCurrentVersions, create, findById, reserveAnchor, applyChange, createVersion, findVersions, findAllByBatch }
