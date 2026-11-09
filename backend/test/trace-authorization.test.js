const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createTraceService } = require('../src/modules/trace/trace.service')
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const scope = { farmId: id(1), pondId: id(2), id: id(3), lotId: id(4) }
const farmer = { id: id(5), role: 'FARMER', status: true }
const distributor = { id: id(6), role: 'DISTRIBUTOR', organization_id: id(7), status: true }
const qr = { lot_id: id(4), trace_code: id(8), status: 'ACTIVE', issuer_organization_id: id(7), issuer: { name: 'Nhà phân phối A' } }
function setup(overrides = {}) {
  const calls = []
  const service = createTraceService({
    ownedLot: async () => ({ id: scope.lotId }),
    findQrByLot: async () => qr,
    issue: async () => { calls.push('unsafe issue'); return qr },
    revoke: async () => { calls.push('unsafe revoke'); return qr },
    receivingQr: async (...args) => { calls.push(args); return { qr, canIssue: false, canRevoke: true } },
    revokeLegacy: async (...args) => { calls.push(args); return { ...qr, issuer_organization_id: null, status: 'REVOKED' } },
    ...overrides,
  }, {})
  return { service, calls }
}
for (const role of ['FARMER', 'ADMIN', 'TRANSPORTER', 'DISTRIBUTOR']) {
  test(`old issuance endpoint denies ${role} even when farm is owned`, async () => {
    const { service, calls } = setup()
    await assert.rejects(service.issue({ ...farmer, role }, scope), { status: 403 })
    assert.deepEqual(calls, [])
  })
}
test('farm owner sees issued QR with read-only capabilities', async () => {
  const { service } = setup()
  assert.deepEqual(await service.get(farmer, scope), { qr, canIssue: false, canRevoke: false })
})
test('farm owner can revoke only legacy QR and reason is trimmed', async () => {
  const legacy = { ...qr, issuer_organization_id: null }
  const { service, calls } = setup({ findQrByLot: async () => legacy })
  assert.equal((await service.get(farmer, scope)).canRevoke, true)
  const result = await service.revoke(farmer, scope, { reason: '  Sai thông tin  ' })
  assert.equal(result.qr.status, 'REVOKED')
  assert.deepEqual(calls, [[farmer.id, scope.lotId, 'Sai thông tin']])
  await assert.rejects(setup().service.revoke(farmer, scope, { reason: 'Thu hồi' }), { status: 403 })
})
test('wrong farm scope and malformed UUID are hidden', async () => {
  const { service } = setup({ ownedLot: async () => null })
  await assert.rejects(service.get(farmer, scope), { status: 404 })
  await assert.rejects(service.get(farmer, { ...scope, lotId: 'bad' }), { status: 404 })
})
for (const profile of [farmer, { ...distributor, role: 'ADMIN' }, { ...distributor, role: 'TRANSPORTER' }, { ...distributor, organization_id: null }, { ...distributor, status: false }]) {
  test(`receiving QR denies ineligible profile ${JSON.stringify(profile)}`, async () => {
    const { service, calls } = setup()
    for (const method of ['getReceiving', 'issueReceiving', 'revokeReceiving']) {
      await assert.rejects(service[method](profile, { transportId: id(9) }, { reason: 'Thu hồi' }), { status: 403 })
    }
    assert.deepEqual(calls, [])
  })
}
test('receiving operations derive actor from session and use atomic RPC boundary', async () => {
  const { service, calls } = setup()
  for (const [method, action] of [['getReceiving', 'GET'], ['issueReceiving', 'ISSUE'], ['revokeReceiving', 'REVOKE']]) {
    const result = await service[method](distributor, { transportId: id(9) }, { actor: id(99), reason: '  Lỗi nguồn gốc  ' })
    assert.equal(result.qr.trace_code, id(8))
    assert.deepEqual(calls.at(-1), [distributor.id, id(9), action, action === 'REVOKE' ? 'Lỗi nguồn gốc' : null])
  }
})
test('receiving validates transport and revoke reason before write', async () => {
  const { service, calls } = setup()
  await assert.rejects(service.issueReceiving(distributor, { transportId: 'not-a-uuid' }), { status: 404 })
  for (const reason of [null, '', 'ab', ' '.repeat(4), 'x'.repeat(501)]) {
    await assert.rejects(service.revokeReceiving(distributor, { transportId: id(9) }, { reason }), { status: 400 })
  }
  assert.deepEqual(calls, [])
})
