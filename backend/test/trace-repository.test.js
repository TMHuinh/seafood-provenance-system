const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createTraceRepository } = require('../src/modules/trace/trace.repository')

test('shipment lookup applies the lot and QR shipment scopes before fetching events', async () => {
  const calls = []
  const query = {
    select: () => query,
    eq: (key, value) => { calls.push([key, value]); return query },
    order: () => query,
    limit: () => query,
    abortSignal: async () => ({ data: [] }),
  }
  const repo = createTraceRepository({ from: table => { calls.push(table); return query } })
  assert.deepEqual(await repo.transports('lot', 'shipment'), [])
  assert.deepEqual(calls, ['transport_logs', ['harvest_lot_id', 'lot'], ['id', 'shipment']])
})
