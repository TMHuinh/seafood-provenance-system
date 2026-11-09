const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createTraceRepository } = require('../src/modules/trace/trace.repository')

test('received QR query carries only server actor, transport, action and reason', async () => {
  let request
  const expected = { qr: { trace_code: 'stable' }, canIssue: false, canRevoke: true }
  const repo = createTraceRepository({ rpc(name, args) {
    request = { name, args }
    return { abortSignal: async () => ({ data: expected, error: null }) }
  } })
  assert.deepEqual(await repo.receivingQr('actor', 'transport', 'ISSUE', null), expected)
  assert.deepEqual(request, { name: 'manage_received_lot_qr', args: {
    p_actor: 'actor', p_transport: 'transport', p_action: 'ISSUE', p_reason: null,
  } })
  await repo.revokeLegacy('owner', 'lot', 'Sai thông tin')
  assert.deepEqual(request, { name: 'revoke_legacy_lot_qr', args: { p_actor: 'owner', p_lot: 'lot', p_reason: 'Sai thông tin' } })
})
for (const [code, status] of [['42501', 403], ['P0002', 404], ['40001', 409], ['22023', 400], ['PGRST202', 503], ['42883', 503]]) {
  test(`RPC ${code} returns safe status ${status} without database detail`, async () => {
    const repo = createTraceRepository({ rpc: () => ({ abortSignal: async () => ({ error: { code, message: 'PRIVATE SQL DETAILS' } }) }) })
    await assert.rejects(repo.receivingQr('actor', 'transport', 'GET', null), error => {
      assert.equal(error.status, status)
      assert.doesNotMatch(error.message, /PRIVATE/)
      return true
    })
  })
}
