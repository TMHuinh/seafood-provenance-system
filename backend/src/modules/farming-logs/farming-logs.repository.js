const supabase = require('../../config/supabase')

const LOG_FIELDS =
  'id, batch_id, created_by, log_date, log_type, details, image_url, data_hash, tx_hash, created_at, updated_at'

async function create(userId, logData) {
  const { data, error } = await supabase
    .from('farming_logs')
    .insert({ ...logData, created_by: userId })
    .select(LOG_FIELDS)
    .single()

  if (error) throw error
  return data
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

module.exports = { create, updateHashes, findAllByBatch }