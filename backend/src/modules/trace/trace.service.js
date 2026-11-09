// Dependency injection keeps public projection/authorization testable without live services.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function fail(message, status) { throw Object.assign(new Error(message), { status }) }
function text(value) { return typeof value === 'string' ? value.slice(0, 500) : null }
function scalar(value) { return typeof value === 'number' && Number.isFinite(value) ? value : text(value) }
const DETAIL_KEYS = {
  FEEDING: ['feedType', 'feedAmount'], MEDICINE: ['medicineName', 'dose'],
  WATER_QUALITY: ['temperature', 'salinity', 'ph', 'dissolvedOxygen'],
  ENVIRONMENT: ['temperature', 'salinity', 'ph', 'dissolvedOxygen'], MORTALITY: ['mortalityCount'],
}
function createTraceService(repo, chain, { timeoutMs = 2500 } = {}) {
  async function owned(profile, scope) {
    if (!['farmId', 'pondId', 'id', 'lotId'].every(key => UUID.test(String(scope[key])))) fail('Không tìm thấy lô hàng', 404)
    const lot = await repo.ownedLot(profile, scope)
    if (!lot) fail('Không tìm thấy lô hàng', 404)
    return lot
  }
  function ownerResult(qr) {
    return { qr, canIssue: false, canRevoke: qr?.status === 'ACTIVE' && !qr.issuer_organization_id }
  }
  function reason(input) {
    if (typeof input?.reason !== 'string' || input.reason.trim().length < 3 || input.reason.trim().length > 500) fail('Lý do thu hồi phải có 3–500 ký tự', 400)
    return input.reason.trim()
  }
  async function get(profile, scope) { await owned(profile, scope); return ownerResult(await repo.findQrByLot(scope.lotId)) }
  async function issue() { fail('Chỉ nhà phân phối đã xác nhận nhận hàng mới được phát hành QR', 403) }
  async function revoke(profile, scope, input) {
    await owned(profile, scope)
    const value = reason(input)
    const qr = await repo.findQrByLot(scope.lotId)
    if (!qr) fail('Lô chưa phát hành QR', 404)
    if (qr.issuer_organization_id) fail('Chỉ tổ chức phát hành mới được thu hồi QR này', 403)
    return ownerResult(await repo.revokeLegacy(profile.id, scope.lotId, value))
  }
  async function receiving(profile, scope, action, input) {
    if (profile.role !== 'DISTRIBUTOR' || profile.status !== true || !UUID.test(String(profile.organization_id))) {
      fail('Chỉ nhà phân phối nhận hàng đang hoạt động mới được quản lý QR', 403)
    }
    if (!UUID.test(String(scope.transportId))) fail('Không tìm thấy chuyến vận chuyển', 404)
    return repo.receivingQr(profile.id, scope.transportId, action, action === 'REVOKE' ? reason(input) : null)
  }
  async function proof(lot) {
    const record = await repo.proof(lot.blockchain_event_id)
    const base = { recordedStatus: record?.status ?? null, transactionHash: record?.transaction_hash ?? null, checkedAt: null }
    if (!record || record.status !== 'SUCCESS') return { ...base, status: 'PENDING' }
    if (!record.contract_address) return { ...base, status: 'UNAVAILABLE' }
    let timer
    try {
      const hash = await Promise.race([
        chain.read(lot.blockchain_event_id, record.contract_address),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Chain timeout')), timeoutMs) }),
      ])
      return { ...base, checkedAt: new Date().toISOString(), status: hash && hash === chain.hash(lot.provenance) && hash === record.data_hash ? 'MATCH' : 'MISMATCH' }
    } catch { return { ...base, status: 'UNAVAILABLE' } }
    finally { clearTimeout(timer) }
  }
  async function publicTrace(code) {
    if (!UUID.test(String(code))) fail('Không tìm thấy mã truy xuất', 404)
    const qr = await repo.findQr(code)
    if (!qr) fail('Không tìm thấy mã truy xuất', 404)
    if (qr.status === 'REVOKED') return { status: 'REVOKED' }
    const lot = await repo.findLot(qr.lot_id)
    if (!lot) fail('Không tìm thấy lô hàng', 404)
    const origin = lot.provenance
    const harvestDate = origin.harvest.harvest_date
    // Harvest input is a calendar day in Vietnam, not the actual time of harvest.
    const harvestDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(harvestDate))
    const logsBefore = new Date(new Date(`${harvestDay}T00:00:00+07:00`).getTime() + 86400000).toISOString()
    const [logs, transports] = await Promise.all([repo.logs(lot.batch_id, logsBefore), repo.transports(lot.id)])
    const publicLogs = logs.filter(log => log.batch_id === lot.batch_id && log.lifecycle_status === 'CONFIRMED' &&
      log.version?.id === log.current_version_id && log.version.status === 'ACTIVE' &&
      new Date(log.version.log_date) < new Date(logsBefore)).map(log => {
        const version = log.version
        const details = {}
        for (const key of DETAIL_KEYS[version.log_type] ?? []) {
          const value = scalar(version.details?.[key])
          if (value !== null) details[key] = value
        }
        return { type: text(version.log_type), date: text(version.log_date), details, blockchainStatus: ['SUCCESS', 'PENDING', 'FAILED'].includes(log.recordedStatus) ? log.recordedStatus : null }
      })
    const publicTransports = transports.filter(trip => trip.harvest_lot_id === lot.id).map(trip => ({
      code: text(trip.transport_code), date: text(trip.transport_date), status: text(trip.status), quantity: scalar(trip.quantity),
      recipientName: text(trip.recipient?.name),
      events: (trip.events ?? []).map(event => ({ type: text(event.event_type), date: text(event.occurred_at),
        temperature: scalar(event.payload?.temperature), trackingStatus: text(event.payload?.trackingStatus), blockchainStatus: text(event.blockchain_status) })),
    }))
    // Re-read publication after assembling data: do not serve a cached active dossier after revocation.
    const current = await repo.findQr(code)
    if (!current || current.status === 'REVOKED') return { status: 'REVOKED' }
    const result = { status: 'ACTIVE', trace: {
      lotCode: text(lot.lot_code), species: text(origin.batch.species), quantity: scalar(lot.quantity), harvestDate: text(harvestDate),
      farm: { name: text(origin.farm.name), address: text(origin.farm.address) }, pond: { code: text(origin.pond.code), name: text(origin.pond.name) },
      batch: { code: text(origin.batch.batch_code), seedSource: text(origin.batch.seed_source), stockingDate: text(origin.batch.stocking_date) },
      logs: publicLogs, transports: publicTransports, proof: await proof(lot),
    } }
    const last = await repo.findQr(code)
    return last?.status === 'ACTIVE' ? result : { status: 'REVOKED' }
  }
  return { get, issue, revoke, publicTrace,
    getReceiving: (profile, scope) => receiving(profile, scope, 'GET'),
    issueReceiving: (profile, scope) => receiving(profile, scope, 'ISSUE'),
    revokeReceiving: (profile, scope, input) => receiving(profile, scope, 'REVOKE', input),
  }
}
module.exports = { createTraceService }
