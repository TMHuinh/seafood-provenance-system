const { test } = require('node:test')
const assert = require('node:assert/strict')
const { ethers } = require('ethers')
const hre = require('hardhat')
const { createBlockchainService, hashData } = require('../src/modules/blockchain/blockchain.service')

// A small database boundary; all contract calls below execute on the real EVM.
function database() {
  const records = new Map()
  let busy = false
  const db = {
    records,
    failFinal: false,
    beforeUpdate: null,
    rpc(name) {
      return {
        abortSignal: async () => {
          if (name === 'release_blockchain_signer') {
            busy = false
            return { data: null }
          }
          if (busy) return { data: null }
          busy = true
          return { data: 'lease' }
        },
      }
    },
    from() {
      let multiple = false
      let operation = 'read',
        values,
        filters = []
      const query = {
        select(columns) {
          if (columns && columns !== '*') multiple = true
          return query
        },
        eq(key, value) {
          filters.push((row) => row[key] === value)
          return query
        },
        neq(key, value) {
          filters.push((row) => row[key] !== value)
          return query
        },
        is(key, value) {
          filters.push((row) => (row[key] ?? null) === value)
          return query
        },
        not(key, operator, value) {
          assert.equal(operator, 'is')
          filters.push((row) => (row[key] ?? null) !== value)
          return query
        },
        order() {
          return query
        },
        limit() {
          return query
        },
        insert(value) {
          operation = 'insert'
          values = value
          return query
        },
        update(value) {
          operation = 'update'
          values = value
          return query
        },
        single() {
          return execute()
        },
        maybeSingle() {
          return execute()
        },
        then(resolve, reject) {
          return execute().then(resolve, reject)
        },
      }
      async function execute() {
        if (operation === 'insert') {
          if (records.has(values.event_id)) return { error: { code: '23505' } }
          const row = { id: values.event_id, ...values }
          records.set(row.event_id, row)
          return { data: { ...row } }
        }
        if (operation === 'update' && values.recorded_at !== undefined) {
          db.beforeUpdate?.(records)
          if (db.failFinal) {
            db.failFinal = false
            return { error: new Error('Database response lost') }
          }
        }
        const matching = [...records.values()].filter((item) => filters.every((filter) => filter(item)))
        if (multiple) return { data: matching.map((row) => ({ ...row })) }
        const row = matching[0]
        if (!row) return { data: null }
        if (operation === 'update') Object.assign(row, values)
        return { data: { ...row } }
      }
      return query
    },
  }
  return db
}

