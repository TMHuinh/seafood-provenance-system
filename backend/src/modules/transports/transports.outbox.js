const supabase = require('../../config/supabase')
const blockchain = require('../blockchain/blockchain.service')

let timer = null
let running = false
let stopped = false

function retryDelaySeconds(attempt) {
  return Math.min(60 * (2 ** Math.min(attempt, 6)), 3600)
}

function eventEnvelope(event, previousHash) {
  return {
    schema: 'seafood-transport-event-v1',
    eventId: event.event_id,
    eventType: event.event_type,
    transportId: event.transport_id,
    sequence: event.sequence,
    occurredAt: new Date(event.occurred_at).toISOString(),
    actorId: event.actor_id,
    previousHash,
    payload: event.payload,
  }
}

async function previousEvent(event) {
  if (event.sequence <= 1) return null
  const { data, error } = await supabase
    .from('transport_events')
    .select('sequence, data_hash, blockchain_status')
    .eq('transport_id', event.transport_id)
    .eq('sequence', event.sequence - 1)
    .maybeSingle()
  if (error) throw error
  if (!data || data.blockchain_status !== 'SUCCESS' || !data.data_hash) {
    throw new Error('Sự kiện trước chưa được xác nhận trên blockchain')
  }
  return data.data_hash
}

async function finish(event, values) {
  const { error } = await supabase
    .from('transport_events')
    .update({ ...values, lease_token: null, lease_until: null })
    .eq('id', event.id)
    .eq('lease_token', event.lease_token)
  if (error) throw error
}

async function processEvent(event) {
  const attempt = Number(event.attempt_count ?? 0) + 1
  try {
    const previousHash = await previousEvent(event)
    const envelope = eventEnvelope(event, previousHash)
    const dataHash = blockchain.hashData(envelope)

    if (event.data_hash && (event.data_hash !== dataHash || event.previous_hash !== previousHash)) {
      throw new Error('Hash sự kiện không khớp với dữ liệu bất biến đã lưu')
    }
    if (!event.data_hash) {
      const { error } = await supabase
        .from('transport_events')
        .update({ data_hash: dataHash, previous_hash: previousHash })
        .eq('id', event.id)
        .eq('lease_token', event.lease_token)
        .is('data_hash', null)
      if (error) throw error
    }

    const { record } = await blockchain.createRecord({
      batchId: event.batch_id,
      entityType: 'TRANSPORT',
      entityId: event.transport_id,
      eventType: 'TRANSPORT_RECORDED',
      eventId: event.event_id,
      payload: envelope,
    })
    const succeeded = record.status === 'SUCCESS'
    const delay = retryDelaySeconds(attempt)
    await finish(event, {
      blockchain_status: record.status,
      transaction_hash: record.transaction_hash,
      block_number: record.block_number,
      contract_address: record.contract_address,
      attempt_count: attempt,
      retry_after: new Date(Date.now() + delay * 1000).toISOString(),
      last_error: succeeded ? null : record.status === 'FAILED'
        ? (record.error || 'Gửi dữ liệu lên blockchain thất bại; hệ thống sẽ tự thử lại.')
        : 'Blockchain chưa xác nhận giao dịch; hệ thống sẽ tiếp tục thử lại.',
      recorded_at: succeeded ? (record.recorded_at ?? new Date().toISOString()) : null,
    })
  } catch (error) {
    const delay = retryDelaySeconds(attempt)
    try {
      await finish(event, {
        blockchain_status: 'FAILED',
        attempt_count: attempt,
        retry_after: new Date(Date.now() + delay * 1000).toISOString(),
        last_error: String(error?.message ?? error).slice(0, 2000),
      })
    } catch (saveError) {
      console.error('Không cập nhật được trạng thái outbox vận chuyển:', saveError)
    }
    console.error(`Không thể ghi sự kiện vận chuyển ${event.event_id}:`, error)
  }
}

async function processBatch() {
  if (running || stopped) return
  running = true
  try {
    const { data, error } = await supabase.rpc('claim_transport_event_outbox', {
      p_limit: 20,
      p_lease_seconds: 300,
    })
    if (error) throw error
    for (const event of data ?? []) await processEvent(event)
  } catch (error) {
    console.error('Không đọc được outbox vận chuyển:', error)
  } finally {
    running = false
  }
}

function start() {
  if (timer) return
  stopped = false
  timer = setInterval(processBatch, 15000)
  timer.unref?.()
  void processBatch()
}

function nudge() {
  if (!stopped) void processBatch()
}

function stop() {
  stopped = true
  if (timer) clearInterval(timer)
  timer = null
}

module.exports = { start, stop, nudge, processBatch }
