const db = require('../../config/supabase')

const vietnamDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' })
const fail = (message, status) => { throw Object.assign(new Error(message), { status }) }

async function result(query) {
  const { data, error } = await query.abortSignal(AbortSignal.timeout(5000))
  if (error) throw error
  return data
}

async function receivedTrip(actor, transport) {
  const profile = await result(db.from('user_profiles').select('role,status,organization_id').eq('id', actor).maybeSingle())
  if (profile?.role !== 'DISTRIBUTOR' || !profile.status || !profile.organization_id) {
    fail('Chỉ nhà phân phối đang hoạt động được quản lý chuyến nhận hàng', 403)
  }
  const [org, trip] = await Promise.all([
    result(db.from('organizations').select('name,status').eq('id', profile.organization_id).maybeSingle()),
    result(db.from('transport_logs').select('id,status,recipient_organization_id,harvest_lot_id,transport_code,received_quantity,quantity')
      .eq('id', transport).eq('recipient_organization_id', profile.organization_id).maybeSingle()),
  ])
  if (!org?.status) fail('Tổ chức nhận hàng hiện chưa hoạt động', 403)
  if (!trip) fail('Không tìm thấy chuyến nhận hàng', 404)
  if (trip.status !== 'DELIVERED') fail('Chuyến chưa được xác nhận nhận hàng', 409)
  const receipt = await result(db.from('transport_events').select('occurred_at').eq('transport_id', trip.id)
    .eq('event_type', 'DELIVERED').eq('payload->receiverConfirmation->>organizationId', profile.organization_id)
    .order('sequence', { ascending: false }).limit(1).maybeSingle())
  if (!receipt) fail('Chuyến chưa được xác nhận nhận hàng', 409)
  return { trip, org, receipt }
}

function packagingInput(input, trip, receipt) {
  const start = vietnamDate.format(new Date(receipt.occurred_at))
  const today = vietnamDate.format(new Date())
  const validDate = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < start || value > today) return false
    const date = new Date(`${value}T00:00:00Z`)
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  }
  const { packagedDate, inspectionDate, quantity } = input
  if (!validDate(packagedDate) || !validDate(inspectionDate) || !Number.isFinite(quantity) || quantity <= 0 ||
    Math.round(quantity * 100) / 100 !== quantity || quantity > Number(trip.received_quantity ?? trip.quantity ?? 0)) {
    fail('Kiểm tra ngày đóng gói, ngày kiểm định và khối lượng thực nhận', 400)
  }
  const snapshot = { packagedDate, inspectionDate, quantity }
  for (const [key, max] of [['specification', 200], ['inspectionUnit', 200], ['inspectionResult', 1000]]) {
    const value = typeof input[key] === 'string' ? input[key].trim() : ''
    if (!value || value.length > max) fail('Vui lòng nhập quy cách, đơn vị và kết quả kiểm định hợp lệ', 400)
    snapshot[key] = value
  }
  return snapshot
}

async function packaging(actor, transport, input = null) {
  const { trip, org, receipt } = await receivedTrip(actor, transport)
  const current = await result(db.from('lot_packaging').select('snapshot').eq('transport_id', trip.id).maybeSingle())
  if (input === null) return current?.snapshot ?? null
  const values = packagingInput(input, trip, receipt)
  const snapshot = { ...values, lotId: trip.harvest_lot_id, transportId: trip.id,
    transportCode: trip.transport_code, distributorName: org.name, confirmedAt: new Date().toISOString() }
  const saved = current?.snapshot ?? await result(db.rpc('persist_lot_packaging', {
    p_transport: trip.id, p_recipient: trip.recipient_organization_id, p_snapshot: snapshot,
  }))
  if (!saved || !Object.entries(values).every(([key, value]) => saved[key] === value)) {
    fail('Chuyến hoặc hồ sơ đóng gói đã thay đổi. Vui lòng tải lại', 409)
  }
  return saved
}

function currentQr(query) {
  return result(query.order('status').order('created_at', { ascending: false })
    .order('trace_code', { ascending: false }).limit(1).maybeSingle())
}

