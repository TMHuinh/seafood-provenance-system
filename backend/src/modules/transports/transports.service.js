const { randomUUID } = require('node:crypto')
const supabase = require('../../config/supabase')
const blockchain = require('../blockchain/blockchain.service')
const batches = require('../batches/batches.repository')
const { requireOwnedPond } = require('../batches/batches.service')
const outbox = require('./transports.outbox')
const { invalid: fail, number, only, optionalNumber, optionalText, record, requiredText, timestamp, uuid } = require('./transports.validation')
const FIELDS = 'id, batch_id, harvest_lot_id, created_by, recipient_organization_id, handler_id, claimed_at, delivery_reported_at, delivery_reported_by, delivery_report, transport_code, transport_date, vehicle, driver, from_location, to_location, temperature, quantity, status, note, request_id, created_at, updated_at'
const STATUSES = ['IN_TRANSIT', 'CANCELLED']
const TRACKING_STATUSES = ['PICKED_UP', 'IN_TRANSIT', 'AT_SORTING_FACILITY', 'DEPARTED_FACILITY', 'OUT_FOR_DELIVERY', 'DELIVERY_ATTEMPT_FAILED', 'DELIVERED_REPORTED', 'OTHER']
const EVENT_FIELDS = 'id, transport_id, batch_id, sequence, event_id, event_type, actor_id, occurred_at, payload, previous_hash, data_hash, blockchain_status, transaction_hash, block_number, contract_address, attempt_count, last_error, recorded_at'
function requireTransporter(profile) { if (profile.role !== 'TRANSPORTER') fail('Chỉ tài khoản người vận chuyển mới dùng được chức năng này', 403) }
async function accessible(profile, farmId, pondId, batchId, lotId) {
  await requireOwnedPond(profile, farmId, pondId)
  uuid(batchId, 'Mã vụ nuôi')
  uuid(lotId, 'Mã lô')
  const batch = await batches.findById(batchId)
  if (!batch || batch.pond_id !== pondId) fail('Không tìm thấy vụ nuôi', 404)
  const { data, error } = await supabase.from('harvest_lots').select('id, batch_id, lot_code, quantity, status').eq('id', lotId).eq('batch_id', batchId).maybeSingle()
  if (error) throw error
  if (!data) fail('Không tìm thấy lô thu hoạch', 404)
  return data
}
async function attachEvents(items) {
  if (!items.length) return items
  const ids = items.map((item) => item.id)
  const { data, error } = await supabase.from('transport_events')
    .select(EVENT_FIELDS).in('transport_id', ids).order('sequence', { ascending: true })
  if (error) throw error
  const grouped = new Map()
  for (const event of data ?? []) {
    const list = grouped.get(event.transport_id) ?? []
    list.push(event)
    grouped.set(event.transport_id, list)
  }
  return items.map((item) => ({ ...item, events: grouped.get(item.id) ?? [] }))
}
async function list(profile, farmId, pondId, batchId, lotId) {
  await accessible(profile, farmId, pondId, batchId, lotId)
  const { data, error } = await supabase.from('transport_logs').select(FIELDS).eq('harvest_lot_id', lotId).order('transport_date', { ascending: false })
  if (error) throw error
  const records = await blockchain.getRecordsByBatch(batchId)
  const items = await attachEvents(data ?? [])
  return { items: items.map((item) => ({
    ...item,
    blockchain: item.events.length ? {
      status: item.events[item.events.length - 1].blockchain_status,
      transaction_hash: item.events[item.events.length - 1].transaction_hash,
      data_hash: item.events[item.events.length - 1].data_hash,
    } : records.find((record) => record.event_id === `TRANSPORT_RECORDED:${item.id}`) ?? null,
  })) }
}
async function listRecipients(profile) {
  if (profile.role !== 'FARMER' && profile.role !== 'ADMIN') fail('Chỉ chủ cơ sở mới được chọn nơi nhận hàng', 403)
  const { data, error } = await supabase.from('user_profiles')
    .select('organization_id, organization:organizations(id, name, address, status)')
    .eq('role', 'DISTRIBUTOR').eq('status', true).not('organization_id', 'is', null)
  if (error) throw error
  const recipients = new Map()
  for (const row of data ?? []) {
    const organization = row.organization
    if (organization?.id && organization.status) recipients.set(organization.id, {
      id: organization.id, name: organization.name, address: organization.address,
    })
  }
  return { items: [...recipients.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi')) }
}
async function create(profile, farmId, pondId, batchId, lotId, input = {}) {
  if (profile.role !== 'FARMER' && profile.role !== 'ADMIN') fail('Chỉ chủ cơ sở mới được tạo yêu cầu vận chuyển', 403)
  input = only(record(input), ['requestId', 'recipientOrganizationId', 'quantity', 'transportDate', 'transportCode', 'fromLocation', 'toLocation', 'note'])
  const lot = await accessible(profile, farmId, pondId, batchId, lotId)
  const recipientOrganizationId = uuid(input.recipientOrganizationId, 'Nhà phân phối nhận hàng')
  const { data: recipientOrganization, error: recipientError } = await supabase.from('organizations')
    .select('id, name, address').eq('id', recipientOrganizationId).eq('status', true).maybeSingle()
  if (recipientError) throw recipientError
  if (!recipientOrganization) fail('Không tìm thấy nhà phân phối đang hoạt động', 404)
  const { data: distributor, error: distributorError } = await supabase.from('user_profiles')
    .select('id').eq('organization_id', recipientOrganizationId).eq('role', 'DISTRIBUTOR').eq('status', true).limit(1).maybeSingle()
  if (distributorError) throw distributorError
  if (!distributor) fail('Tổ chức này chưa có tài khoản nhà phân phối hoạt động')
  const requestId = input.requestId == null ? randomUUID() : uuid(input.requestId, 'Mã yêu cầu')
  const quantity = number(input.quantity, 'Khối lượng vận chuyển', { min: 0.01, max: 999999999999.99, decimals: 2 })
  if (quantity > Number(lot.quantity)) fail('Khối lượng vận chuyển không được vượt quá khối lượng lô')
  const transportDate = timestamp(input.transportDate, 'Thời gian vận chuyển')
  const transportCode = requiredText(input.transportCode, 'Mã chuyến', { max: 100 })
  const fromLocation = requiredText(input.fromLocation, 'Điểm đi', { max: 500 })
  const toLocation = requiredText(input.toLocation, 'Điểm đến', { max: 500 })
  if (fromLocation.localeCompare(toLocation, 'vi', { sensitivity: 'base' }) === 0) fail('Điểm đi và điểm đến phải khác nhau')
  const note = optionalText(input.note, 'Ghi chú', 5000)
  const trip = {
    batch_id: batchId, harvest_lot_id: lotId, created_by: profile.id, handler_id: null,
    transport_code: transportCode, transport_date: transportDate, vehicle: null, driver: null,
    from_location: fromLocation, to_location: toLocation, temperature: null,
    quantity, status: 'PLANNING', note, request_id: requestId,
  }
  const { data: saved, error } = await supabase.rpc('record_lot_transport', {
    p_batch: batchId, p_lot: lotId, p_actor: profile.id, p_request: requestId, p_code: trip.transport_code,
    p_date: trip.transport_date, p_quantity: quantity, p_vehicle: trip.vehicle, p_driver: trip.driver,
    p_from: trip.from_location, p_to: trip.to_location, p_temperature: null, p_note: trip.note,
    p_recipient_organization: recipientOrganizationId,
  })
  if (error?.code === 'P0002') fail('Không tìm thấy lô thu hoạch', 404)
  if (error?.code === '40001') fail('Mã yêu cầu đã được dùng với dữ liệu khác', 409)
  if (error?.code === '23505') fail('Mã chuyến hoặc mã yêu cầu đã được sử dụng', 409)
  if (error?.code === '23514') fail('Nhà phân phối đã chọn không còn tài khoản hoạt động', 409)
  if (error?.code === '22023') fail('Tổng khối lượng các chuyến không được vượt quá khối lượng lô', 409)
  if (error) throw error
  const data = saved.transport
  if (!saved.replayed) outbox.nudge()
  const [withEvents] = await attachEvents([data])
  const latestEvent = withEvents.events[withEvents.events.length - 1]
  return {
    transport: withEvents,
    replayed: Boolean(saved.replayed),
    blockchain: latestEvent ? {
      status: latestEvent.blockchain_status,
      transaction_hash: latestEvent.transaction_hash,
      data_hash: latestEvent.data_hash,
    } : { status: 'PENDING', transaction_hash: null, data_hash: null },
  }
}
async function updateTransporterStatus(profile, transportId, input = {}) {
  requireTransporter(profile)
  uuid(transportId, 'Mã chuyến vận chuyển')
  input = only(record(input), ['status', 'vehicle', 'driver', 'temperature', 'cancellationReason'])
  const status = requiredText(input.status, 'Trạng thái chuyến', { max: 20 })
  if (!STATUSES.includes(status)) fail('Trạng thái vận chuyển không hợp lệ')
  const vehicle = optionalText(input.vehicle, 'Phương tiện', 255)
  const driver = optionalText(input.driver, 'Tài xế', 255)
  const temperature = optionalNumber(input.temperature, 'Nhiệt độ', { min: -100, max: 100, decimals: 2 })
  if (status === 'IN_TRANSIT' && (!vehicle || !driver)) fail('Cần nhập phương tiện và tài xế trước khi bắt đầu vận chuyển')
  const evidence = {}
  if (status === 'CANCELLED') evidence.cancellationReason = requiredText(input.cancellationReason, 'Lý do hủy', { min: 3, max: 1000 })
  const { data, error } = await supabase.rpc('update_lot_transport_status', {
    p_transport: transportId,
    p_actor: profile.id,
    p_status: status,
    p_vehicle: vehicle,
    p_driver: driver,
    p_temperature: temperature,
    p_temperature_supplied: input.temperature !== undefined,
    p_evidence: evidence,
  })
  if (error?.code === '42501') fail('Bạn không có quyền cập nhật chuyến này', 403)
  if (error?.code === '40001') fail('Chuyến đã thay đổi trạng thái hoặc không thể chuyển theo bước này', 409)
  if (error?.code === 'P0002') fail('Không tìm thấy chuyến vận chuyển', 404)
  if (error?.code === '22023') fail('Thiếu thông tin bắt buộc hoặc dữ liệu trạng thái chưa hợp lệ')
  if (error) throw error
  outbox.nudge()
  return { transport: data.transport, event_id: data.event_id }
}

async function confirmDelivery(profile, transportId, input = {}) {
  if (profile.role !== 'DISTRIBUTOR' || !profile.organization_id) fail('Chỉ nhà phân phối nhận chuyến mới được xác nhận nhận hàng', 403)
  uuid(transportId, 'Mã chuyến vận chuyển')
  input = only(record(input), ['note'])
  const { data: target, error: targetError } = await supabase.from('transport_logs')
    .select('id').eq('id', transportId).eq('recipient_organization_id', profile.organization_id).maybeSingle()
  if (targetError) throw targetError
  if (!target) fail('Chuyến này không được gửi tới nhà phân phối của bạn', 404)
  const note = optionalText(input.note, 'Ghi chú xác nhận', 1000)
  const { data, error } = await supabase.rpc('confirm_lot_transport_delivery', {
    p_transport: transportId, p_actor: profile.id, p_confirmation_note: note,
  })
  if (error?.code === '42501') fail('Chỉ nhà phân phối nhận chuyến mới được xác nhận', 403)
  if (error?.code === '40001') fail('Chuyến chưa có báo giao đang chờ xác nhận', 409)
  if (error?.code === 'P0002') fail('Không tìm thấy chuyến vận chuyển', 404)
  if (error?.code === '22023') fail('Ghi chú xác nhận quá dài')
  if (error) throw error
  outbox.nudge()
  return { transport: data.transport, event_id: data.event_id }
}

async function assignRecipient(profile, transportId, input = {}) {
  if (profile.role !== 'FARMER' && profile.role !== 'ADMIN') fail('Chỉ cơ sở tạo yêu cầu mới được gán nhà phân phối nhận hàng', 403)
  uuid(transportId, 'Mã chuyến vận chuyển')
  input = only(record(input), ['recipientOrganizationId'])
  const recipientOrganizationId = uuid(input.recipientOrganizationId, 'Nhà phân phối nhận hàng')
  const { data: target, error: targetError } = await supabase.from('transport_logs')
    .select('id').eq('id', transportId).eq('created_by', profile.id).is('recipient_organization_id', null).maybeSingle()
  if (targetError) throw targetError
  if (!target && profile.role !== 'ADMIN') fail('Chỉ cơ sở tạo yêu cầu có thể gán người nhận chuyến này', 403)
  const { data, error } = await supabase.rpc('assign_lot_transport_recipient', {
    p_transport: transportId, p_actor: profile.id, p_recipient_organization: recipientOrganizationId,
  })
  if (error?.code === '42501') fail('Chỉ cơ sở tạo yêu cầu có thể gán nhà phân phối nhận hàng', 403)
  if (error?.code === '40001') fail('Chuyến đã có nhà phân phối nhận hoặc đã kết thúc', 409)
  if (error?.code === 'P0002') fail('Không tìm thấy chuyến vận chuyển', 404)
  if (error?.code === '23514') fail('Nhà phân phối đã chọn không còn tài khoản hoạt động', 409)
  if (error) throw error
  outbox.nudge()
  return { transport: data.transport, event_id: data.event_id }
}

async function receivingDashboard(profile) {
  if (profile.role !== 'DISTRIBUTOR' || !profile.organization_id) fail('Tài khoản chưa liên kết với nhà phân phối', 403)
  const relation = 'lot:harvest_lots(id, lot_code, quantity, provenance)'
  const { data, error } = await supabase.from('transport_logs').select(`${FIELDS}, ${relation}`)
    .eq('recipient_organization_id', profile.organization_id).order('transport_date', { ascending: false }).limit(100)
  if (error) throw error
  const items = await attachEvents(data ?? [])
  return { items: items.map((job) => ({ ...job, lot: job.lot ? {
    id: job.lot.id, lot_code: job.lot.lot_code, quantity: job.lot.quantity,
    provenance: {
      farm: { name: job.lot.provenance?.farm?.name ?? 'Cơ sở nuôi' },
      batch: { batch_code: job.lot.provenance?.batch?.batch_code ?? '' },
    },
  } : null })) }
}

async function recordCheckpoint(profile, transportId, input = {}) {
  requireTransporter(profile)
  uuid(transportId, 'Mã chuyến vận chuyển')
  input = only(record(input), ['temperature', 'location', 'note'])
  const temperature = number(input.temperature, 'Nhiệt độ', { min: -100, max: 100, decimals: 2 })
  const location = optionalText(input.location, 'Vị trí kiểm tra', 500)
  const note = optionalText(input.note, 'Ghi chú điểm kiểm tra', 1000)
  const { data, error } = await supabase.rpc('record_transport_checkpoint', {
    p_transport: transportId, p_actor: profile.id, p_temperature: temperature,
    p_location: location, p_note: note,
  })
  if (error?.code === '42501') fail('Bạn không có quyền cập nhật chuyến này', 403)
  if (error?.code === '40001') fail('Chỉ được ghi nhận kiểm tra khi chuyến đang vận chuyển', 409)
  if (error?.code === 'P0002') fail('Không tìm thấy chuyến vận chuyển', 404)
  if (error?.code === '22023') fail('Thông tin điểm kiểm tra chưa hợp lệ')
  if (error) throw error
  outbox.nudge()
  return { transport: data.transport, event_id: data.event_id }
}

async function recordTrackingUpdate(profile, transportId, input = {}) {
  requireTransporter(profile)
  uuid(transportId, 'Mã chuyến vận chuyển')
  input = only(record(input), ['trackingStatus', 'location', 'temperature', 'note'])
  const trackingStatus = requiredText(input.trackingStatus, 'Trạng thái hành trình', { max: 40 })
  if (!TRACKING_STATUSES.includes(trackingStatus)) fail('Trạng thái hành trình không hợp lệ')
  const location = requiredText(input.location, 'Địa điểm cập nhật', { min: 2, max: 500 })
  const temperature = optionalNumber(input.temperature, 'Nhiệt độ', { min: -100, max: 100, decimals: 2 })
  const note = optionalText(input.note, 'Ghi chú cập nhật', 1000)
  if (trackingStatus === 'OTHER' && (!note || note.length < 2)) fail('Nhập ghi chú khi chọn trạng thái khác')
  const { data, error } = await supabase.rpc('record_lot_transport_tracking_update', {
    p_transport: transportId, p_actor: profile.id, p_tracking_status: trackingStatus,
    p_location: location, p_temperature: temperature, p_note: note,
  })
  if (error?.code === '42501') fail('Chỉ người vận chuyển nhận chuyến mới được cập nhật hành trình', 403)
  if (error?.code === '40001') fail('Chỉ cập nhật hành trình khi chuyến đang vận chuyển và chưa báo giao', 409)
  if (error?.code === 'P0002') fail('Không tìm thấy chuyến vận chuyển', 404)
  if (error?.code === '22023') fail('Trạng thái, địa điểm hoặc ghi chú cập nhật không hợp lệ')
  if (error?.code === 'PGRST202' || error?.code === '42883') {
    fail('Database chưa có RPC cập nhật hành trình. Hãy chạy migration 202610260002 và 202610260003, rồi thử lại.', 503)
  }
  if (error?.code === '23514') {
    fail('Database chưa bật loại sự kiện hành trình. Hãy chạy migration 202610260002, sau đó 202610260003.', 503)
  }
  if (error) throw error
  outbox.nudge()
  return { transport: data.transport, event_id: data.event_id }
}

async function transporterDashboard(profile) {
  requireTransporter(profile)
  const relation = 'lot:harvest_lots(id, lot_code, quantity, provenance)'
  const [available, assigned] = await Promise.all([
    supabase.from('transport_logs').select(`${FIELDS}, ${relation}`).is('handler_id', null).eq('status', 'PLANNING').order('created_at', { ascending: true }).limit(100),
    supabase.from('transport_logs').select(`${FIELDS}, ${relation}`).eq('handler_id', profile.id).order('transport_date', { ascending: false }).limit(100),
  ])
  if (available.error) throw available.error
  if (assigned.error) throw assigned.error
  const mapJob = (job) => ({ ...job, lot: job.lot ? {
    id: job.lot.id, lot_code: job.lot.lot_code, quantity: job.lot.quantity,
    provenance: {
      farm: { name: job.lot.provenance?.farm?.name ?? 'Cơ sở nuôi', address: job.lot.provenance?.farm?.address ?? null },
      pond: { code: job.lot.provenance?.pond?.code ?? '', name: job.lot.provenance?.pond?.name ?? 'Ao nuôi' },
      batch: { batch_code: job.lot.provenance?.batch?.batch_code ?? '', species: job.lot.provenance?.batch?.species ?? null },
    },
  } : null })
  const combined = await attachEvents([...(available.data ?? []), ...(assigned.data ?? [])])
  const mapped = combined.map(mapJob)
  const availableIds = new Set((available.data ?? []).map((job) => job.id))
  return { available: mapped.filter((job) => availableIds.has(job.id)), assigned: mapped.filter((job) => !availableIds.has(job.id)) }
}

async function claim(profile, transportId) {
  requireTransporter(profile)
  uuid(transportId, 'Mã chuyến vận chuyển')
  const { data, error } = await supabase.rpc('claim_lot_transport', { p_transport: transportId, p_actor: profile.id })
  if (error?.code === '42501') fail('Tài khoản không có vai trò người vận chuyển', 403)
  if (error?.code === '40001') fail('Chuyến vừa được người khác nhận hoặc không còn ở trạng thái chờ', 409)
  if (error?.code === 'P0002') fail('Không tìm thấy yêu cầu vận chuyển', 404)
  if (error) throw error
  outbox.nudge()
  return { transport: data.transport ?? data, event_id: data.event_id ?? null }
}
module.exports = { list, listRecipients, create, updateTransporterStatus, confirmDelivery, assignRecipient, receivingDashboard, recordCheckpoint, recordTrackingUpdate, transporterDashboard, claim }
