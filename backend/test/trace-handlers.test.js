const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createTraceHandlers } = require('../src/modules/trace/trace.handlers')
const { createTraceService } = require('../src/modules/trace/trace.service')

test('handler returns flat QR capabilities with no-store and trusts authenticated actor', async () => {
  let received
  const result = { qr: { trace_code: 'stable', status: 'ACTIVE' }, canIssue: false, canRevoke: true }
  const handlers = createTraceHandlers({ issueReceiving: async (...args) => { received = args; return result } })
  const profile = { id: 'session-actor' }, params = { transportId: 'trip' }, body = { actor: 'forged' }
  const response = { headers: {}, set(key, value) { this.headers[key] = value; return this }, json(value) { this.body = value } }
  await handlers.issueReceiving({ auth: { profile }, params, body }, response, error => { throw error })
  assert.deepEqual(received, [profile, params, body])
  assert.deepEqual(response.body, { success: true, ...result })
  assert.equal(response.headers['Cache-Control'], 'no-store')
})
test('old issuance handler passes 403 to error middleware without writing', async () => {
  const service = createTraceService({ issue: async () => { throw new Error('unsafe write') } }, {})
  let failure
  await createTraceHandlers(service).issue({ auth: { profile: { role: 'FARMER' } }, params: {}, body: {} }, {}, error => { failure = error })
  assert.equal(failure.status, 403)
})
