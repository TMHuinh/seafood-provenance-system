const supabase = require('../../config/supabase')
const blockchain = require('../blockchain/blockchain.service')
const batches = require('../batches/batches.repository')
const { requireOwnedPond } = require('../batches/batches.service')
const { requirePondAction } = require('../ponds/pond-access')

function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function accessible(profile, farmId, pondId, id, action) {
  await requireOwnedPond(profile, farmId, pondId, action)
  if (!uuid.test(id)) fail('Mã vụ nuôi không hợp lệ')
  const batch = await batches.findById(id)
  if (!batch || batch.pond_id !== pondId) fail('Không tìm thấy vụ nuôi', 404)
  return batch
}

async function list(profile, farmId, pondId, id) {
  const batch = await accessible(profile, farmId, pondId, id, 'READ')
  const [lots, drafts, records, people] = await Promise.all([
    supabase.from('harvest_lots').select('*, harvest:harvests(*)').eq('batch_id', id).order('created_at', { ascending: false }).order('id'),
    supabase.from('harvest_drafts').select('*, author:user_profiles!harvest_drafts_created_by_fkey(full_name)')
      .eq('batch_id', id).is('confirmed_harvest_id', null).order('created_at', { ascending: false }),
    blockchain.getRecordsByBatch(id),
    supabase.rpc('harvest_actor_names', { p_actor: profile.id, p_batch: id, p_pond: pondId }),
  ])
  if (lots.error) throw lots.error
  if (drafts.error) throw drafts.error
  if (people.error) throw people.error
  const byEventId = new Map(records.map(record => [record.event_id, record]))
  const byHarvestId = new Map(people.data.map(({ harvest_id, ...names }) => [harvest_id, names]))
  return {
    can_create_transport: batch.pond?.farm?.owner_id === profile.id,
    items: lots.data.map(lot => ({
      ...lot,
      harvest: { author_name: null, confirmer_name: null, ...lot.harvest, ...byHarvestId.get(lot.harvest_id) },
      blockchain: byEventId.get(lot.blockchain_event_id) ?? null,
    })),
    drafts: drafts.data.map(({ author, confirmed_harvest_id, ...draft }) => ({ ...draft, author_name: author?.full_name ?? null })),
  }
}

function normalizeHarvest(input) {
  const date = String(input?.harvestDate ?? '')
  const parsed = new Date(`${date}T00:00:00+07:00`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) ||
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(parsed) !== date) fail('Ngày thu hoạch không hợp lệ')
  if (typeof input.quantity !== 'number' || !Number.isFinite(input.quantity) || input.quantity <= 0 ||
    input.quantity > 999999999999.99 || Math.abs(input.quantity * 100 - Math.round(input.quantity * 100)) > 0.001) fail('Khối lượng phải lớn hơn 0 và có tối đa 2 chữ số thập phân')
  if (typeof input.isFinal !== 'boolean') fail('Vui lòng chọn loại thu hoạch')
  const note = String(input.note ?? '').trim()
  if (note.length > 5000) fail('Ghi chú không được vượt quá 5000 ký tự')
  return { p_date: date, p_quantity: input.quantity, p_final: input.isFinal, p_note: note || null }
}

function requestId(input) {
  if (!uuid.test(String(input?.requestId))) fail('Mã yêu cầu không hợp lệ')
  return input.requestId
}

function draftVersion(id, input) {
  if (!uuid.test(String(id))) fail('Mã bản nháp không hợp lệ')
  if (!Number.isInteger(input?.expectedVersion) || input.expectedVersion < 1 || input.expectedVersion > 2147483647) {
    fail('Phiên bản bản nháp không hợp lệ')
  }
  return { p_draft: id, p_version: input.expectedVersion }
}

async function callHarvestRpc(profile, pondId, batchId, method, args) {
  const { data, error } = await supabase.rpc(method, { p_batch: batchId, p_pond: pondId, p_actor: profile.id, ...args })
  if (error) {
    if (error.code === 'P0002') fail('Không tìm thấy dữ liệu thu hoạch', 404)
    if (error.code === '40001' || error.code === 'PT409') fail('Dữ liệu thu hoạch đã thay đổi hoặc vụ chưa thể thu hoạch. Vui lòng tải lại', 409)
    if (error.code === '23505') fail('Mã yêu cầu đã được dùng. Vui lòng tải lại các lô hàng', 409)
    if (error.code === '22023') fail('Ngày thu hoạch hoặc dữ liệu không hợp lệ', 400)
    throw error
  }
  return data
}

async function withBlockchain(id, data) {
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

async function create(profile, farmId, pondId, id, input) {
  await accessible(profile, farmId, pondId, id, 'HARVEST_CREATE')
  await requirePondAction(profile, pondId, 'HARVEST_CONFIRM')
  const data = await callHarvestRpc(profile, pondId, id, 'record_batch_harvest', {
    p_request: requestId(input), ...normalizeHarvest(input),
  })
  return withBlockchain(id, data)
}

async function createDraft(profile, farmId, pondId, id, input) {
  await accessible(profile, farmId, pondId, id, 'HARVEST_CREATE')
  const draft = await callHarvestRpc(profile, pondId, id, 'create_harvest_draft', {
    p_request: requestId(input), ...normalizeHarvest(input),
  })
  return { ...draft, author_name: profile.full_name ?? null }
}

async function editDraft(profile, farmId, pondId, id, draftId, input) {
  await accessible(profile, farmId, pondId, id, 'HARVEST_EDIT')
  return callHarvestRpc(profile, pondId, id, 'edit_harvest_draft', { ...draftVersion(draftId, input), ...normalizeHarvest(input) })
}

async function confirmDraft(profile, farmId, pondId, id, draftId, input) {
  await accessible(profile, farmId, pondId, id, 'HARVEST_CONFIRM')
  const data = await callHarvestRpc(profile, pondId, id, 'confirm_harvest_draft', draftVersion(draftId, input))
  return withBlockchain(id, data)
}

module.exports = { list, create, createDraft, editDraft, confirmDraft }
