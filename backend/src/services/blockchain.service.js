const crypto = require('node:crypto')

const supabase = require('../config/supabase')
const env = require('../config/env')

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

/**
 * Băm dữ liệu thành SHA-256. Đây chính là "dấu vân tay" bất biến
 * được đưa lên chain để mọi người có thể kiểm chứng dữ liệu sau này.
 */
function hashData(payload) {
  const canonical = JSON.stringify(payload ?? {})
  return crypto.createHash('sha256').update(canonical).digest('hex')
}

function isContractConfigured() {
  return Boolean(env.blockchainRpcUrl && env.blockchainContractAddress)
}

/**
 * Điểm giao tiếp duy nhất với contract trong `blockchain/`.
 *
 * Hiện tại thư mục blockchain chỉ mới có scaffold (Hardhat/Foundry),
 * chưa có contract, nên service chạy ở chế độ "chờ đồng bộ":
 * - trả về chưa có transaction hash
 * - bản ghi được đánh dấu PENDING, không làm mất trạng thái
 *
 * Khi nào deploy xong contract, chỉ cần cấu hình:
 *   BLOCKCHAIN_RPC_URL=http://localhost:8545
 *   BLOCKCHAIN_CONTRACT_ADDRESS=0x...
 * và triển khai hàm submit tại đây là luồng tự kích hoạt.
 */
async function submitToContract({ payload, dataHash }) {
  void dataHash
  void payload

  if (!isContractConfigured()) {
    return {
      transactionHash: null,
      blockNumber: null,
      contractAddress: null,
    }
  }

  // TODO: thay thế bằng lời gọi ethers/web3 tới contract trong blockchain/
  return {
    transactionHash: null,
    blockNumber: null,
    contractAddress: env.blockchainContractAddress,
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

/**
 * Ghi một sự kiện "không thể sửa" vào chuỗi khối (bảng `blockchain_records`)
 * trong khi backend supabase giữ dữ liệu chi tiết ở các bảng nghiệp vụ.
 */
async function createRecord({ batchId, entityType, entityId, eventType, payload, status }) {
  assertEventType(eventType)
  assertStatus(status)

  const dataHash = hashData(payload)
  const chain = await submitToContract({ payload, dataHash })

  const { data, error } = await supabase
    .from('blockchain_records')
    .insert({
      batch_id: batchId,
      entity_type: entityType,
      entity_id: entityId,
      event_type: eventType,
      data_hash: dataHash,
      transaction_hash: chain.transactionHash,
      block_number: chain.blockNumber,
      contract_address: chain.contractAddress,
      status: status ?? 'PENDING',
      recorded_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (error) {
    throw error
  }

  return { record: data, submitted: chain.submitted, dataHash }
}

/**
 * Lấy chuỗi ghi nhận minh bạch của một lô hàng theo thứ tự thời gian.
 */
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
  hashData,
  SUPPORTED_EVENT_TYPES,
  SUPPORTED_STATUSES,
}