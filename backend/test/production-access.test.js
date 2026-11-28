const { test } = require('node:test')
const assert = require('node:assert/strict')
const { once } = require('node:events')
const { createClient } = require('@supabase/supabase-js')
const { requirePondAction } = require('../src/modules/ponds/pond-access')

test('each action checks current DB grants even for an actor with an unexpired admin session', async () => {
  const calls = []
  const permissions = new Set(['READ', 'LOG_CREATE'])
  const db = { rpc: async (name, args) => {
    calls.push(args.p_actor)
    assert.equal(name, 'pond_can')
    return { data: permissions.has(args.p_action) && args.p_pond === 'pond-a' }
  } }
  const actor = { id: 'member', role: 'ADMIN', organization_id: 'farm' }
  await requirePondAction(actor, 'pond-a', 'LOG_CREATE', { db })
  await assert.rejects(requirePondAction(actor, 'pond-a', 'LOG_CONFIRM', { db }), { status: 404 })
  await assert.rejects(requirePondAction(actor, 'pond-b', 'READ', { db }), { status: 404 })
  permissions.clear()
  await assert.rejects(requirePondAction(actor, 'pond-a', 'READ', { db }), { status: 404 })
  assert.deepEqual(calls, Array(4).fill(actor.id))
})

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

test('production API binds nested IDs to their parents and rechecks the same session after revocation', async () => {
  const actor = id(1)
  const farmA = id(2), farmB = id(3), pondA = id(4), pondB = id(5)
  const batchA = id(6), batchB = id(7), logB = id(8), newPond = id(9), draftId = id(11)
  const farms = [{ id: farmA, can_manage: true }, { id: farmB, can_manage: false }]
  const ponds = [{ id: pondA, farm_id: farmA }, { id: pondB, farm_id: farmB }]
  const batches = [
    { id: batchA, pond_id: pondA, pond: {
      id: pondA, farm_id: farmA, pond_name: 'Pond', status: 'ACTIVE',
      farm: {
        id: farmA, farm_name: 'Farm', owner_id: id(30), address: 'PRIVATE_FARM_ADDRESS',
        organization: { id: id(31), name: 'Household', type: 'FARMER_HOUSEHOLD', tax_code: 'PRIVATE_TAX', email: 'PRIVATE_CONTACT' },
      },
    } },
    { id: batchB, pond_id: pondB },
  ]
  const permissions = new Map([[pondA, ['READ', 'MANAGE', 'LOG_CREATE']], [newPond, ['READ', 'MANAGE']]])
  let harvestDraft
  const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
  const db = createClient('https://example.supabase.co', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input)
      const field = key => url.searchParams.get(key)?.slice(3)
      const matches = (row, key) => !field(key) || row[key] === field(key)
      const singular = new Headers(init?.headers).get('accept')?.includes('pgrst.object')
      const rows = items => json(singular ? items[0] : items)
      const body = () => JSON.parse(init.body)
      if (url.pathname === '/auth/v1/user') return json({ id: actor, aud: 'authenticated', role: 'authenticated', email: 'fixture@example.test' })
      switch (url.pathname.slice('/rest/v1/'.length)) {
        case 'user_profiles': return json({ id: actor, role: 'FARMER', status: true })
        case 'rpc/farm_can_manage': return json(body().p_farm === farmA)
        case 'rpc/farm_org_can_create': return json(false)
        case 'rpc/pond_can': {
          const { p_actor, p_pond, p_action } = body()
          return json(p_actor === actor && !!permissions.get(p_pond)?.includes(p_action))
        }
        case 'rpc/production_farms': return rows(farms.filter(farm => farm.can_manage && matches(farm, 'id')))
        case 'rpc/production_ponds': return rows(ponds.filter(pond =>
          permissions.get(pond.id)?.includes('READ') && matches(pond, 'farm_id') && matches(pond, 'id'))
          .map(pond => ({ ...pond, permissions: permissions.get(pond.id) })))
        case 'farms': {
          assert.ok(['POST', 'PATCH'].includes(init.method))
          return rows([{ id: farmA, ...body() }])
        }
        case 'ponds': {
          if (init.method === 'POST') {
            const pond = { id: newPond, ...body() }
            ponds.push(pond)
            return rows([pond])
          }
          if (init.method === 'PATCH') {
            const pond = ponds.find(item => matches(item, 'id') && matches(item, 'farm_id'))
            return rows(pond ? [Object.assign(pond, body())] : [])
          }
          return rows(ponds.filter(pond => matches(pond, 'id') && matches(pond, 'farm_id')))
        }
        case 'batches': return rows(batches.filter(batch => matches(batch, 'id') && matches(batch, 'pond_id')))
        case 'rpc/create_farming_log_draft': {
          const { p_actor, p_batch, p_details } = body()
          return json({ id: id(10), created_by: p_actor, batch_id: p_batch, details: p_details, author_name: 'Minh', confirmer_name: null })
        }
        case 'farming_logs': {
          return rows([{ id: logB, batch_id: batchB }].filter(log => matches(log, 'id') && matches(log, 'batch_id')))
        }
        case 'audit_logs': return json([])
        case 'blockchain_records': return json([])
        case 'harvests':
        case 'transport_logs':
        case 'distribution_logs': return json([])
        case 'harvest_lots': return rows([{ id: id(12), batch_id: batchA, quantity: 12 }]
          .filter(lot => field('id') && matches(lot, 'id') && matches(lot, 'batch_id')))
        case 'rpc/harvest_actor_names': return json([])
        case 'harvest_drafts': return json(harvestDraft ? [harvestDraft] : [])
        case 'rpc/create_harvest_draft':
        case 'rpc/edit_harvest_draft': {
          const args = body()
          harvestDraft = { id: args.p_request ?? args.p_draft, version: (args.p_version ?? 0) + 1, quantity: args.p_quantity }
          return json(harvestDraft)
        }
        case 'rpc/confirm_harvest_draft': {
          const args = body()
          if (args.p_draft !== draftId || args.p_version !== harvestDraft.version) {
            return new Response(JSON.stringify({ code: 'P0002' }), { status: 404, headers: { 'content-type': 'application/json' } })
          }
          harvestDraft = undefined
          return json({ replayed: true, harvest: { id: id(12), created_by: actor }, lot: { blockchain_event_id: 'fixture', provenance: {} } })
        }
        default: assert.fail(`Unexpected fixture request ${init.method} ${url.pathname}`)
      }
    } },
  })
  const modulePath = require.resolve('../src/config/supabase')
  require.cache[modulePath] = { exports: db }
  Object.assign(process.env, { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'test-key', SUPABASE_ANON_KEY: 'test-key' })
  const app = require('../src/app')
  const server = app.listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const base = `http://127.0.0.1:${server.address().port}/api`
    const request = async (path, status, method = 'GET', payload) => {
      const response = await fetch(base + path, {
        method, headers: { authorization: 'Bearer same-valid-session', 'content-type': 'application/json' },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      })
      const result = await response.json()
      assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(result)}`)
      return result
    }
    const farm = `/farms/${farmA}`
    const pond = `${farm}/ponds/${pondA}`
    const wrongFarm = `/farms/${farmB}/ponds/${pondA}`
    const wrongPond = `${farm}/ponds/${pondB}`
    assert.equal((await request(pond, 200)).pond.id, pondA)
    assert.deepEqual((await request(`${farm}/ponds`, 200)).items.map(item => item.id), [pondA])
    assert.equal((await request('/farms', 200)).can_create, true)
    assert.equal((await request('/farms', 201, 'POST', { farmName: 'New' })).farm.can_manage, true)
    await request('/farms', 403, 'POST', { farmName: 'New', organizationId: farmB, role: 'ADMIN' })
    await request(wrongPond, 404)
    assert.deepEqual(await request(`${wrongFarm}/batches`, 404), await request(`${wrongPond}/batches`, 404))
    await request(`${pond}/batches/${batchB}/history`, 404)
    assert.deepEqual(await request(`/batches/${batchB}`, 404), await request(`/batches/${id(100)}`, 404))
    const readableBatch = await request(`/batches/${batchA}`, 200)
    assert.deepEqual(readableBatch.batch.pond.farm, {
      id: farmA, farm_name: 'Farm', organization: { id: id(31), name: 'Household', type: 'FARMER_HOUSEHOLD' },
    })
    batches[0].pond.farm.owner_id = actor
    assert.equal((await request(`/batches/${batchA}`, 200)).batch.pond.farm.address, 'PRIVATE_FARM_ADDRESS')
    batches[0].pond.farm.owner_id = id(30)
    await request(`${pond}/batches/${batchB}/harvests`, 404)
    assert.equal((await request(`${pond}/batches/${batchA}/harvests`, 200)).can_create_transport, false)
    await request(`${pond}/batches/${batchA}/lots/${id(12)}/transports`, 404, 'POST', {})
    await request(`${pond}/batches/${batchA}/harvests`, 404, 'POST', {})
    assert.deepEqual(await request(`/farming-logs/batch/${batchB}`, 404), await request(`/farming-logs/batch/${id(100)}`, 404))
    assert.deepEqual(await request(`/farming-logs/${logB}/history`, 404), await request(`/farming-logs/${id(100)}/history`, 404))
    await request(`/farming-logs/${logB}/confirm`, 404, 'POST', {})
    const draft = { batchId: batchA, logType: 'FEEDING', logDate: '2026-11-28', details: {} }
    const log = (await request('/farming-logs', 201, 'POST', draft)).log
    assert.equal(log.created_by, actor)
    assert.equal(log.author_name, 'Minh')
    assert.equal(log.confirmer_name, null)
    await request('/farming-logs', 404, 'POST', { ...draft, batchId: batchB })
    assert.equal((await request(farm, 200, 'PATCH', { farmName: 'Renamed' })).farm.can_manage, true)
    assert.deepEqual((await request(`${farm}/ponds`, 201, 'POST', { pondName: 'New' })).pond.permissions, ['READ', 'MANAGE'])
    assert.deepEqual((await request(pond, 200, 'PATCH', { pondName: 'Renamed' })).pond.permissions, ['READ', 'MANAGE', 'LOG_CREATE'])
    const harvests = `${pond}/batches/${batchA}/harvests`
    const harvestInput = { requestId: draftId, harvestDate: '2026-11-28', quantity: 10, isFinal: false }
    const harvestDraftPath = `${harvests}/drafts/${draftId}`
    permissions.get(pondA).push('HARVEST_CREATE')
    assert.equal((await request(`${harvests}/drafts`, 201, 'POST', harvestInput)).draft.id, draftId)
    assert.equal((await request(harvests, 200)).drafts.length, 1)
    await request(harvests, 404, 'POST', harvestInput)
    await request(`${harvestDraftPath}/confirm`, 404, 'POST', { expectedVersion: 1 })
    await request(harvestDraftPath, 404, 'PATCH', { ...harvestInput, expectedVersion: 1 })
    permissions.get(pondA).push('HARVEST_EDIT')
    assert.equal((await request(harvestDraftPath, 200, 'PATCH', { ...harvestInput, quantity: 15, expectedVersion: 1 })).draft.version, 2)
    permissions.set(pondA, ['READ', 'HARVEST_CONFIRM'])
    assert.equal((await request(`${harvestDraftPath}/confirm`, 200, 'POST', { expectedVersion: 2 })).harvest.created_by, actor)
    assert.equal((await request(harvests, 200)).drafts.length, 0)
    permissions.delete(pondA)
    await request(pond, 404)
    await request(`/farming-logs/batch/${batchA}`, 404)
    await request('/farming-logs', 404, 'POST', draft)
  } finally {
    if (server.listening) {
      server.closeAllConnections()
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
    delete require.cache[modulePath]
  }
})
