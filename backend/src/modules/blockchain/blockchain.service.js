const crypto = require('node:crypto')
const { ethers } = require('ethers')

const SUPPORTED_EVENT_TYPES = [
  'BATCH_CREATED',
  'BATCH_CORRECTED',
  'FARMING_LOG_RECORDED',
  'HARVEST_RECORDED',
  'TRANSPORT_RECORDED',
  'DISTRIBUTION_RECORDED',
  'QUALITY_INSPECTION_RECORDED',
  'OTHER',
]

const SUPPORTED_STATUSES = ['PENDING', 'SUCCESS', 'FAILED']
const PROOF_FIELDS = [
  'id', 'batch_id', 'entity_type', 'entity_id', 'event_type', 'event_id',
  'data_hash', 'transaction_hash', 'block_number', 'contract_address', 'chain_id',
  'status', 'recorded_at', 'created_at',
].join(',')

function hashData(payload) {
  const canonical = JSON.stringify(sortObjectKeys(payload ?? {}))
  return crypto.createHash('sha256').update(canonical).digest('hex')
}

function sortObjectKeys(value) {
  if (Array.isArray(value)) return value.map(sortObjectKeys)
  if (!value || typeof value !== 'object') return value

  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      result[key] = sortObjectKeys(value[key])
      return result
    }, {})
}

function hashLegacyData(payload) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(payload ?? {}))
    .digest('hex')
}

function buildEventId(eventType, entityId) {
  return `${eventType}:${entityId}`
}

