const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createTraceService } = require('../src/modules/trace/trace.service')
const lotId = '00000000-0000-4000-8000-000000000001'
const traceCode = '00000000-0000-4000-8000-000000000002'
function setup(findQr) {
  const repo = {
    findQr: findQr ?? (async () => ({ lot_id: lotId, status: 'ACTIVE', issued_by: 'PRIVATE' })),
    findLot: async () => ({ id: lotId, batch_id: 'batch', lot_code: 'LOT-A', quantity: 10, provenance: {
      harvest: { harvest_date: '2026-11-08T00:00:00+07:00' }, farm: { name: 'Farm A', address: 'Address' },
      pond: { code: 'P1', name: 'Pond 1' }, batch: { species: 'SHRIMP', batch_code: 'B1', seed_source: 'Seed', stocking_date: '2026-01-01' },
    } }),
    logs: async () => [], transports: async () => [], proof: async () => null,
  }
  return createTraceService(repo, {})
}
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
