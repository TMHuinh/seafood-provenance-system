const crypto = require('node:crypto')
const { ethers } = require('ethers') // Import thêm thư viện ethers

const env = require('../../config/env')
const supabase = require('../../config/supabase')

const SUPPORTED_EVENT_TYPES = [
  'BATCH_CREATED',
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
    // 1. Kết nối mạng và ví
    const provider = new ethers.JsonRpcProvider(env.blockchainRpcUrl)
    const wallet = new ethers.Wallet(env.blockchainPrivateKey, provider)

    // 2. Khai báo ABI của Smart Contract (Phải khớp với code Solidity)
    const contractABI = [
      "function recordData(string id, string dataHash) public"
    ]
    const contract = new ethers.Contract(env.blockchainContractAddress, contractABI, wallet)

    // 3. Thực thi giao dịch (Gửi data lên Blockchain)
    const tx = await contract.recordData(eventId, dataHash)
    
    // 4. CHỜ MẠNG LƯỚI XÁC NHẬN (Cực kỳ quan trọng để đổi từ PENDING sang SUCCESS)
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
      status: 'FAILED'
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
  
  // Mỗi thực thể/sự kiện có khóa riêng, tránh các bản ghi cùng batch ghi đè nhau.
  const chain = await submitToContract({ eventId: resolvedEventId, dataHash })

  // Quyết định trạng thái cuối cùng dựa trên kết quả trả về từ Blockchain
  const finalStatus = chain.status || (status ?? 'PENDING')

  const { data, error } = await supabase
    .from('blockchain_records')
    .insert({
      batch_id: batchId,
      entity_type: entityType,
      entity_id: entityId,
      event_type: eventType,
      event_id: resolvedEventId,
      data_hash: dataHash,
      transaction_hash: chain.transactionHash,
      block_number: chain.blockNumber,
      contract_address: chain.contractAddress,
      status: finalStatus, // Lưu trạng thái SUCCESS hoặc PENDING vào DB
      recorded_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (error) {
    throw error
  }

  return { record: data, submitted: finalStatus === 'SUCCESS', dataHash }
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
