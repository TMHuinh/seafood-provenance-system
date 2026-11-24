const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createBlockchainOutbox, retryDelaySeconds } = require('../src/modules/blockchain/blockchain.outbox')

function fixture() {
  const job = {
    event_id: 'HARVEST_RECORDED:1',
    batch_id: 'batch',
    entity_id: 'harvest',
    entity_type: 'HARVEST',
    event_type: 'HARVEST_RECORDED',
    payload: { immutable: 'snapshot' },
    lease_token: 'lease-1',
    attempt_count: 0,
  }
  let leased = false,
    due = true,
    status = 'PENDING'
  const finishes = []
  const db = {
    rpc(name, args) {
      return {
        abortSignal: async () => {
          if (name === 'claim_blockchain_outbox') {
            if (leased || !due || status === 'SUCCESS') return { data: [] }
            leased = true
            return { data: [{ ...job }] }
          }
          assert.equal(name, 'finish_blockchain_outbox')
          assert.equal(args.p_token, job.lease_token)
          finishes.push(args)
          status = args.p_status
          job.attempt_count++
          due = false
          leased = false
          return { data: true }
        },
      }
    },
  }
  return {
    db,
    job,
    finishes,
    retry() {
      due = true
    },
    status: () => status,
  }
}

test('worker retries the stored snapshot after failure and stops submitting after success', async () => {
  const f = fixture(),
    calls = []
  const worker = createBlockchainOutbox(f.db, {
    createRecord: async (input) => {
      calls.push(input)
      if (calls.length === 1) throw new Error('RPC unavailable')
      return { record: { status: 'SUCCESS' } }
    },
  })
  await worker.processBatch()
  assert.equal(f.status(), 'FAILED')
  assert.equal(f.finishes[0].p_delay, 120)
  assert.equal(f.finishes[0].p_error, 'RPC unavailable')
  await worker.processBatch()
  assert.equal(calls.length, 1)
  f.retry()
  await worker.processBatch()
  assert.equal(f.status(), 'SUCCESS')
  assert.deepEqual(calls[0], calls[1])
  assert.equal(f.finishes[1].p_error, null)
  f.retry()
  await worker.processBatch()
  assert.equal(calls.length, 2)
})

test('separate workers cannot process a claimed event concurrently', async () => {
  const f = fixture()
  let release,
    calls = 0
  const blockchain = {
    createRecord: async () => {
      calls++
      await new Promise((resolve) => {
        release = resolve
      })
      return { record: { status: 'SUCCESS' } }
    },
  }
  const one = createBlockchainOutbox(f.db, blockchain),
    two = createBlockchainOutbox(f.db, blockchain)
  const active = one.deliver(f.job.event_id)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(await two.deliver(f.job.event_id), null)
  release()
  await active
  assert.equal(calls, 1)
})

test('a stale lease cannot finalize an event and backoff is bounded', async () => {
  const worker = createBlockchainOutbox(
    { rpc: () => ({ abortSignal: async () => ({ data: false }) }) },
    { createRecord: async () => ({ record: { status: 'SUCCESS' } }) },
  )
  await assert.rejects(worker.processJob(fixture().job), /Lease/)
  assert.equal(retryDelaySeconds(1), 120)
  assert.equal(retryDelaySeconds(100), 3600)
})

test('worker builds the same batch proofs from stored snapshots and legacy payloads', async () => {
  const f = fixture()
  const worker = createBlockchainOutbox(f.db, { createRecord: async ({ payload }) => ({ record: { status: 'SUCCESS' }, payload }) })
  const snapshot = {
    pond_id: 'pond', batch_code: 'VU-1', species: 'SHRIMP', seed_source: null, seed_quantity: 100,
    stocking_date: '2026-01-01T00:00:00.123456+07:00', expected_harvest_date: null, status: 'GROWING', note: null,
  }
  const created = {
    batchId: 'batch', farmId: 'farm', pondId: 'pond', batchCode: 'VU-1', species: 'SHRIMP', seedSource: null,
    seedQuantity: 100, stockingDate: '2025-12-31T17:00:00.123Z', expectedHarvestDate: null, status: 'GROWING', note: null,
  }
  const corrected = { batch: snapshot, correctionReason: 'Cập nhật ghi chú', correctedBy: 'farmer' }
  for (const [eventType, expected] of [['BATCH_CREATED', created], ['BATCH_CORRECTED', corrected]]) {
    const job = { ...f.job, entity_type: 'BATCH', event_type: eventType }
    const queuedSnapshot = {
      format: 'batch_version_v1', snapshot, farm_id: 'farm', correction_reason: 'Cập nhật ghi chú', corrected_by: 'farmer',
    }
    const legacyJob = await worker.processJob({ ...job, payload: expected })
    const snapshotJob = await worker.processJob({ ...job, payload: queuedSnapshot })
    assert.deepEqual(snapshotJob.payload, legacyJob.payload)
    assert.deepEqual(snapshotJob.payload, expected)
  }
})
