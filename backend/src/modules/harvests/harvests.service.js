const supabase = require('../../config/supabase')
const blockchain = require('../blockchain/blockchain.service')
const batches = require('../batches/batches.repository')
const { requireOwnedPond } = require('../batches/batches.service')

function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function accessible(profile, farmId, pondId, id) {
  await requireOwnedPond(profile, farmId, pondId)
  if (!uuid.test(id)) fail('Mã vụ nuôi không hợp lệ')
  const batch = await batches.findById(id)
  if (!batch || batch.pond_id !== pondId) fail('Không tìm thấy vụ nuôi', 404)
  return batch
}

async function list(profile, farmId, pondId, id) {
  await accessible(profile, farmId, pondId, id)
  const { data, error } = await supabase.from('harvest_lots')
    .select('*, harvest:harvests(*)').eq('batch_id', id).order('created_at', { ascending: false })
  if (error) throw error
  const records = await blockchain.getRecordsByBatch(id)
  return { items: data.map((lot) => ({ ...lot,
    blockchain: records.find((record) => record.event_id === lot.blockchain_event_id) ?? null,
  })) }
}

async function create(profile, farmId, pondId, id, input) {
  await accessible(profile, farmId, pondId, id)
  if (!uuid.test(String(input?.requestId))) fail('Mã yêu cầu không hợp lệ')
  const date = String(input?.harvestDate ?? '')
  const parsed = new Date(`${date}T00:00:00+07:00`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) ||
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(parsed) !== date) fail('Ngày thu hoạch không hợp lệ')
  if (typeof input.quantity !== 'number' || !Number.isFinite(input.quantity) || input.quantity <= 0 ||
    input.quantity > 999999999999.99 || Math.abs(input.quantity * 100 - Math.round(input.quantity * 100)) > 0.001) fail('Khối lượng phải lớn hơn 0 và có tối đa 2 chữ số thập phân')
  if (typeof input.isFinal !== 'boolean') fail('Vui lòng chọn loại thu hoạch')
  const note = String(input.note ?? '').trim()
  if (note.length > 5000) fail('Ghi chú không được vượt quá 5000 ký tự')
  const { data, error } = await supabase.rpc('record_batch_harvest', {
    p_batch: id, p_pond: pondId, p_actor: profile.id, p_request: input.requestId,
    p_date: date, p_quantity: input.quantity, p_final: input.isFinal, p_note: note || null,
  })
  if (error) {
    if (error.code === 'P0002') fail('Không tìm thấy vụ nuôi', 404)
    if (error.code === '40001' || error.code === 'PT409') fail('Vụ đã kết thúc, chưa sẵn sàng thu hoạch hoặc mã yêu cầu đã được dùng với dữ liệu khác', 409)
    if (error.code === '23505') fail('Mã yêu cầu đã được dùng. Vui lòng tải lại các lô hàng', 409)
    if (error.code === '22023') fail('Ngày thu hoạch hoặc dữ liệu không hợp lệ', 400)
    throw error
  }
  let proof = { status: 'UNKNOWN', transactionHash: null, dataHash: blockchain.hashData(data.lot.provenance) }
  try {
    // A replay only reads the previous outcome; it must never resubmit an uncertain transaction.
    const record = data.replayed
      ? (await blockchain.getRecordsByBatch(id)).find((item) => item.event_id === data.lot.blockchain_event_id)
      : (await blockchain.createRecord({ batchId: id, entityType: 'HARVEST', entityId: data.harvest.id,
          eventType: 'HARVEST_RECORDED', eventId: data.lot.blockchain_event_id, payload: data.lot.provenance })).record
    if (record) proof = { status: record.status, transactionHash: record.transaction_hash, dataHash: record.data_hash }
  } catch (error) { console.error('Không thể lưu kết quả blockchain của thu hoạch:', error) }
  return { ...data, blockchain: proof }
}

module.exports = { list, create }
