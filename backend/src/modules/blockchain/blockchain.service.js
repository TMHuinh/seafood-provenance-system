const crypto = require('node:crypto')
const { ethers } = require('ethers') // Import thêm thư viện ethers

const env = require('../../config/env')
const supabase = require('../../config/supabase')

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
  return crypto.createHash('sha256').update(JSON.stringify(payload ?? {})).digest('hex')
}

function buildEventId(eventType, entityId) {
  return `${eventType}:${entityId}`
}

// Cập nhật hàm kiểm tra cấu hình để check cả Private Key
function isContractConfigured() {
  return Boolean(env.blockchainRpcUrl && env.blockchainContractAddress && env.blockchainPrivateKey)
}

function isContractReadable() {
  return Boolean(env.blockchainRpcUrl && env.blockchainContractAddress)
}

async function getDataHashFromContract(eventId, contractAddress = env.blockchainContractAddress) {
  if (!env.blockchainRpcUrl || !contractAddress) {
    const error = new Error('Thiếu cấu hình Blockchain RPC hoặc Contract Address')
    error.status = 503
    throw error
  }

  try {
    const provider = new ethers.JsonRpcProvider(env.blockchainRpcUrl)
    const code = await provider.getCode(contractAddress)
    if (code === '0x') return null
    const contract = new ethers.Contract(
      contractAddress,
      ['function getDataHash(string eventId) external view returns (string)'],
      provider,
    )

    return await contract.getDataHash(eventId)
  } catch (cause) {
    console.error('❌ Lỗi khi đọc dữ liệu từ Smart Contract:', cause)
    const error = new Error('Không thể đọc dữ liệu từ Blockchain')
    error.status = 503
    error.cause = cause
    throw error
  }
}

// Hoàn thiện logic gọi Smart Contract bằng Ethers.js
async function submitToContract({ eventId, dataHash }) {
  if (!isContractConfigured()) {
    console.warn('⚠️ Thiếu cấu hình Blockchain (RPC, Contract, hoặc Private Key). Đang dùng Mock data.')
    return {
      transactionHash: null,
      blockNumber: null,
      contractAddress: env.blockchainContractAddress || null,
      status: 'PENDING'
    }
  }

  try {
    const provider = new ethers.JsonRpcProvider(env.blockchainRpcUrl)
    const wallet = new ethers.Wallet(env.blockchainPrivateKey, provider)
    const contractABI = [
      'function recordData(string id, string dataHash) public',
      'function getDataHash(string eventId) external view returns (string)',
      'function getRecord(string eventId) external view returns (string dataHash, address recordedBy, uint256 timestamp, uint256 blockNumber, uint256 writeCount)',
    ]
    const readContract = new ethers.Contract(env.blockchainContractAddress, contractABI, provider)
    const onChainHash = await readContract.getDataHash(eventId)

    // Recover safely if the chain accepted a transaction but the API lost its response.
    if (onChainHash) {
      if (onChainHash !== dataHash) {
        return {
          transactionHash: null,
          blockNumber: null,
          contractAddress: env.blockchainContractAddress,
          status: 'FAILED',
          error: 'Event ID đã tồn tại trên blockchain với hash khác',
        }
      }
      const onChainRecord = await readContract.getRecord(eventId)
      return {
        transactionHash: null,
        blockNumber: Number(onChainRecord.blockNumber),
        contractAddress: env.blockchainContractAddress,
        status: 'SUCCESS',
      }
    }

    const contract = new ethers.Contract(env.blockchainContractAddress, contractABI, wallet)
    const tx = await contract.recordData(eventId, dataHash)
    const receipt = await tx.wait()

    return {
      transactionHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      contractAddress: env.blockchainContractAddress,
      status: 'SUCCESS' // Đánh dấu thành công khi đã có biên lai
    }
  } catch (error) {
    console.error('❌ Lỗi khi gửi giao dịch Smart Contract:', error)
    return {
      transactionHash: null,
      blockNumber: null,
      contractAddress: env.blockchainContractAddress,
      status: 'FAILED',
      error: error instanceof Error ? error.message : String(error),
    }
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
  if (existing && existing.data_hash !== dataHash) {
    const error = new Error('Event ID đã được dùng với dữ liệu khác')
    error.status = 409
    throw error
  }
  if (existing?.status === 'SUCCESS') return { record: existing, submitted: true, dataHash }

  let record = existing
  if (record) {
    const { data, error } = await supabase
      .from('blockchain_records')
      .update({ status: 'PENDING', transaction_hash: null, block_number: null, contract_address: env.blockchainContractAddress || null })
      .eq('id', record.id)
      .select()
      .single()
    if (error) throw error
    record = data
  } else {
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
    if (error) throw error
    record = data
  }

  const chain = await submitToContract({ eventId: resolvedEventId, dataHash })
  const finalStatus = chain.status || status || 'PENDING'
  const { data, error } = await supabase
    .from('blockchain_records')
    .update({
      transaction_hash: chain.transactionHash,
      block_number: chain.blockNumber,
      contract_address: chain.contractAddress,
      status: finalStatus,
      recorded_at: finalStatus === 'SUCCESS' ? new Date().toISOString() : null,
    })
    .eq('id', record.id)
    .select()
    .single()
  if (error) throw error

  return { record: data, submitted: finalStatus === 'SUCCESS', dataHash, error: chain.error ?? null }
}

async function getRecordsByBatch(batchId, select = '*') {
  const { data, error } = await supabase
    .from('blockchain_records')
    .select(select)
    .eq('batch_id', batchId)
    .order('recorded_at', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) {
    throw error
  }

  return data
}

module.exports = {
  createRecord,
  getRecordsByBatch,
  getDataHashFromContract,
  hashData,
  hashLegacyData,
  buildEventId,
  SUPPORTED_EVENT_TYPES,
  SUPPORTED_STATUSES,
}
