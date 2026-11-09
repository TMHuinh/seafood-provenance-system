const farmsRepository = require('../farms/farms.repository')
const pondsRepository = require('./ponds.repository')
const { normalizePondInput } = require('./ponds.validation')
const { generateBusinessCode } = require('../../shared/utils/business-code')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function httpError(message, status) { const error = new Error(message); error.status = status; return error }
function validId(id, label) { if (!UUID.test(String(id))) throw httpError(`${label} không hợp lệ`, 400) }
async function requireFarm(profile, farmId) {
  validId(farmId, 'Mã cơ sở nuôi')
  const farm = await farmsRepository.findByIdAndOwner(farmId, profile.id)
  if (!farm) throw httpError('Không tìm thấy cơ sở nuôi', 404)
  return farm
}
function mapDatabaseError(error) {
  if (error.code === '23505') throw httpError('Mã ao đã tồn tại trong cơ sở này', 409)
  if (error.code === '23503') throw httpError('Không thể xóa ao đang có vụ nuôi', 409)
  throw error
}

async function list(profile, farmId) { await requireFarm(profile, farmId); const items = await pondsRepository.findAll(farmId); return { count: items.length, items } }
async function create(profile, farmId, input) {
  await requireFarm(profile, farmId)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const normalized = normalizePondInput({ ...input, pondCode: generateBusinessCode('AO') })
      return await pondsRepository.create(farmId, normalized)
    } catch (error) {
      if (error.code === '23505' && attempt < 2) continue
      mapDatabaseError(error)
    }
  }
}
async function update(profile, farmId, id, input) {
  await requireFarm(profile, farmId)
  validId(id, 'Mã ao nuôi')
  const { pondCode, ...changes } = input && typeof input === 'object' ? input : {}
  void pondCode
  try {
    const pond = await pondsRepository.update(id, farmId, normalizePondInput(changes, { partial: true }))
    if (!pond) throw httpError('Không tìm thấy ao nuôi', 404)
    return pond
  } catch (error) { mapDatabaseError(error) }
}
async function remove(profile, farmId, id) { await requireFarm(profile, farmId); validId(id, 'Mã ao nuôi'); try { const pond = await pondsRepository.remove(id, farmId); if (!pond) throw httpError('Không tìm thấy ao nuôi', 404) } catch (e) { mapDatabaseError(e) } }

module.exports = { create, list, remove, update }
