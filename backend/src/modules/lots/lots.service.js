const { UUID, fail, requireManager, filters } = require('./lots.validation')
const vnDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' })
const one = relation => Array.isArray(relation) ? relation[0] : relation
function cents(value) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value))
  if (!match) fail('Khối lượng thu hoạch không hợp lệ', 422)
  return BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0'))
}
function kg(value) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) fail('Tổng sản lượng vượt giới hạn hiển thị chính xác', 422)
  return Number(value) / 100
}
function aggregate(harvests, options) {
  const rows = harvests.map(h => {
    const origin = one(h.lots)?.provenance
    return { id: h.id, batchId: h.batch.id, farmId: h.batch.pond.farm.id,
      farmName: origin?.farm?.name ?? h.batch.pond.farm.farm_name,
      pondId: h.batch.pond.id, pondName: origin?.pond?.name ?? h.batch.pond.pond_name,
      species: origin?.batch?.species ?? h.batch.species,
      month: vnDay.format(new Date(h.harvest_date)).slice(0, 7), quantity: cents(h.quantity) }
  }).filter(row => !options.species || row.species === options.species)
  function group(keyOf, fields) {
    const groups = new Map()
    for (const row of rows) {
      const key = keyOf(row)
      if (!groups.has(key)) groups.set(key, { ...fields(row), quantity: 0n, harvestCount: 0 })
      const item = groups.get(key)
      item.quantity += row.quantity
      item.harvestCount++
    }
    return [...groups.values()].map(item => ({ ...item, quantity: kg(item.quantity) }))
  }
  return {
    summary: { quantity: kg(rows.reduce((sum, row) => sum + row.quantity, 0n)), harvestCount: rows.length,
      batchCount: new Set(rows.map(row => row.batchId)).size, farmCount: new Set(rows.map(row => row.farmId)).size },
    byMonth: group(row => row.month, row => ({ month: row.month })).sort((a, b) => a.month.localeCompare(b.month)),
    bySpecies: group(row => row.species, row => ({ species: row.species })),
    byFarm: group(row => row.farmId, row => ({ farmId: row.farmId, farmName: row.farmName })).sort((a, b) => b.quantity - a.quantity),
    byPond: group(row => row.pondId, row => ({ pondId: row.pondId, pondName: row.pondName, farmName: row.farmName })).sort((a, b) => b.quantity - a.quantity),
  }
}
function projectLot(lot) {
  const origin = lot.provenance
  const qr = one(lot.qr) ?? null
  return { id: lot.id, lotCode: lot.lot_code, quantity: Number(lot.quantity), status: lot.status,
    harvestDate: origin.harvest.harvest_date, species: origin.batch.species,
    batch: { id: lot.batch.id, code: origin.batch.batch_code },
    farm: { id: lot.batch.pond.farm.id, name: origin.farm.name },
    pond: { id: lot.batch.pond.id, name: origin.pond.name, code: origin.pond.code },
    qr: qr ? { traceCode: qr.trace_code, status: qr.status } : null }
}
function createLotsService(repo, trace) {
  return {
    async list(profile, input) {
      requireManager(profile)
      const options = filters(input, { paginated: true })
      const { items, count } = await repo.page(profile, options)
      return { items: items.map(projectLot), count, page: options.page, pageSize: options.pageSize, totalPages: Math.ceil(count / options.pageSize) }
    },
    async options(profile) { requireManager(profile); return repo.options(profile) },
    async production(profile, input) {
      requireManager(profile)
      const options = filters(input)
      return { ...aggregate(await repo.harvests(profile, options), options), filters: options, generatedAt: new Date().toISOString() }
    },
    async report(profile, id) {
      requireManager(profile)
      if (!UUID.test(String(id))) fail('Không tìm thấy lô hàng', 404)
      const lot = await repo.find(profile, id)
      if (!lot) fail('Không tìm thấy lô hàng', 404)
      const [dossier, history] = await Promise.all([trace.dossier(lot), repo.history(lot.batch_id)])
      return { trace: dossier, history, qrStatus: one(lot.qr)?.status ?? null, generatedAt: new Date().toISOString() }
    },
  }
}
module.exports = { createLotsService, aggregate }
