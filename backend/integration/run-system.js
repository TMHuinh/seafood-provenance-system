const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { spawn } = require('node:child_process')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { root, docker, sql, ready, gateway, rpcGateway, migrate, jwt } = require('./local-stack')

// Public Hardhat development keys, exclusively for this disposable local network.
const ownerKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const writerKey = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
const rpcUrl = 'http://127.0.0.1:6546'
const apiUrl = 'http://127.0.0.1:6544/api'
const webUrl = 'http://127.0.0.1:6545'
let proxy, rpcProxy, apiServer, frontend, browser, provider, worker, transportWorker
const checks = []
const pass = (label) => {
  checks.push(label)
  console.log(`PASS ${label}`)
}
async function api(method, endpoint, token, body, expected = 200) {
  const response = await fetch(`${apiUrl}${endpoint}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  })
  const value = await response.json()
  assert.equal(response.status, expected, `${method} ${endpoint}: ${JSON.stringify(value)}`)
  return value
}
async function main() {
  // Reject accidental execution against any external database or preconfigured application.
  Object.assign(process.env, {
    NODE_ENV: 'test',
    PORT: '6544',
    FRONTEND_URL: webUrl,
    SUPABASE_URL: 'http://127.0.0.1:6541',
    SUPABASE_SECRET_KEY: jwt('service_role'),
    SUPABASE_ANON_KEY: jwt('anon'),
    BLOCKCHAIN_RPC_URL: 'http://127.0.0.1:6547',
    BLOCKCHAIN_PRIVATE_KEY: writerKey,
    CLOUDINARY_NAME: 'seafood-test',
    CLOUDINARY_API_KEY: '',
    CLOUDINARY_API_SECRET: '',
  })
  console.log('Starting isolated services on localhost ports 6540–6547')
  docker(['up', '-d', '--wait'])
  await ready('http://127.0.0.1:6543/health')
  await ready(rpcUrl, { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] })
  await migrate()
  proxy = await gateway()
  rpcProxy = await rpcGateway()
  const { ethers } = require('ethers')
  provider = new ethers.JsonRpcProvider(rpcUrl)
  provider.pollingInterval = 100
  const owner = new ethers.Wallet(ownerKey, provider),
    writer = new ethers.Wallet(writerKey, provider)
  const artifact = JSON.parse(
    readFileSync(path.join(root, 'backend/artifacts/contracts/SeafoodProvenance.sol/SeafoodProvenance.json')),
  )
  const contract = await new ethers.ContractFactory(artifact.abi, artifact.bytecode, owner).deploy()
  await contract.waitForDeployment()
  process.env.BLOCKCHAIN_CONTRACT_ADDRESS = await contract.getAddress()
  // Leave writer unauthorized initially to exercise recovery from a real contract rejection.
  const app = require('../src/app')
  worker = require('../src/modules/blockchain/blockchain.outbox')
  transportWorker = require('../src/modules/transports/transports.outbox')
  apiServer = await new Promise((resolve) => {
    const server = app.listen(6544, '127.0.0.1', () => resolve(server))
  })
  const db = require('../src/config/supabase')
  async function rows(table, filter = {}) {
    let query = db.from(table).select('*')
    for (const [key, value] of Object.entries(filter)) query = query.eq(key, value)
    const { data, error } = await query
    if (error) throw error
    return data
  }
  async function retry() {
    const deadline = Date.now() + 120000
    let pending
    do {
      sql(
        'UPDATE public.blockchain_outbox SET retry_after = NOW(); UPDATE public.transport_events SET retry_after = NOW();',
      )
      await worker.processBatch()
      await transportWorker.processBatch()
      pending = [
        ...(await rows('blockchain_outbox')).filter((row) => row.status !== 'SUCCESS'),
        ...(await rows('transport_events')).filter((row) => row.blockchain_status !== 'SUCCESS'),
      ]
      if (!pending.length) return
      await new Promise((resolve) => setTimeout(resolve, 250))
    } while (Date.now() < deadline)
    assert.fail(`Workers did not recover: ${JSON.stringify(pending)}`)
  }
  async function register(role) {
    const email = `${role.toLowerCase()}-${randomUUID()}@seafood.test`
    const password = 'Local-test-password-123!'
    const result = await api(
      'POST',
      '/auth/register',
      null,
      {
        fullName: `Test ${role}`,
        email,
        password,
        role,
        organizationName: `Test organization ${role}`,
        organizationType: role === 'DISTRIBUTOR' ? 'DISTRIBUTOR' : 'COMPANY',
      },
      201,
    )
    const session = await api('POST', '/auth/login', null, { email, password })
    assert.ok(session.accessToken)
    return { token: session.accessToken, user: result.user, email, password }
  }
  const farmer = await register('FARMER'),
    stranger = await register('FARMER')
  const transporter = await register('TRANSPORTER'),
    distributor = await register('DISTRIBUTOR'),
    wrongDistributor = await register('DISTRIBUTOR')
  pass('real Auth registration and login for all workflow roles')
  const farm = (
    await api('POST', '/farms', farmer.token, { farmName: 'Cơ sở E2E', address: 'Cà Mau', area: 1000 }, 201)
  ).farm
  const pond = (
    await api(
      'POST',
      `/farms/${farm.id}/ponds`,
      farmer.token,
      { pondCode: 'AO-E2E', pondName: 'Ao E2E', area: 100 },
      201,
    )
  ).pond
  const batchPath = `/farms/${farm.id}/ponds/${pond.id}/batches`
  const batch = (
    await api(
      'POST',
      batchPath,
      farmer.token,
      {
        species: 'SHRIMP',
        seedSource: 'Giống E2E',
        seedQuantity: 1000,
        stockingDate: '2026-01-01T00:00:00+07:00',
        status: 'GROWING',
      },
      201,
    )
  ).batch
  const [batchJob] = await rows('blockchain_outbox', { batch_id: batch.id })
  assert.equal(batchJob.status, 'FAILED')
  assert.equal(batchJob.payload.format, 'batch_version_v1')
  assert.equal(batchJob.payload.snapshot.batch_code, batch.batch_code)
  assert.equal((await rows('batches', { id: batch.id })).length, 1)
  await (await contract.setWriter(writer.address, true)).wait()
  await retry()
  assert.equal((await rows('blockchain_outbox', { batch_id: batch.id }))[0].status, 'SUCCESS')
  const expectedBatchHash = require('../src/modules/blockchain/blockchain.service').hashData({
    batchId: batch.id, farmId: farm.id, pondId: pond.id, batchCode: batch.batch_code, species: 'SHRIMP',
    seedSource: 'Giống E2E', seedQuantity: 1000, stockingDate: '2025-12-31T17:00:00.000Z',
    expectedHarvestDate: null, status: 'GROWING', note: null,
  })
  assert.equal(await contract.getDataHash(batchJob.event_id), expectedBatchHash)
  pass('farm → pond → batch; denied writer leaves durable job, authorized retry recovers')

  const logInput = {
    batchId: batch.id,
    logType: 'FEEDING',
    logDate: '2026-02-01T00:00:00+07:00',
    details: { feedType: 'Thức ăn E2E', feedAmount: 2 },
  }
  const draft = (await api('POST', '/farming-logs', farmer.token, logInput, 201)).log
  assert.equal((await rows('blockchain_outbox', { entity_id: draft.id })).length, 0)
  await api('POST', `/farming-logs/${draft.id}/confirm`, stranger.token, {}, 403)
  await api('POST', `/farming-logs/${draft.id}/confirm`, farmer.token, {})
  await api('POST', `/farming-logs/${draft.id}/confirm`, farmer.token, {}, 409)
  await retry()
  assert.equal((await rows('farming_log_versions', { farming_log_id: draft.id })).length, 1)
  pass('draft stays off-chain; confirmation enqueues once and denies foreign owner')

  // Force the final queue insert to fail and prove the business transaction rolls back.
  sql(
    "ALTER TABLE public.blockchain_outbox ADD CONSTRAINT test_reject_queue CHECK (event_type <> 'HARVEST_RECORDED' AND COALESCE(payload->'details'->>'feedType', '') <> 'REJECT-OUTBOX') NOT VALID;",
  )
  const rejectedHarvest = await db.rpc('record_batch_harvest', {
    p_batch: batch.id,
    p_pond: pond.id,
    p_actor: farmer.user.id,
    p_request: randomUUID(),
    p_date: '2026-02-02',
    p_quantity: 1,
    p_final: false,
    p_note: null,
  })
  assert.equal(rejectedHarvest.error?.code, '23514')
  assert.equal((await rows('harvests', { batch_id: batch.id })).length, 0)
  await api(
    'POST',
    `/farming-logs/${draft.id}/corrections`,
    farmer.token,
    {
      ...logInput,
      expectedVersion: 1,
      correctionReason: 'Kiểm tra rollback',
      details: { feedType: 'REJECT-OUTBOX', feedAmount: 3 },
    },
    503,
  )
  assert.equal((await rows('farming_logs', { id: draft.id }))[0].current_version, 1)
  assert.equal((await rows('farming_log_versions', { farming_log_id: draft.id })).length, 1)
  assert.equal((await rows('batch_versions', { batch_id: batch.id })).length, 1)
  sql('ALTER TABLE public.blockchain_outbox DROP CONSTRAINT test_reject_queue;')
  pass('queue insertion failure rolls back harvest, batch version and log correction together')

  // Block application RPC access while preserving all existing EVM state.
  rpcProxy.setOffline(true)
  const firstRequest = { requestId: randomUUID(), harvestDate: '2026-02-02', quantity: 12.5, isFinal: false, note: '' }
  const harvested = await api('POST', `${batchPath}/${batch.id}/harvests`, farmer.token, firstRequest, 201)
  assert.notEqual(harvested.blockchain.status, 'SUCCESS')
  const replay = await api('POST', `${batchPath}/${batch.id}/harvests`, farmer.token, firstRequest)
  assert.equal(replay.lot.id, harvested.lot.id)
  await api('POST', `${batchPath}/${batch.id}/harvests`, farmer.token, { ...firstRequest, quantity: 13 }, 409)
  assert.equal((await rows('harvests', { batch_id: batch.id })).length, 1)
  const correction = {
    ...logInput,
    expectedVersion: 1,
    correctionReason: 'Sửa lượng thức ăn',
    details: { feedType: 'Thức ăn E2E', feedAmount: 3 },
  }
  await api('POST', `/farming-logs/${draft.id}/corrections`, farmer.token, correction)
  await api('POST', `/farming-logs/${draft.id}/corrections`, farmer.token, correction, 409)
  const revokedDraft = (await api('POST', '/farming-logs', farmer.token, logInput, 201)).log
  await api('POST', `/farming-logs/${revokedDraft.id}/confirm`, farmer.token, {})
  await api('POST', `/farming-logs/${revokedDraft.id}/revoke`, farmer.token, { reason: 'Thu hồi khi RPC lỗi' })
  assert.equal((await rows('farming_logs', { id: revokedDraft.id }))[0].lifecycle_status, 'REVOKED')
  const pendingVerify = await api('GET', `/farming-logs/batch/${batch.id}/verify`, farmer.token)
  assert.equal(pendingVerify.summary.pending, 1)
  assert.equal(pendingVerify.summary.revoked, 1)
  assert.equal(pendingVerify.summary.desynced, 0)
  pass('offline log correction/revocation commits independently; stale correction is rejected')

  const queuedEvent = harvested.lot.blockchain_event_id
  const tampered = await db
    .from('blockchain_outbox')
    .update({ payload: { tampered: true } })
    .eq('event_id', queuedEvent)
  assert.equal(tampered.error?.code, '22023')
  sql('UPDATE public.blockchain_outbox SET retry_after = NOW();')
  const claim = async () => {
    const result = await db.rpc('claim_blockchain_outbox', { p_event: queuedEvent })
    if (result.error) throw result.error
    return result.data
  }
  const [claimedOne, claimedTwo] = await Promise.all([claim(), claim()])
  assert.equal(claimedOne.length + claimedTwo.length, 1)
  const oldLease = [...claimedOne, ...claimedTwo][0].lease_token
  sql("UPDATE public.blockchain_outbox SET lease_until = NOW() - INTERVAL '1 second' WHERE lease_until IS NOT NULL;")
  const replacement = (await claim())[0]
  assert.notEqual(replacement.lease_token, oldLease)
  const staleFinish = await db.rpc('finish_blockchain_outbox', {
    p_event: queuedEvent,
    p_token: oldLease,
    p_status: 'FAILED',
    p_error: 'stale',
    p_delay: 15,
  })
  assert.equal(staleFinish.data, false)
  sql("UPDATE public.blockchain_outbox SET lease_until = NOW() - INTERVAL '1 second' WHERE lease_until IS NOT NULL;")
  assert.equal(
    sql(
      "SELECT has_function_privilege('anon','public.claim_blockchain_outbox(text)','execute'), has_table_privilege('authenticated','public.blockchain_outbox','update');",
    ).trim(),
    'f|f',
  )
  pass('real SQL enforces immutable queue, exclusive/expired leases and service-only access')
  rpcProxy.setOffline(false)
  await retry()
  assert.equal((await rows('blockchain_outbox', { event_id: harvested.lot.blockchain_event_id }))[0].status, 'SUCCESS')
  const correctedLog = (await rows('farming_logs', { id: draft.id }))[0]
  assert.equal(correctedLog.current_version, 2)
  assert.equal(
    correctedLog.data_hash,
    require('../src/modules/blockchain/blockchain.service').hashData({
      batchId: batch.id,
      logType: 'FEEDING',
      logDate: new Date(logInput.logDate).toISOString(),
      details: correction.details,
    }),
  )
  assert.ok(correctedLog.tx_hash)
  assert.equal((await api('GET', `/farming-logs/batch/${batch.id}/verify`, farmer.token)).summary.verified, 1)
  rpcProxy.setOffline(true)
  assert.equal((await api('GET', `/farming-logs/batch/${batch.id}/verify`, farmer.token)).summary.unavailable, 1)
  rpcProxy.setOffline(false)
  pass('RPC outage → harvest remains saved → request replay/conflict → retry recovers proof')

  // Simulate a crash after the SQL harvest transaction, before API proof submission.
  const interrupted = await db.rpc('record_batch_harvest', {
    p_batch: batch.id,
    p_pond: pond.id,
    p_actor: farmer.user.id,
    p_request: randomUUID(),
    p_date: '2026-02-03',
    p_quantity: 7.5,
    p_final: true,
    p_note: null,
  })
  if (interrupted.error) throw interrupted.error
  const finalLot = interrupted.data.lot
  assert.equal((await rows('blockchain_records', { event_id: finalLot.blockchain_event_id })).length, 0)
  const { createBlockchainOutbox } = worker
  const restartedWorker = createBlockchainOutbox(db, require('../src/modules/blockchain/blockchain.service'))
  const competingWorker = createBlockchainOutbox(db, require('../src/modules/blockchain/blockchain.service'))
  await Promise.all([restartedWorker.processBatch(), competingWorker.processBatch()])
  assert.equal((await rows('blockchain_outbox', { event_id: finalLot.blockchain_event_id }))[0].status, 'SUCCESS')
  const production = await api('GET', '/lots/production', farmer.token)
  assert.equal(production.summary.quantity, 20)
  await api('GET', `/lots/${finalLot.id}/report`, stranger.token, undefined, 404)
  pass('SQL commit survives API/worker restart; partial/final harvest totals and owner scope')

  const trip = (
    await api(
      'POST',
      `${batchPath}/${batch.id}/lots/${finalLot.id}/transports`,
      farmer.token,
      {
        requestId: randomUUID(),
        recipientOrganizationId: distributor.user.organization_id,
        quantity: 6,
        transportDate: '2026-02-04T01:00:00Z',
        fromLocation: 'Cơ sở E2E',
        toLocation: 'Kho E2E',
      },
      201,
    )
  ).transport
  await api('POST', `/transports/${trip.id}/qr`, distributor.token, {}, 409)
  await api('POST', `/transports/${trip.id}/claim`, transporter.token, {})
  await api('PATCH', `/transports/${trip.id}/status`, transporter.token, {
    status: 'IN_TRANSIT',
    vehicle: 'XE-E2E',
    driver: 'Tài xế E2E',
  })
  await api(
    'POST',
    `/transports/${trip.id}/tracking-updates`,
    transporter.token,
    { trackingStatus: 'PICKED_UP', location: 'Cơ sở E2E', temperature: 4 },
    201,
  )
  await api(
    'POST',
    `/transports/${trip.id}/tracking-updates`,
    transporter.token,
    {
      trackingStatus: 'DELIVERED_REPORTED',
      location: 'Kho E2E',
      temperature: 4,
      deliveryProofUrl: 'https://res.cloudinary.com/seafood-test/image/upload/v1/evidence.jpg',
    },
    201,
  )
  await api('POST', `/transports/${trip.id}/confirm-delivery`, wrongDistributor.token, {}, 404)
  await api('POST', `/transports/${trip.id}/confirm-delivery`, distributor.token, {}, 400)
  const received = await api('POST', `/transports/${trip.id}/confirm-delivery`, distributor.token, {
    receiptOutcome: 'PARTIAL', receivedQuantity: 5.5, note: 'Thiếu 0,5 kg tại điểm giao',
  })
  assert.equal(received.transport.receipt_outcome, 'PARTIAL')
  assert.equal(Number(received.transport.received_quantity), 5.5)
  await retry()
  const events = await rows('transport_events', { transport_id: trip.id })
  assert.ok(events.length >= 5)
  assert.ok(events.every((event) => event.blockchain_status === 'SUCCESS'))
  pass('transport claim → departure → tracking → delivery → correct recipient confirmation → ordered chain events')

  const qrPath = `/transports/${trip.id}/qr`
  const packagingPath = `/transports/${trip.id}/packaging`
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
  const packagingInput = {
    packagedDate: today, quantity: 5, specification: 'Túi 500 g',
    inspectionDate: today, inspectionUnit: 'Phòng kiểm định E2E', inspectionResult: 'Cảm quan đạt',
  }
  await api('POST', qrPath, distributor.token, {}, 412)
  await api('POST', packagingPath, wrongDistributor.token, packagingInput, 404)
  await api('POST', packagingPath, distributor.token, { ...packagingInput, quantity: 5.51 }, 400)
  sql("ALTER TABLE public.blockchain_outbox ADD CONSTRAINT test_packaging_rollback CHECK (entity_type <> 'LOT_PACKAGING') NOT VALID;")
  await api('POST', packagingPath, distributor.token, packagingInput, 400)
  assert.equal((await api('GET', packagingPath, distributor.token)).packaging, null)
  sql('ALTER TABLE public.blockchain_outbox DROP CONSTRAINT test_packaging_rollback;')
  const packaged = await api('POST', packagingPath, distributor.token, packagingInput)
  assert.deepEqual(await api('POST', packagingPath, distributor.token, packagingInput), packaged)
  await api('POST', packagingPath, distributor.token, { ...packagingInput, quantity: 4 }, 409)
  await retry()
  const [packagingJob] = await rows('blockchain_outbox', { event_id: `QUALITY_INSPECTION_RECORDED:${trip.id}` })
  assert.equal(packagingJob.status, 'SUCCESS')
  assert.equal(await contract.getDataHash(packagingJob.event_id),
    require('../src/modules/blockchain/blockchain.service').hashData(packaged.packaging))
  const issued = await api('POST', qrPath, distributor.token, {})
  const code = issued.qr.trace_code
  assert.equal((await api('POST', `/transports/${trip.id}/qr`, distributor.token, {})).qr.trace_code, code)
  const trace = await api('GET', `/public/trace/${code}`, null)
  assert.equal(trace.status, 'ACTIVE')
  assert.equal(trace.trace.proof.status, 'MATCH')
  assert.equal(trace.trace.logs.length, 1)
  assert.equal(trace.trace.transports[0].recipientName, distributor.user.organization.name)
  assert.equal(Number(trace.trace.transports[0].quantity), 6)
  assert.equal(Number(trace.trace.transports[0].receivedQuantity), 5.5)
  assert.equal(trace.trace.transports[0].receiptOutcome, 'PARTIAL')
  assert.equal(Number(trace.trace.packaging[0].quantity), 5)
  assert.equal(trace.trace.packaging[0].inspectionResult, packagingInput.inspectionResult)
  assert.equal(trace.trace.packaging[0].blockchainStatus, 'SUCCESS')
  assert.equal(trace.trace.packaging[0].verificationStatus, 'MATCH')
  assert.equal(Object.hasOwn(trace.trace.packaging[0], 'transactionHash'), false)
  assert.equal(Object.hasOwn(trace.trace.proof, 'transactionHash'), false)

  const secondTrip = (await api('POST', `${batchPath}/${batch.id}/lots/${finalLot.id}/transports`, farmer.token, {
    requestId: randomUUID(), recipientOrganizationId: wrongDistributor.user.organization_id, quantity: 1.5,
    transportDate: '2026-02-04T02:00:00Z', fromLocation: 'Cơ sở E2E', toLocation: 'Kho thứ hai',
  }, 201)).transport
  const secondPath = `/transports/${secondTrip.id}`
  await api('POST', `${secondPath}/claim`, transporter.token, {})
  await api('PATCH', `${secondPath}/status`, transporter.token, { status: 'IN_TRANSIT', vehicle: 'XE-E2E', driver: 'Tài xế E2E' })
  await api('POST', `${secondPath}/tracking-updates`, transporter.token, {
    trackingStatus: 'PICKED_UP', location: 'Cơ sở E2E', temperature: 4,
  }, 201)
  await api('POST', `${secondPath}/tracking-updates`, transporter.token, {
    trackingStatus: 'DELIVERED_REPORTED', location: 'Kho thứ hai', temperature: 4,
    deliveryProofUrl: 'https://res.cloudinary.com/seafood-test/image/upload/v1/evidence.jpg',
  }, 201)
  await api('POST', `${secondPath}/confirm-delivery`, wrongDistributor.token, { receiptOutcome: 'FULL', receivedQuantity: 1.5 })
  assert.equal((await api('GET', `${secondPath}/qr`, wrongDistributor.token)).qr, null)
  await api('POST', `${secondPath}/packaging`, wrongDistributor.token, { ...packagingInput, quantity: 1.5, specification: 'Hộp 750 g' })
  const secondIssue = () => api('POST', `${secondPath}/qr`, wrongDistributor.token, {})
  const [secondIssued, secondReplay] = await Promise.all([secondIssue(), secondIssue()])
  const secondCode = secondIssued.qr.trace_code
  assert.notEqual(secondCode, code)
  assert.equal(secondReplay.qr.trace_code, secondCode)
  const secondTrace = (await api('GET', `/public/trace/${secondCode}`, null)).trace
  assert.deepEqual(secondTrace.transports.map(item => item.code), [secondTrip.transport_code])
  assert.deepEqual(secondTrace.packaging.map(item => item.specification), ['Hộp 750 g'])
  const firstTrace = (await api('GET', `/public/trace/${code}`, null)).trace
  assert.deepEqual(firstTrace.transports.map(item => item.code), [trip.transport_code])
  assert.deepEqual(firstTrace.packaging.map(item => item.specification), ['Túi 500 g'])
  await api('POST', `${secondPath}/qr/revoke`, wrongDistributor.token, { traceCode: code, reason: 'Mã của chuyến khác' }, 409)
  const privateReport = await api('GET', `/lots/${finalLot.id}/report`, farmer.token)
  assert.ok(privateReport.history.length)
  const publicReport = await api('GET', `/public/trace/${code}/report`, null)
  assert.equal(publicReport.history, undefined)
  pass('QR publication is idempotent; public proof MATCH and private/public report boundaries')

  const [storedProof] = await rows('blockchain_records', { event_id: finalLot.blockchain_event_id })
  assert.ok(storedProof.signed_transaction)
  const batchDetail = await api('GET', `/batches/${batch.id}`, farmer.token)
  const batchProof = batchDetail.blockchain.find((record) => record.event_id === finalLot.blockchain_event_id)
  const harvestList = await api('GET', `${batchPath}/${batch.id}/harvests`, farmer.token)
  const harvestProof = harvestList.items.find((lot) => lot.id === finalLot.id)?.blockchain
  for (const proof of [batchProof, harvestProof]) {
    assert.ok(proof)
    assert.equal(proof.transaction_hash, storedProof.transaction_hash)
    assert.equal(Object.hasOwn(proof, 'signed_transaction'), false)
    assert.equal(Object.hasOwn(proof, 'signer_address'), false)
  }
  for (const [role, token] of [['anon', jwt('anon')], ['authenticated', farmer.token]]) {
    const direct = await fetch('http://127.0.0.1:6541/rest/v1/blockchain_records?select=id&limit=1', {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000),
    })
    const body = await direct.json()
    assert.equal(direct.status, role === 'anon' ? 401 : 403)
    assert.equal(body.code, '42501')
  }
  pass('proof APIs omit signed transactions and direct browser roles cannot read blockchain_records')

  // Real browser renders production/list/report pages and produces an actual PDF.
  frontend = spawn(
    process.execPath,
    [
      path.join(root, 'frontend/node_modules/vite/bin/vite.js'),
      '--host',
      '127.0.0.1',
      '--port',
      '6545',
      '--strictPort',
    ],
    {
      cwd: path.join(root, 'frontend'),
      env: { ...process.env, VITE_API_URL: 'http://127.0.0.1:6544' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )
  frontend.stderr.on('data', (value) => process.stderr.write(value))
  frontend.stdout.on('data', () => {})
  await ready(webUrl)
  const { chromium } = require('@playwright/test')
  browser = await chromium.launch(process.env.E2E_BROWSER_CHANNEL ? { channel: process.env.E2E_BROWSER_CHANNEL } : {})
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${webUrl}/login`)
  await page.locator('input[type=email]').fill(farmer.email)
  await page.locator('input[type=password]').fill(farmer.password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(`${webUrl}/`)
  await page.goto(`${webUrl}/farms/${farm.id}/ponds/${pond.id}/batches/${batch.id}/logs`)
  await page.getByRole('button', { name: /Kiểm tra Blockchain/ }).click()
  await page.getByRole('heading', { name: 'Kết quả đồng bộ Blockchain' }).waitFor()
  await page.getByText('Khớp dữ liệu', { exact: true }).first().waitFor()
  await page.reload()
  rpcProxy.setOffline(true)
  await page.getByRole('button', { name: /Kiểm tra Blockchain/ }).click()
  await page.getByRole('heading', { name: 'Kết quả đồng bộ Blockchain' }).waitFor()
  await page.getByText('Chưa thể đối soát', { exact: true }).first().waitFor()
  rpcProxy.setOffline(false)
  await ready(process.env.BLOCKCHAIN_RPC_URL, { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] })
  pass('browser log verification distinguishes matching evidence from an unavailable RPC')
  await page.goto(`${webUrl}/lo-hang`)
  await page.getByText(finalLot.lot_code, { exact: true }).waitFor()
  await page.getByRole('searchbox').fill(finalLot.lot_code)
  await page.getByRole('button', { name: /Tìm lô hàng/ }).click()
  await page.waitForURL(/search=/)
  await page.getByRole('link', { name: 'Báo cáo truy xuất', exact: true }).first().click()
  await page.getByRole('heading', { name: 'Báo cáo kết quả truy xuất' }).waitFor()
  await page.getByText('Hash hồ sơ thu hoạch khớp Blockchain', { exact: true }).waitFor()
  const pdf = await page.pdf({ format: 'A4', printBackground: true })
  assert.ok(pdf.length > 1000)
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
  await page.goto(`${webUrl}/thong-ke/san-luong`)
  await page.getByText('20 kg', { exact: true }).first().waitFor()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: /Xuất CSV/ }).click()
  const download = await downloading
  const stream = await download.createReadStream(),
    chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  assert.match(Buffer.concat(chunks).toString('utf8'), /"Tổng sản lượng \(kg\)","20"/)
  await page.setViewportSize({ width: 390, height: 844 })
  const publicPage = await browser.newPage({ viewport: { width: 390, height: 844 } })
  publicPage.on('pageerror', (error) => errors.push(error.message))
  await publicPage.goto(`${webUrl}/trace/${code}/report`)
  await publicPage.getByRole('heading', { name: 'Báo cáo kết quả truy xuất' }).waitFor()
  await publicPage.getByText(packagingInput.inspectionResult, { exact: true }).waitFor()
  await publicPage.getByText('Khối lượng gửi', { exact: false }).waitFor()
  await publicPage.getByText('Khối lượng thực nhận', { exact: false }).waitFor()
  pass('browser login → lot search → private report/PDF → production; mobile public report without login')
  await api(
    'POST',
    `/transports/${trip.id}/qr/revoke`,
    wrongDistributor.token,
    { reason: 'Sai tổ chức phát hành' },
    404,
  )
  await api('POST', `/transports/${trip.id}/qr/revoke`, distributor.token, { reason: 'Thu hồi thử nghiệm' })
  assert.equal((await api('GET', `/public/trace/${secondCode}`, null)).status, 'ACTIVE')
  assert.equal((await api('GET', `/public/trace/${code}/report`, null)).trace, undefined)
  await publicPage.reload()
  await publicPage.getByText('QR đã được thu hồi.', { exact: false }).waitFor()
  assert.equal(await publicPage.getByRole('button', { name: /In \/ Lưu PDF/ }).isDisabled(), true)
  assert.deepEqual(errors, [])
  pass('QR revoke authorization; same public URL stops returning dossier and disables PDF')
  await api('POST', `/transports/${trip.id}/qr/reissue`, distributor.token, { traceCode: randomUUID() }, 409)
  const replacementQr = await api('POST', `/transports/${trip.id}/qr/reissue`, distributor.token, { traceCode: code })
  const replacementCode = replacementQr.qr.trace_code
  assert.notEqual(replacementCode, code)
  assert.equal((await api('GET', `/public/trace/${code}`, null)).status, 'REVOKED')
  assert.equal((await api('GET', `/public/trace/${replacementCode}`, null)).trace.proof.status, 'MATCH')
  assert.equal((await api('GET', `/transports/${trip.id}/qr`, distributor.token)).qr.trace_code, replacementCode)
  await api('POST', `/transports/${trip.id}/qr/revoke`, distributor.token, { traceCode: code, reason: 'Mã cũ đã thu hồi' }, 409)
  await publicPage.goto(`${webUrl}/trace/${replacementCode}/report`)
  await publicPage.getByRole('heading', { name: 'Báo cáo kết quả truy xuất' }).waitFor()
  await publicPage.getByText('Đã kiểm tra. Thông tin thu hoạch khớp với hồ sơ đã lưu.', { exact: true }).waitFor()
  assert.deepEqual(errors, [])
  pass('QR reissue keeps the old URL revoked, publishes a new code and rejects stale mutations')
  console.log(`\n${checks.length} system checks passed (real local PostgreSQL/Auth/PostgREST/EVM/browser).`)
}
let runFinished = false
process.once('beforeExit', () => {
  if (!runFinished) {
    console.error('Integration suite exited before completing its checks and cleanup')
    process.exitCode = 1
  }
})
main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
    try {
      console.error(docker(['logs', '--tail', '12', 'db', 'rest', 'auth', 'chain']))
    } catch {
      /* startup may have failed */
    }
  })
  .finally(async () => {
    worker?.stop()
    transportWorker?.stop()
    if (browser) await browser.close()
    if (frontend) {
      frontend.kill()
      await new Promise((resolve) => {
        if (frontend.exitCode !== null) resolve()
        else frontend.once('exit', resolve)
      })
    }
    for (const server of [apiServer, proxy, rpcProxy])
      if (server) {
        server.closeAllConnections()
        await new Promise((resolve) => server.close(resolve))
      }
    provider?.destroy()
    try {
      docker(['down', '--volumes', '--remove-orphans'])
    } catch (error) {
      console.error('Test stack cleanup:', error.message)
      process.exitCode = 1
    }
  })
  .finally(() => { runFinished = true })
