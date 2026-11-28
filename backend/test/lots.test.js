const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createClient } = require('@supabase/supabase-js')
const { aggregate, createLotsService } = require('../src/modules/lots/lots.service')
const { createLotsRepository } = require('../src/modules/lots/lots.repository')
const { filters, dateBounds, searchPattern } = require('../src/modules/lots/lots.validation')
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const farmer = { id: id(1), role: 'FARMER' }
function harvest(n, quantity, timestamp, species = 'SHRIMP', snapshot = true) {
  return { id: id(n), quantity, harvest_date: timestamp,
    batch: { id: id(20), species: 'CRAB', pond: { id: id(30), pond_name: 'Ao hiện tại', farm: { id: id(40), farm_name: 'Tên mới' } } },
    lots: snapshot ? { provenance: { batch: { species }, farm: { name: 'Cơ sở lúc thu' }, pond: { name: 'Ao lúc thu' } } } : null }
}
function database(fetcher) {
  return createClient('https://example.supabase.co', 'test-key', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetcher } })
}
test('partial harvests add exactly once; month uses Vietnam day; immutable snapshot wins over edited batch', () => {
  const data = [harvest(2, '0.10', '2026-10-31T17:00:00Z'), harvest(3, '0.20', '2026-11-15T01:00:00Z'), harvest(4, '2.35', '2026-10-31T16:59:59Z', 'CRAB', false)]
  const result = aggregate(data, {})
  assert.deepEqual(result.summary, { quantity: 2.65, harvestCount: 3, batchCount: 1, farmCount: 1 })
  assert.deepEqual(result.byMonth, [{ month: '2026-10', quantity: 2.35, harvestCount: 1 }, { month: '2026-11', quantity: 0.3, harvestCount: 2 }])
  assert.equal(aggregate(data, { species: 'SHRIMP' }).summary.quantity, 0.3)
  assert.equal(aggregate(data, { species: 'CRAB' }).summary.quantity, 2.35)
  assert.equal(result.byFarm[0].farmName, 'Cơ sở lúc thu')
  assert.deepEqual(aggregate([], {}).summary, { quantity: 0, harvestCount: 0, batchCount: 0, farmCount: 0 })
})
test('invalid dates, reversed ranges, unsupported species and bad pagination fail before querying', () => {
  for (const input of [{ from: '2026-02-30' }, { from: '2026-11-22', to: '2026-11-01' }, { species: 'FISH' }, { farmId: 'other' }, { page: 0 }, { pageSize: 101 }, { search: ['x'] }]) {
    assert.throws(() => filters(input, { paginated: true }), { status: 400 })
  }
  assert.deepEqual(dateBounds(filters({ from: '2026-11-01', to: '2026-11-01' })), { from: '2026-11-01T00:00:00+07:00', until: '2026-11-01T17:00:00.000Z' })
})
test('non-managers cannot enumerate lots, statistics, options or reports', async () => {
  const service = createLotsService(new Proxy({}, { get() { throw new Error('Repository must not be reached') } }), {})
  for (const role of ['DISTRIBUTOR', 'TRANSPORTER', undefined]) {
    for (const action of ['list', 'production', 'options', 'report']) await assert.rejects(service[action]({ role }, {}), { status: 403 })
  }
})
test('a missing or foreign lot cannot reach dossier or history; scoped authorization happens first', async () => {
  let reads = 0
  const service = createLotsService({ find: async (profile, lotId) => { reads++; assert.equal(profile, farmer); assert.equal(lotId, id(2)); return null } }, new Proxy({}, { get() { throw new Error('Private report leaked') } }))
  await assert.rejects(service.report(farmer, id(2)), { status: 404 })
  await assert.rejects(service.report(farmer, 'bad-id'), { status: 404 })
  assert.equal(reads, 1)
})
test('real PostgREST URL includes current actor scope, inner joins, inclusive VN day and escaped search literal', async () => {
  const urls = []
  const db = database(async url => { urls.push(new URL(url)); return new Response('[]', { status: 200, headers: { 'content-type': 'application/json', 'content-range': '*/0' } }) })
  const repo = createLotsRepository(db)
  const input = filters({ search: 'a%,status.eq.COMPLETED', from: '2026-11-01', to: '2026-11-01', farmId: id(4) }, { paginated: true })
  await repo.page(farmer, input)
  const query = urls[0].searchParams
  assert.equal(query.get('p_actor'), farmer.id)
  assert.equal(query.get('batch.pond.farm_id'), `eq.${id(4)}`)
  assert.match(query.get('select'), /farms!inner/)
  assert.match(query.get('select'), /blockchain_event_id/)
  assert.deepEqual(query.getAll('harvest.harvest_date'), ['gte.2026-11-01T00:00:00+07:00', 'lt.2026-11-01T17:00:00.000Z'])
  assert.ok(query.get('or').includes(`lot_code.imatch.${searchPattern(input.search)}`))
  await repo.page({ id: id(7), role: 'ADMIN' }, filters({}, { paginated: true }))
  assert.equal(urls[1].searchParams.get('p_actor'), id(7))
  assert.ok(urls.every(url => url.pathname.endsWith('/rpc/production_lots')))
})

