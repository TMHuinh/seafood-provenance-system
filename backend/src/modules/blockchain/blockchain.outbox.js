function retryDelaySeconds(attempt) {
  return Math.min(60 * 2 ** Math.min(attempt, 6), 3600)
}

function proofPayload(job) {
  const payload = job.payload
  // Jobs persisted before the trigger was updated already have their proof payload.
  if (job.entity_type !== 'BATCH' || payload?.format !== 'batch_version_v1') return payload

  const snapshot = payload.snapshot
  if (job.event_type === 'BATCH_CORRECTED') {
    return { batch: snapshot, correctionReason: payload.correction_reason, correctedBy: payload.corrected_by }
  }
  if (job.event_type !== 'BATCH_CREATED') throw new Error('Loại sự kiện không khớp snapshot vụ nuôi')

  return {
    batchId: job.batch_id,
    farmId: payload.farm_id,
    pondId: snapshot.pond_id,
    batchCode: snapshot.batch_code,
    species: snapshot.species,
    seedSource: snapshot.seed_source ?? null,
    seedQuantity: snapshot.seed_quantity,
    stockingDate: new Date(snapshot.stocking_date).toISOString(),
    expectedHarvestDate: snapshot.expected_harvest_date ? new Date(snapshot.expected_harvest_date).toISOString() : null,
    status: snapshot.status,
    note: snapshot.note ?? null,
  }
}

function createBlockchainOutbox(db, blockchain, { intervalMs = 15000, logger = console } = {}) {
  let timer = null,
    running = false,
    stopped = false
  const rpc = async (name, args) => {
    const { data, error } = await db.rpc(name, args).abortSignal(AbortSignal.timeout(10000))
    if (error) throw error
    return data
  }
  async function processJob(job) {
    let status = 'FAILED',
      message = null,
      result = null
    try {
      result = await blockchain.createRecord({
        batchId: job.batch_id,
        entityId: job.entity_id,
        entityType: job.entity_type,
        eventType: job.event_type,
        eventId: job.event_id,
        payload: proofPayload(job),
      })
      status = result.record.status
      message = status === 'SUCCESS' ? null : result.error || 'Chưa xác nhận Blockchain; hệ thống sẽ tự thử lại'
    } catch (error) {
      message = error.message || 'Không xử lý được bằng chứng Blockchain'
    }
    const saved = await rpc('finish_blockchain_outbox', {
      p_event: job.event_id,
      p_token: job.lease_token,
      p_status: status,
      p_error: message,
      p_delay: retryDelaySeconds(job.attempt_count + 1),
    })
    if (!saved) throw new Error('Lease outbox đã hết hạn hoặc chuyển sang worker khác')
    return result
  }
  async function deliver(eventId) {
    const jobs = await rpc('claim_blockchain_outbox', { p_event: eventId })
    return jobs?.length ? processJob(jobs[0]) : null
  }
  async function processBatch() {
    if (running || stopped) return
    running = true
    try {
      for (let i = 0; i < 20 && !stopped; i++) {
        const jobs = await rpc('claim_blockchain_outbox', { p_event: null })
        if (!jobs?.length) break
        await processJob(jobs[0])
      }
    } catch (error) {
      logger.error('Không xử lý được outbox Blockchain:', error.message)
    } finally {
      running = false
    }
  }
  function start() {
    if (timer) return
    stopped = false
    timer = setInterval(() => {
      void processBatch()
    }, intervalMs)
    timer.unref?.()
    void processBatch()
  }
  function stop() {
    stopped = true
    clearInterval(timer)
    timer = null
  }
  return { start, stop, processBatch, deliver, processJob }
}

let singleton
const instance = () =>
  (singleton ||= createBlockchainOutbox(require('../../config/supabase'), require('./blockchain.service')))
module.exports = {
  createBlockchainOutbox,
  retryDelaySeconds,
  start: (...args) => instance().start(...args),
  stop: (...args) => instance().stop(...args),
  deliver: (...args) => instance().deliver(...args),
  processBatch: (...args) => instance().processBatch(...args),
}
