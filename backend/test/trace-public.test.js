const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createTraceService } = require('../src/modules/trace/trace.service')
const { createPublicRouter } = require('../src/modules/trace/trace.public-routes')
const express = require('express')
const { once } = require('node:events')
const lotId = '00000000-0000-4000-8000-000000000001'
const traceCode = '00000000-0000-4000-8000-000000000002'
function setup(findQr, overrides = {}, chain = {}) {
  const repo = {
    findQr: findQr ?? (async () => ({ lot_id: lotId, status: 'ACTIVE', issued_by: 'PRIVATE' })),
    findLot: async () => ({ id: lotId, batch_id: 'batch', lot_code: 'LOT-A', quantity: 10, provenance: {
      harvest: { harvest_date: '2026-11-08T00:00:00+07:00' }, farm: { name: 'Farm A', address: 'Address' },
      pond: { code: 'P1', name: 'Pond 1' }, batch: { species: 'SHRIMP', batch_code: 'B1', seed_source: 'Seed', stocking_date: '2026-01-01' },
    } }),
    logs: async () => [], transports: async () => [], proof: async () => null,
    ...overrides,
  }
  return createTraceService(repo, chain)
}
test('public packaging distinguishes a match, a difference, a queued write and an unavailable check', async () => {
  for (const [recorded, onChain, expected] of [
    ['SUCCESS', 'expected', 'MATCH'],
    ['SUCCESS', 'different', 'MISMATCH'],
    ['PENDING', null, 'PENDING'],
    ['SUCCESS', null, 'UNAVAILABLE'],
  ]) {
    const transport = 'transport-a'
    const service = setup(async () => ({ lot_id: lotId, status: 'ACTIVE', issuance_transport_id: transport }), {
      packaging: async (id, trip) => {
        assert.equal(id, lotId)
        assert.equal(trip, transport)
        return [{
          snapshot: { specification: 'Túi 500 g' }, eventId: 'packaging-proof',
          record: { status: recorded, data_hash: 'expected', contract_address: 'contract', chain_id: 31337, transaction_hash: 'hidden' },
        }]
      },
    }, { hash: () => 'expected', read: async () => onChain })
    const { trace } = await service.publicTrace(traceCode)
    assert.equal(trace.packaging[0].verificationStatus, expected)
    assert.equal(Object.hasOwn(trace.packaging[0], 'transactionHash'), false)
    assert.equal(Object.hasOwn(trace.proof, 'transactionHash'), false)
  }
})
test('public trace stays readable without identity and does not expose publisher actor or capabilities', async () => {
  const value = await setup().publicTrace(traceCode)
  assert.equal(value.status, 'ACTIVE')
  assert.equal(value.trace.lotCode, 'LOT-A')
  assert.equal(value.trace.farm.name, 'Farm A')
  assert.equal(value.trace.proof.status, 'PENDING')
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE|issued_by|canIssue|canRevoke/)
})
test('revoked legacy or distributor QR never returns a dossier', async () => {
  assert.deepEqual(await setup(async () => ({ lot_id: lotId, status: 'REVOKED' })).publicTrace(traceCode), { status: 'REVOKED' })
})
test('revocation during trace assembly prevents returning an active dossier', async () => {
  let reads = 0
  const service = setup(async () => ({ lot_id: lotId, status: ++reads === 1 ? 'ACTIVE' : 'REVOKED' }))
  assert.deepEqual(await service.publicTrace(traceCode), { status: 'REVOKED' })
})

async function withPublicRouter(service, run) {
  const app = express()
  app.use('/api/public/trace', createPublicRouter(service))
  const server = app.listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    await run(`http://127.0.0.1:${server.address().port}/api/public/trace`)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
}

test('public report endpoint needs no login, disables caching and adds a generation timestamp', async () => {
  await withPublicRouter(setup(), async base => {
    const response = await fetch(`${base}/${traceCode}/report`)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const body = await response.json()
    assert.equal(body.success, true)
    assert.equal(body.trace.lotCode, 'LOT-A')
    assert.ok(Number.isFinite(new Date(body.generatedAt).getTime()))
    assert.doesNotMatch(JSON.stringify(body), /PRIVATE|issued_by|canIssue|canRevoke/)
  })
})

test('public report endpoint never includes a dossier after QR revocation', async () => {
  let reads = 0
  await withPublicRouter(setup(async () => ({ lot_id: lotId, status: ++reads === 1 ? 'ACTIVE' : 'REVOKED' })), async base => {
    const response = await fetch(`${base}/${traceCode}/report`)
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(body.status, 'REVOKED')
    assert.equal(body.trace, undefined)
    assert.ok(body.generatedAt)
  })
})

test('public report endpoint hides internal errors and returns safe status codes', async () => {
  for (const status of [404, 503, 500]) {
    await withPublicRouter({ publicTrace: async () => { throw Object.assign(new Error('PRIVATE DATABASE DETAIL'), { status }) } }, async base => {
      const response = await fetch(`${base}/${traceCode}/report`)
      assert.equal(response.status, status === 404 ? 404 : 503)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      const body = await response.json()
      assert.equal(body.success, false)
      assert.equal(body.trace, undefined)
      assert.doesNotMatch(JSON.stringify(body), /PRIVATE DATABASE DETAIL/)
    })
  }
})