test('literal search survives PostgREST decoding without regex or wildcard injection', () => {
  for (const input of ['%', '_', '*', '\\', '"', 'a%,status.eq.COMPLETED', 'x(y),z', '[a-z]+', '.*', '^$', 'Tôm']) {
    // PostgREST removes one level of backslash escaping from quoted values.
    const decoded = searchPattern(input).slice(1, -1).replace(/\\(.)/gs, '$1')
    const matcher = new RegExp(decoded, 'i')
    assert.ok(matcher.test(`prefix ${input} suffix`), input)
    assert.equal(matcher.test('unrelated text'), false, input)
  }
})
test('statistics read all database pages rather than stopping at the server row limit', async () => {
  const fixture = Array.from({ length: 1003 }, (_, index) => harvest(index + 100, '1.25', '2026-11-01'))
  const offsets = []
  const repo = createLotsRepository(database(async url => {
    const query = new URL(url).searchParams
    const offset = Number(query.get('offset') ?? 0); const limit = Number(query.get('limit'))
    offsets.push(offset)
    assert.equal(query.get('p_actor'), farmer.id)
    assert.ok(new URL(url).pathname.endsWith('/rpc/production_harvests'))
    return new Response(JSON.stringify(fixture.slice(offset, offset + limit)), { headers: { 'content-type': 'application/json' } })
  }))
  const result = await createLotsService(repo, {}).production(farmer, {})
  assert.deepEqual(offsets, [0, 500, 1000])
  assert.equal(result.summary.quantity, 1253.75)
  assert.equal(result.summary.harvestCount, 1003)
})

test('statistics accept exactly 20000 rows and reject a sentinel row instead of returning truncated totals', async () => {
  for (const length of [20000, 20001]) {
    const fixture = Array.from({ length }, (_, index) => harvest(index + 100, '0.01', '2026-11-01'))
    const repo = createLotsRepository(database(async url => {
      const query = new URL(url).searchParams
      const offset = Number(query.get('offset') ?? 0)
      const limit = Number(query.get('limit'))
      return new Response(JSON.stringify(fixture.slice(offset, offset + limit)), { headers: { 'content-type': 'application/json' } })
    }))
    const result = createLotsService(repo, {}).production(farmer, {})
    if (length === 20000) {
      assert.equal((await result).summary.quantity, 200)
    } else {
      await assert.rejects(result, { status: 422 })
    }
  }
})
test('list projects one-to-one QR and snapshot while omitting internal provenance and owner IDs', async () => {
  const item = { id: id(2), batch_id: id(20), lot_code: 'LO-1', quantity: '12.50', status: 'CREATED', batch: { id: id(20), pond: { id: id(30), farm: { id: id(40) } } },
    provenance: { private: 'SECRET', harvest: { harvest_date: '2026-11-01' }, batch: { batch_code: 'VU-1', species: 'SHRIMP' }, farm: { name: 'Farm' }, pond: { name: 'Pond', code: 'AO-1' } }, qr: { trace_code: id(50), status: 'ACTIVE' } }
  const service = createLotsService({ page: async () => ({ items: [item], count: 1 }) }, {})
  const result = await service.list(farmer, {})
  assert.equal(result.items[0].qr.traceCode, id(50))
  assert.equal(result.items[0].quantity, 12.5)
  assert.doesNotMatch(JSON.stringify(result), /SECRET|provenance|owner_id/)
})
test('private report can be generated before QR publication and preserves the proof result', async () => {
  const lot = { batch_id: id(20), qr: null }
  const proof = { status: 'UNAVAILABLE' }
  const service = createLotsService({ find: async () => lot, history: async () => [] }, { dossier: async input => { assert.equal(input, lot); return { proof } } })
  const result = await service.report(farmer, id(2))
  assert.equal(result.trace.proof.status, 'UNAVAILABLE')
  assert.equal(result.qrStatus, null)
  assert.ok(Number.isFinite(new Date(result.generatedAt).getTime()))
})
