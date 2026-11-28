const test = require('node:test')
const assert = require('node:assert/strict')
const { workspace } = require('../src/modules/organizations/organizations.service')

test('workspace reads current memberships using the authenticated profile id', async () => {
  const actor = '0e69fc92-31e8-4dab-a67b-00bd60702eea'
  const calls = []
  const db = { rpc: async (...args) => {
    calls.push(args)
    return { data: { memberships: [], invitations: [] }, error: null }
  } }
  assert.deepEqual(await workspace(db, actor), { memberships: [], invitations: [] })
  assert.deepEqual(calls, [['org_workspace', { p_actor: actor }]])
})

test('workspace route always binds identity to authentication', async () => {
  const express = require('express')
  const { createOrganizationRouter } = require('../src/modules/organizations/organizations.routes')
  const actor = '0e69fc92-31e8-4dab-a67b-00bd60702eea'
  const calls = []
  const db = { rpc: async (name, args) => {
    calls.push([name, args])
    return { data: { actor: args.p_actor } }
  } }
  const app = express()
  app.use(express.json())
  app.use('/api/organizations', createOrganizationRouter(db, (req, res, next) => {
    if (!req.headers.authorization) return res.sendStatus(401)
    req.auth = { profile: { id: actor } }
    next()
  }))
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener))
    listener.once('error', reject)
  })
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/organizations/workspace?actor=another`
    assert.equal((await fetch(url)).status, 401)
    const result = await fetch(url, { headers: { authorization: 'Bearer fixture' } })
    assert.equal(result.status, 200)
    assert.deepEqual(await result.json(), { actor })
    const org = '0e69fc92-31e8-4dab-a67b-00bd60702ee1'
    const household = '0e69fc92-31e8-4dab-a67b-00bd60702ee2'
    const send = await fetch(`http://127.0.0.1:${server.address().port}/api/organizations/${org}/invitations`, {
      method: 'POST',
      headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' },
      body: JSON.stringify({ householdId: household, actor: 'another', p_actor: 'another' }),
    })
    assert.equal(send.status, 200)
    assert.deepEqual(await send.json(), { actor })
    assert.deepEqual(calls.at(-1), ['org_invite_household', { p_actor: actor, p_org: org, p_household: household }])

    const setup = await fetch(`http://127.0.0.1:${server.address().port}/api/organizations/household-setup`, {
      method: 'POST',
      headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: household, name: ' Hộ Minh ', farmIds: [org, org], p_actor: 'another' }),
    })
    assert.equal(setup.status, 200)
    assert.deepEqual(calls.at(-1), ['org_create_household_profile', {
      p_request: household, p_name: 'Hộ Minh', p_address: null, p_farm_ids: [org], p_actor: actor,
    }])
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
