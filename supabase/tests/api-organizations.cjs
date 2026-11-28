const { randomUUID } = require('node:crypto')
const { createRequire } = require('node:module')
const { resolve, join } = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')
const { createTestDatabase } = require('./test-database.cjs')
const { createOrganizationRouter } = require('../../backend/src/modules/organizations/organizations.routes')
const { errorHandler } = require('../../backend/src/shared/middleware/error-handler')
const express = createRequire(require.resolve('../../backend/package.json'))('express')

test('authenticated organization routes enforce consent, scoped operation and departure using real SQL', async t => {
  const { db } = await createTestDatabase()
  t.after(() => db.close())
  const [coop, household, otherHousehold, manager, representative, otherRep, worker, farm, pond, batch] =
    Array.from({ length: 10 }, () => randomUUID())
  await db.query(`INSERT INTO organizations(id,name,type) VALUES
    ($1,'HTX A','COOPERATIVE'),($2,'Hộ A','FARMER_HOUSEHOLD'),($3,'Hộ B','FARMER_HOUSEHOLD')`,
  [coop, household, otherHousehold])
  for (const [user, email] of [[manager,'boss'], [representative,'rep'], [otherRep,'other-rep'], [worker,'worker']]) {
    await db.query('INSERT INTO auth.users VALUES($1)', [user])
    await db.query("INSERT INTO user_profiles(id,full_name,email,role) VALUES($1,$2,$3,'FARMER')", [user, email, email + '@example.invalid'])
  }
  await db.query(`INSERT INTO organization_memberships(organization_id,user_id,role) VALUES
    ($1,$2,'MANAGER'),($3,$4,'REPRESENTATIVE'),($5,$6,'REPRESENTATIVE')`, [coop, manager, household, representative, otherHousehold, otherRep])
  await db.query("INSERT INTO farms(id,organization_id,owner_id,farm_name) VALUES($1,$2,$3,'Trại A')", [farm,household,representative])
  await db.query("INSERT INTO ponds(id,farm_id,pond_code,pond_name) VALUES($1,$2,'A','Ao A')", [pond,farm])
  await db.query(`INSERT INTO batches(id,pond_id,batch_code,species,seed_quantity,stocking_date,status)
    VALUES($1,$2,'V-A','SHRIMP',100,now()-interval '1 month','GROWING')`, [batch,pond])

  // Express routes use this adapter to reach real functions through the service role.
  const adapter = { rpc: async (name, args) => {
    if (!/^org_[a-z_]+$/.test(name)) throw new Error('Unexpected procedure')
    const entries = Object.entries(args)
    assert.ok(entries.every(([key]) => /^p_[a-z_]+$/.test(key)))
    const slots = entries.map(([key], index) => key + ' => $' + (index + 1)).join(', ')
    try {
      const result = await db.transaction(async tx => {
        await tx.exec('SET LOCAL ROLE service_role')
        return tx.query(`SELECT public.${name}(${slots}) AS data`, entries.map(([, value]) => value))
      })
      return { data: result.rows[0].data }
    } catch (error) {
      return { error }
    }
  } }
  const sessions = new Map([manager, representative, otherRep, worker].map(user => [randomUUID(), user]))
  const byUser = new Map([...sessions].map(([token, user]) => [user, token]))
  const app = express()
  app.use(express.json())
  function authenticate(req, res, next) {
    const user = sessions.get(req.headers.authorization?.replace(/^Bearer /, ''))
    if (!user) return res.sendStatus(401)
    req.auth = { profile: { id: user } }
    next()
  }
  app.use('/api/organizations', createOrganizationRouter(adapter, authenticate, run => db.transaction(async tx => {
    await tx.exec('SET LOCAL ROLE service_role')
    return run(tx)
  })))
  if (process.env.SEAFOOD_FRONTEND_DIST) {
    const root = resolve(process.env.SEAFOOD_FRONTEND_DIST)
    app.get('/api/auth/me', authenticate, async (req, res) => {
      const { rows } = await db.query('SELECT * FROM user_profiles WHERE id=$1', [req.auth.profile.id])
      res.json({ success: true, user: rows[0] })
    })
    app.get('/api/farms/:farm/ponds/:pond/batches', authenticate, async (req, res) => {
      const { rows: [scope] } = await db.query(
        'SELECT pond_can($1,$2,$3) AND EXISTS(SELECT FROM ponds WHERE id=$2 AND farm_id=$4) AS allowed',
        [req.auth.profile.id,req.params.pond,'READ',req.params.farm])
      if (!scope.allowed) return res.sendStatus(404)
      const { rows } = await db.query('SELECT id,status FROM batches WHERE pond_id=$1', [req.params.pond])
      res.json({ items: rows })
    })
    app.use(express.static(root))
    app.get(/^\/to-chuc(?:\/.*)?$/, (_req, res) => res.sendFile(join(root, 'index.html')))
  }
  app.use(errorHandler)
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance))
    instance.once('error', reject)
  })
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
  const host = `http://127.0.0.1:${server.address().port}`
  async function request(actor, path, { method = 'GET', body, status = 200 } = {}) {
    const response = await fetch(`${host}/api/organizations${path}`, {
      method,
      headers: { authorization: 'Bearer ' + byUser.get(actor), 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const result = await response.json()
    assert.equal(response.status, status, method + ' ' + path + ' ' + result.message)
    return result
  }

  const scope = '/' + coop
  const houseScope = '/' + household
  const { id } = await request(manager, scope + '/invitations', { method: 'POST', body: { householdId: household } })
  await request(manager, scope + '/invitations', { method: 'POST', body: { householdId: otherHousehold } })
  assert.deepEqual((await request(manager, scope + '/households')).households, [])
  await request(otherRep, '/invitations/' + id + '/respond', { method: 'POST', body: { accept: true }, status: 404 })
  await request(representative, '/invitations/' + id + '/respond', { method: 'POST', body: { accept: true } })
  const { households } = await request(manager, scope + '/households')
  assert.deepEqual(households.map(row => row.household_id), [household])
  const detail = scope + '/households/' + households[0].id
  assert.deepEqual((await request(manager, detail)).batches, [])
  await request(manager, detail + '/sharing', { method: 'PATCH', body: { sharedBatchIds: [batch] }, status: 404 })
  const relationship = houseScope + '/households/' + households[0].id
  await request(representative, relationship + '/sharing', { method: 'PATCH', body: { sharedBatchIds: [batch], shareLogs: false } })
  assert.deepEqual((await request(manager, detail)).batches.map(item => item.id), [batch])

  const staffInvite = await request(representative, houseScope + '/staff/invitations', { method: 'POST', body: { email: 'worker@example.invalid' } })
  await request(worker, '/invitations/' + staffInvite.id + '/respond', { method: 'POST', body: { accept: true } })
  let membership = (await request(worker, '/workspace')).memberships[0]
  assert.equal(membership.role, 'STAFF')
  assert.deepEqual(membership.assigned_ponds, [])
  await request(representative, houseScope + '/assignments', { method: 'POST', body: {
    pondId: pond, userId: worker, permissions: ['READ', 'LOG_CREATE'], expectedAssignmentId: null,
  } })
  membership = (await request(worker, '/workspace')).memberships[0]
  assert.deepEqual(membership.assigned_ponds.map(item => item.id), [pond])
  await request(worker, houseScope + '/staff/' + membership.membership_id + '/leave', { method: 'POST' })
  assert.deepEqual((await request(worker, '/workspace')).memberships, [])
  assert.equal((await request(representative, houseScope + '/staff')).history[0].id, membership.membership_id)

  const transfer = await request(representative, houseScope + '/handovers', { method: 'POST', body: { pondId: pond, cooperativeId: coop } })
  await request(manager, scope + '/handovers/' + transfer.id + '/respond', { method: 'POST', body: { accept: true } })
  await request(representative, relationship + '/leave', { method: 'POST', status: 409 })
  await request(manager, scope + '/handovers/' + transfer.id + '/end', { method: 'POST' })
  await request(representative, relationship + '/leave', { method: 'POST' })
  await request(manager, detail, { status: 404 })
  assert.equal((await db.query('SELECT organization_id FROM farms WHERE id=$1', [farm])).rows[0].organization_id, household)
  await t.test('household requests join an HTX only after authorized approval', async () => {
    const secondCoop = randomUUID()
    const otherScope = '/' + otherHousehold
    await db.query("INSERT INTO organizations(id,name,type) VALUES($1,'HTX B','COOPERATIVE')", [secondCoop])
    await db.query("INSERT INTO organization_memberships(organization_id,user_id,role) VALUES($1,$2,'MANAGER')", [secondCoop,manager])
    const search = await request(otherRep, otherScope + '/cooperative-search?q=HTX')
    assert.deepEqual(search.cooperatives.map(item => item.name), ['HTX A', 'HTX B'])
    await request(worker, otherScope + '/cooperative-search?q=HTX', { status: 403 })
    const send = (cooperativeId, extra = {}) => request(otherRep, otherScope + '/join-requests', {
      method: 'POST', body: { cooperativeId, shareLogs: true, ...extra },
    })
    const sent = await send(coop)
    assert.equal((await send(coop)).id, sent.id)
    const competing = await send(secondCoop)
    assert.equal((await request(manager, '/invitations')).invitations.find(item => item.id === sent.id).canRespond, true)
    assert.equal((await request(manager, '/join-requests/' + sent.id)).requested_share_logs, true)
    await request(worker, '/join-requests/' + sent.id, { status: 404 })
    await request(otherRep, '/join-requests/' + sent.id + '/respond', { method: 'POST', body: { accept: true }, status: 404 })
    assert.deepEqual((await request(manager, scope + '/households')).households.filter(item => !item.ended_at), [])
    const approve = (id, status = 200) => request(manager, '/join-requests/' + id + '/respond', {
      method: 'POST', body: { accept: true, shareLogs: false }, status,
    })
    assert.equal((await approve(sent.id)).status, 'ACCEPTED')
    assert.equal((await approve(sent.id)).status, 'ACCEPTED')
    await approve(competing.id, 409)
    assert.equal((await request(manager, '/invitations')).invitations.find(item => item.id === competing.id).status, 'PENDING')
    const active = (await request(manager, scope + '/households')).households.filter(item => !item.ended_at)
    assert.equal(active.length, 1)
    assert.equal(active[0].household_id, otherHousehold)
    assert.equal(active[0].share_logs, true)
    await request(otherRep, '/join-requests/' + competing.id + '/cancel', { method: 'POST' })
    await request(otherRep, otherScope + '/households/' + active[0].id + '/leave', { method: 'POST' })
  })
  if (process.env.SEAFOOD_FRONTEND_DIST) {
    await t.test('HTX invitation and privacy defaults on desktop and mobile Chromium', async () => {
      const { browserScenario } = require('./browser-organizations.cjs')
      await db.query("INSERT INTO organization_memberships(organization_id,user_id,role) VALUES($1,$2,'STAFF')", [otherHousehold,manager])
      await browserScenario({ host, organization: coop, household, managerToken: byUser.get(manager),
        representativeToken: byUser.get(representative), staffOrganization: otherHousehold,
        secondRepresentativeToken: byUser.get(otherRep),
        askForHandover: () => request(representative, houseScope + '/handovers', { method: 'POST', body: { pondId: pond, cooperativeId: coop } }),
        readInvitations: async () => (await request(representative, '/invitations')).invitations })
    })
    await t.test('independent farmer creates a household and links existing farms selectively on mobile', async () => {
      const [first, second] = [randomUUID(), randomUUID()]
      await db.query(`INSERT INTO farms(id,owner_id,farm_name) VALUES
        ($1,$3,'Cơ sở Minh A'),($2,$3,'Cơ sở Minh B')`, [first,second,worker])
      await db.query("INSERT INTO ponds(farm_id,pond_code,pond_name) VALUES($1,'MINH-A','Ao của Minh')", [first])
      const { householdSetupScenario } = require('./browser-organizations.cjs')
      await householdSetupScenario({ host, token: byUser.get(worker) })
      const { rows } = await db.query("SELECT f.organization_id,f.owner_id,o.name FROM farms f JOIN organizations o ON o.id=f.organization_id WHERE f.id IN ($1,$2)", [first,second])
      assert.equal(rows.length, 2)
      assert.ok(rows.every(row => row.name === 'Hộ Minh' && row.owner_id === worker && row.organization_id === rows[0].organization_id))
    })
  }
})