test('blockchain service recovers broadcasts and refuses duplicate or retargeted evidence', async (t) => {
  const provider = new ethers.BrowserProvider(hre.network.provider)
  const owner = await provider.getSigner(0)
  const artifact = await hre.artifacts.readArtifact('SeafoodProvenance')
  const contract = await new ethers.ContractFactory(artifact.abi, artifact.bytecode, owner).deploy()
  await contract.waitForDeployment()
  const config = {
    blockchainRpcUrl: 'local-evm',
    blockchainContractAddress: await contract.getAddress(),
    blockchainPrivateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  }
  const db = database()
  let receiptFailure = false,
    broadcastFailure = false
  const service = createBlockchainService({
    db,
    config,
    providerFactory: () => {
      const connection = new ethers.BrowserProvider(hre.network.provider)
      if (receiptFailure)
        connection.getTransactionReceipt = async () => {
          throw new Error('Receipt RPC disconnected')
        }
      if (broadcastFailure)
        connection.broadcastTransaction = async () => {
          throw new Error('Stopped before broadcast')
        }
      return connection
    },
  })
  const input = (id) => ({
    batchId: 'batch',
    entityType: 'HARVEST',
    entityId: id,
    eventType: 'HARVEST_RECORDED',
    eventId: `HARVEST_RECORDED:${id}`,
    payload: { quantity: 12.5 },
  })
  try {
    await t.test('crash before broadcast recovers the exact stored signed transaction', async () => {
      broadcastFailure = true
      const first = await service.createRecord(input('before-send'))
      assert.equal(first.record.status, 'FAILED')
      assert.ok(first.record.signed_transaction)
      assert.equal(await contract.getDataHash(input('before-send').eventId), '')
      broadcastFailure = false
      const competingEvent = await service.createRecord(input('next-event'))
      assert.equal(competingEvent.record.status, 'PENDING')
      assert.equal(await contract.getDataHash(input('before-send').eventId), hashData(input('before-send').payload))
      const recovered = await service.createRecord(input('before-send'))
      assert.equal(recovered.record.status, 'SUCCESS')
      assert.equal(recovered.record.transaction_hash, first.record.transaction_hash)
      assert.equal((await contract.getRecord(input('before-send').eventId)).writeCount, 1n)
      assert.equal((await service.createRecord(input('next-event'))).record.status, 'SUCCESS')
    })
    await t.test('broadcast hash survives receipt RPC failure; retry reads existing evidence', async () => {
      receiptFailure = true
      const first = await service.createRecord(input('timeout'))
      assert.equal(first.record.status, 'FAILED')
      assert.ok(first.record.transaction_hash)
      receiptFailure = false
      const retry = await service.createRecord(input('timeout'))
      assert.equal(retry.record.status, 'SUCCESS')
      assert.equal(retry.record.transaction_hash, first.record.transaction_hash)
      assert.equal((await contract.getRecord(input('timeout').eventId)).writeCount, 1n)
    })
    await t.test('lost database finalization is recovered without another transaction', async () => {
      db.failFinal = true
      await assert.rejects(service.createRecord(input('db-loss')), /Database response lost/)
      const hash = db.records.get(input('db-loss').eventId).transaction_hash
      const result = await service.createRecord(input('db-loss'))
      assert.equal(result.record.status, 'SUCCESS')
      assert.equal(result.record.transaction_hash, hash)
      assert.equal((await contract.getRecord(input('db-loss').eventId)).writeCount, 1n)
      await assert.rejects(service.createRecord({ ...input('db-loss'), payload: { quantity: 99 } }), { status: 409 })
      await assert.rejects(service.createRecord({ ...input('db-loss'), batchId: 'foreign' }), { status: 409 })
    })
    await t.test('existing on-chain hash conflict cannot be overwritten', async () => {
      await (await contract.recordData(input('conflict').eventId, 'f'.repeat(64))).wait()
      const result = await service.createRecord(input('conflict'))
      assert.equal(result.record.status, 'FAILED')
      assert.equal(await contract.getDataHash(input('conflict').eventId), 'f'.repeat(64))
    })
    await t.test('pinned network and contract prevent automatic retargeting', async () => {
      for (const [id, pin] of [
        ['network', { chain_id: '1' }],
        ['address', { contract_address: ethers.ZeroAddress }],
      ]) {
        const event = input(id)
        db.records.set(event.eventId, {
          id: event.eventId,
          event_id: event.eventId,
          batch_id: event.batchId,
          entity_id: event.entityId,
          entity_type: event.entityType,
          event_type: event.eventType,
          data_hash: hashData(event.payload),
          status: 'FAILED',
          ...pin,
        })
        assert.equal((await service.createRecord(event)).record.status, 'FAILED')
        assert.equal(await contract.getDataHash(event.eventId), '')
      }
      await assert.rejects(
        service.getDataHashFromContract(input('timeout').eventId, config.blockchainContractAddress, '1'),
        { status: 503 },
      )
    })
    await t.test('a delayed failure cannot overwrite a concurrent SUCCESS or broadcast', async () => {
      const offline = createBlockchainService({ db, config: {} })
      db.beforeUpdate = (records) => {
        const row = records.get(input('race').eventId)
        Object.assign(row, { status: 'SUCCESS', transaction_hash: 'confirmed-tx' })
      }
      const result = await offline.createRecord(input('race'))
      assert.equal(result.record.status, 'SUCCESS')
      assert.equal(result.submitted, true)
      db.beforeUpdate = (records) => {
        const row = records.get(input('pending-race').eventId)
        row.transaction_hash = 'pending-tx'
      }
      assert.equal((await offline.createRecord(input('pending-race'))).record.transaction_hash, 'pending-tx')
      db.beforeUpdate = null
    })
  } finally {
    provider.destroy()
  }
})