function projectQr(qr, issuer) {
  if (!qr) return null
  const { issued_by, issuance_transport_id, ...data } = qr
  return { ...data, issuer }
}

async function revokeQr(qr, reason) {
  if (qr.status === 'REVOKED') return qr
  const updated = await result(db.from('lot_trace_codes').update({
    status: 'REVOKED', revoked_at: new Date().toISOString(), revocation_reason: reason,
  }).eq('trace_code', qr.trace_code).eq('status', 'ACTIVE').select().maybeSingle())
  if (!updated) fail('Mã QR đã thay đổi. Vui lòng tải lại trước khi tiếp tục', 409)
  return updated
}

async function receivingQr(actor, transport, action, reason, traceCode) {
  const { trip, org } = await receivedTrip(actor, transport)
  const tripCodes = () => db.from('lot_trace_codes').select().eq('issuance_transport_id', trip.id)
  const [packaging, current] = await Promise.all([
    result(db.from('lot_packaging').select('transport_id').eq('transport_id', trip.id).maybeSingle()),
    currentQr(tripCodes()),
  ])
  if (['ISSUE', 'REISSUE'].includes(action) && !packaging) fail('Hãy xác nhận đóng gói và kiểm định trước khi phát hành QR', 412)
  let qr = current
  if (['REVOKE', 'REISSUE'].includes(action)) {
    if (!qr) fail('Không tìm thấy mã QR', 404)
    if (qr.issuer_organization_id !== trip.recipient_organization_id) fail('Bạn không có quyền quản lý mã QR này', 403)
    if (traceCode !== qr.trace_code && (traceCode !== undefined || action === 'REISSUE' ||
      await result(tripCodes().neq('trace_code', qr.trace_code).limit(1).maybeSingle()))) {
      fail('Mã QR đã thay đổi. Vui lòng tải lại trước khi tiếp tục', 409)
    }
  }
  if (action === 'REISSUE' && qr.status !== 'REVOKED') fail('Mã QR hiện vẫn đang hoạt động', 409)
  if (action === 'REISSUE' || (action === 'ISSUE' && !qr)) {
    qr = await result(db.rpc('insert_lot_trace_code_if_current', {
      p_transport: trip.id, p_recipient: trip.recipient_organization_id, p_actor: actor,
      p_expected_code: qr?.trace_code ?? null, p_expected_status: qr?.status ?? null,
    }))
    if (!qr && action === 'ISSUE') qr = await currentQr(tripCodes())
    if (!qr) fail('Mã QR đã thay đổi. Vui lòng tải lại trước khi tiếp tục', 409)
  } else if (action === 'REVOKE') {
    qr = await revokeQr(qr, reason)
  }
  const publisher = qr?.issuer_organization_id === trip.recipient_organization_id
  const issuer = qr && (publisher ? { name: org.name } :
    await result(db.from('organizations').select('name').eq('id', qr.issuer_organization_id).maybeSingle()))
  return { qr: projectQr(qr, issuer), canIssue: Boolean(packaging) && !qr,
    canRevoke: publisher && qr.status === 'ACTIVE', canReissue: Boolean(packaging) && publisher && qr.status === 'REVOKED' }
}

async function revokeLegacy(actor, lot, reason) {
  const owner = await result(db.from('harvest_lots').select('batch:batches!inner(pond:ponds!inner(farm:farms!inner(owner_id)))')
    .eq('id', lot).eq('batch.pond.farm.owner_id', actor).maybeSingle())
  if (!owner) fail('Bạn không có quyền quản lý QR của lô này', 403)
  const qr = await currentQr(db.from('lot_trace_codes').select().eq('lot_id', lot).is('issuance_transport_id', null))
  if (!qr) fail('Không tìm thấy mã QR', 404)
  if (qr.issuer_organization_id) fail('Chỉ tổ chức phát hành mới được thu hồi mã QR này', 403)
  return projectQr(await revokeQr(qr, reason), null)
}

module.exports = { packaging, receivingQr, revokeLegacy }