function createBlockchainService({ db: supabase, config: env, providerFactory } = {}) {
  function isContractConfigured() {
    return Boolean(env.blockchainRpcUrl && env.blockchainContractAddress && env.blockchainPrivateKey)
  }

  function createProvider() {
    if (providerFactory) return providerFactory()
    const request = new ethers.FetchRequest(env.blockchainRpcUrl)
    request.timeout = 10000
    const provider = new ethers.JsonRpcProvider(request)
    provider.pollingInterval = 1000
    return provider
  }

  async function getDataHashFromContract(eventId, contractAddress = env.blockchainContractAddress, chainId) {
    if (!env.blockchainRpcUrl || !contractAddress) {
      const error = new Error('Thiếu cấu hình Blockchain RPC hoặc Contract Address')
      error.status = 503
      throw error
    }

    let provider
    try {
      provider = createProvider()
      if (chainId && String((await provider.getNetwork()).chainId) !== String(chainId))
        throw new Error('Wrong blockchain network')
      const code = await provider.getCode(contractAddress)
      if (code === '0x') return null
      const contract = new ethers.Contract(
        contractAddress,
        ['function getDataHash(string eventId) external view returns (string)'],
        provider,
      )

      return await contract.getDataHash(eventId)
    } catch (cause) {
      console.error('Không thể đọc dữ liệu Blockchain', { code: cause.code ?? null })
      const error = new Error('Không thể đọc dữ liệu từ Blockchain')
      error.status = 503
      throw error
    } finally {
      provider?.destroy()
    }
  }

  async function submitToContract({
    eventId,
    dataHash,
    contractAddress,
    chainId,
    transactionHash,
    onNetwork,
    onBroadcast,
  }) {
    if (!isContractConfigured()) {
      console.warn('Thiếu cấu hình Blockchain; bằng chứng đang chờ xử lý')
      return {
        transactionHash: null,
        blockNumber: null,
        contractAddress: env.blockchainContractAddress || null,
        status: 'PENDING',
      }
    }

    let provider, signerKey, signerToken
    try {
      provider = createProvider()
      const networkId = String((await provider.getNetwork()).chainId)
      if (chainId && String(chainId) !== networkId)
        throw new Error('Blockchain network differs from the original event')
      if (contractAddress && contractAddress.toLowerCase() !== env.blockchainContractAddress.toLowerCase()) {
        throw new Error('Contract differs from the original event; automatic migration is disabled')
      }
      contractAddress = contractAddress || env.blockchainContractAddress
      const wallet = new ethers.Wallet(env.blockchainPrivateKey, provider)
      signerKey = `${networkId}:${wallet.address.toLowerCase()}`
      const claimed = await supabase
        .rpc('claim_blockchain_signer', { p_key: signerKey })
        .abortSignal(AbortSignal.timeout(10000))
      if (claimed.error) throw claimed.error
      signerToken = claimed.data
      if (!signerToken)
        return { status: 'PENDING', contractAddress, chainId: networkId, error: 'Ví ký đang xử lý sự kiện khác' }
      const fresh = await onNetwork(networkId, contractAddress)
      transactionHash = fresh.transaction_hash
      const contractABI = [
        'function writers(address) view returns (bool)',
        'function recordData(string id, string dataHash) public',
        'function getDataHash(string eventId) external view returns (string)',
        'function getRecord(string eventId) external view returns (string dataHash, address recordedBy, uint256 timestamp, uint256 blockNumber, uint256 writeCount)',
      ]
      const readContract = new ethers.Contract(contractAddress, contractABI, provider)
      const onChainHash = await readContract.getDataHash(eventId)

      // Recover safely if the chain accepted a transaction but the API lost its response.
      if (onChainHash) {
        if (onChainHash !== dataHash) {
          return {
            transactionHash: null,
            blockNumber: null,
            contractAddress,
            chainId: networkId,
            status: 'FAILED',
            error: 'Event ID đã tồn tại trên blockchain với hash khác',
          }
        }
        const onChainRecord = await readContract.getRecord(eventId)
        return {
          transactionHash: transactionHash || null,
          blockNumber: Number(onChainRecord.blockNumber),
          contractAddress,
          chainId: networkId,
          status: 'SUCCESS',
        }
      }

      // Do not broadcast again while an earlier transaction is still pending or its outcome is unknown.
      if (transactionHash) {
        const receipt = await provider.getTransactionReceipt(transactionHash)
        if (!receipt) {
          // A process may have stopped after saving the signed transaction but before sending it.
          // Re-broadcasting the exact bytes preserves nonce/hash even if the first send was accepted.
          if (fresh.signed_transaction) {
            if (ethers.keccak256(fresh.signed_transaction) !== transactionHash)
              throw new Error('Signed transaction identity mismatch')
            const recovered = await provider.broadcastTransaction(fresh.signed_transaction)
            const confirmed = await recovered.wait(1, 90000)
            return {
              status: 'SUCCESS',
              transactionHash,
              blockNumber: confirmed.blockNumber,
              contractAddress,
              chainId: networkId,
            }
          }
          return {
            status: 'PENDING',
            transactionHash,
            contractAddress,
            chainId: networkId,
            error: 'Đang đối soát giao dịch đã gửi',
          }
        }
        if (receipt.status === 1) throw new Error('Confirmed transaction does not contain the expected event hash')
      }
      if (!(await readContract.writers(wallet.address))) throw new Error('Ví backend chưa được cấp quyền ghi contract')
      // Recover any reserved nonce before signing a different event. A process can
      // stop after persisting a signed transaction but before the RPC receives it.
      const unfinished = await supabase
        .from('blockchain_records')
        .select('event_id,transaction_hash,signed_transaction')
        .eq('chain_id', networkId)
        .eq('signer_address', wallet.address.toLowerCase())
        .neq('status', 'SUCCESS')
        .neq('event_id', eventId)
        .not('signed_transaction', 'is', null)
        .order('created_at')
        .limit(101)
      if (unfinished.error) throw unfinished.error
      if (unfinished.data.length > 100) throw new Error('Unresolved signer backlog requires reconciliation')
      for (const prior of unfinished.data) {
        if (await provider.getTransactionReceipt(prior.transaction_hash)) continue
        if (ethers.keccak256(prior.signed_transaction) !== prior.transaction_hash)
          throw new Error('Prior transaction identity mismatch')
        const recovered = await provider.broadcastTransaction(prior.signed_transaction)
        await recovered.wait(1, 90000)
        return {
          status: 'PENDING',
          contractAddress,
          chainId: networkId,
          error: 'Đã khôi phục giao dịch trước của ví; sự kiện này sẽ được thử tiếp',
        }
      }
      const contract = new ethers.Contract(contractAddress, contractABI, wallet)
      const request = await wallet.populateTransaction(await contract.recordData.populateTransaction(eventId, dataHash))
      const signed = await wallet.signTransaction(request)
      await onBroadcast(ethers.keccak256(signed), signed)
      const tx = await provider.broadcastTransaction(signed)
      const receipt = await tx.wait(1, 90000)

      return {
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        contractAddress,
        chainId: networkId,
        status: 'SUCCESS', // Đánh dấu thành công khi đã có biên lai
      }
    } catch (error) {
      console.error('Không thể gửi dữ liệu Blockchain', { code: error.code ?? null })
      return {
        transactionHash: null,
        blockNumber: null,
        contractAddress: contractAddress || env.blockchainContractAddress,
        chainId,
        status: 'FAILED',
        error: 'Giao dịch chưa được xác nhận. Hệ thống cần đối soát lại trước khi thử tiếp.',
      }
    } finally {
      if (signerToken) {
        try {
          const released = await supabase
            .rpc('release_blockchain_signer', { p_key: signerKey, p_token: signerToken })
            .abortSignal(AbortSignal.timeout(10000))
          if (released.error) throw released.error
        } catch {
          console.error('Không giải phóng được lease ví ký; lease sẽ tự hết hạn')
        }
      }
      provider?.destroy()
    }
  }

  function assertEventType(eventType) {
    if (!SUPPORTED_EVENT_TYPES.includes(eventType)) {
      const error = new Error(`Unsupported blockchain event type: ${eventType}`)
      error.status = 400
      throw error
    }
  }

  function assertStatus(status) {
    if (status !== undefined && !SUPPORTED_STATUSES.includes(status)) {
      const error = new Error(`Unsupported blockchain status: ${status}`)
      error.status = 400
      throw error
    }
  }

  async function createRecord({ batchId, entityType, entityId, eventType, eventId, payload, status }) {
    assertEventType(eventType)
    assertStatus(status)

    const dataHash = hashData(payload)
    const resolvedEventId = eventId ?? buildEventId(eventType, entityId)

    // Save a durable local record before broadcasting. A retry can then recover
    // the same event instead of creating another chain event or losing its status.
    const { data: existing, error: lookupError } = await supabase
      .from('blockchain_records')
      .select('*')
      .eq('event_id', resolvedEventId)
      .maybeSingle()
    if (lookupError) throw lookupError
    if (
      existing &&
      (existing.data_hash !== dataHash ||
        existing.batch_id !== batchId ||
        existing.entity_id !== entityId ||
        existing.entity_type !== entityType ||
        existing.event_type !== eventType)
    ) {
      const error = new Error('Event ID đã được dùng với dữ liệu khác')
      error.status = 409
      throw error
    }
    if (existing?.status === 'SUCCESS') return { record: existing, submitted: true, dataHash }

    let record = existing
    if (!record) {
      const { data, error } = await supabase
        .from('blockchain_records')
        .insert({
          batch_id: batchId,
          entity_type: entityType,
          entity_id: entityId,
          event_type: eventType,
          event_id: resolvedEventId,
          data_hash: dataHash,
          contract_address: env.blockchainContractAddress || null,
          status: 'PENDING',
        })
        .select()
        .single()
      if (error?.code === '23505')
        return createRecord({ batchId, entityType, entityId, eventType, eventId: resolvedEventId, payload, status })
      if (error) throw error
      record = data
    }

    const chain = await submitToContract({
      eventId: resolvedEventId,
      dataHash,
      contractAddress: record.contract_address,
      chainId: record.chain_id,
      transactionHash: record.transaction_hash,
      async onNetwork(networkId, address) {
        // Reload after acquiring the wallet lease: another worker may have broadcast meanwhile.
        const fresh = await supabase.from('blockchain_records').select('*').eq('id', record.id).single()
        if (fresh.error) throw fresh.error
        record = fresh.data
        if (record.chain_id && String(record.chain_id) !== networkId) throw new Error('Event network changed')
        if (record.contract_address && record.contract_address.toLowerCase() !== address.toLowerCase())
          throw new Error('Event contract changed')
        const { error } = await supabase
          .from('blockchain_records')
          .update({ chain_id: networkId, contract_address: address })
          .eq('id', record.id)
        if (error) throw error
        record.chain_id = networkId
        record.contract_address = address
        return record
      },
      async onBroadcast(hash, signed) {
        // Commit the identity before broadcast, closing the crash gap between send and DB save.
        record.transaction_hash = hash
        const { error } = await supabase
          .from('blockchain_records')
          .update({
            transaction_hash: hash,
            signed_transaction: signed,
            signer_address: ethers.Transaction.from(signed).from.toLowerCase(),
          })
          .eq('id', record.id)
        if (error) throw error
      },
    })
    const finalStatus = chain.status || status || 'PENDING'
    let finalQuery = supabase
      .from('blockchain_records')
      .update({
        transaction_hash: chain.transactionHash || record.transaction_hash || null,
        block_number: chain.blockNumber ?? record.block_number ?? null,
        contract_address: record.contract_address || chain.contractAddress || null,
        chain_id: record.chain_id || chain.chainId || null,
        status: finalStatus,
        recorded_at: finalStatus === 'SUCCESS' ? new Date().toISOString() : null,
      })
      .eq('id', record.id)
      .neq('status', 'SUCCESS')
      .eq('status', record.status)
    // A caller that could not acquire the signer must not erase another caller's broadcast.
    finalQuery = record.transaction_hash
      ? finalQuery.eq('transaction_hash', record.transaction_hash)
      : finalQuery.is('transaction_hash', null)
    let { data, error } = await finalQuery.select().maybeSingle()
    if (error) throw error
    if (!data) {
      const fresh = await supabase.from('blockchain_records').select('*').eq('id', record.id).single()
      if (fresh.error) throw fresh.error
      data = fresh.data
    }

    return {
      record: data,
      submitted: data.status === 'SUCCESS',
      dataHash,
      error: data.status === 'SUCCESS' ? null : (chain.error ?? null),
    }
  }

  async function getRecordsByBatch(batchId) {
    const { data, error } = await supabase
      .from('blockchain_records')
      .select(PROOF_FIELDS)
      .eq('batch_id', batchId)
      .order('recorded_at', { ascending: true })
      .order('created_at', { ascending: true })

    if (error) {
      throw error
    }

    return data
  }

  return {
    createRecord,
    getRecordsByBatch,
    getDataHashFromContract,
    hashData,
    hashLegacyData,
    buildEventId,
    SUPPORTED_EVENT_TYPES,
    SUPPORTED_STATUSES,
  }
}

let singleton
const instance = () =>
  (singleton ||= createBlockchainService({ db: require('../../config/supabase'), config: require('../../config/env') }))
module.exports = {
  createBlockchainService,
  hashData,
  hashLegacyData,
  buildEventId,
  SUPPORTED_EVENT_TYPES,
  SUPPORTED_STATUSES,
  createRecord: (...args) => instance().createRecord(...args),
  getRecordsByBatch: (...args) => instance().getRecordsByBatch(...args),
  getDataHashFromContract: (...args) => instance().getDataHashFromContract(...args),
}
