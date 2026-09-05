const farmsRepository = require('./farms.repository')
const { normalizeFarmInput } = require('./farms.validation')

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function createHttpError(message, status) {
  const error = new Error(message)
  error.status = status
  return error
}

function validateId(id) {
  if (!UUID_PATTERN.test(String(id))) {
    throw createHttpError('Mã cơ sở nuôi không hợp lệ', 400)
  }
}

async function create(profile, input) {
  const farm = normalizeFarmInput(input)
  return farmsRepository.create(profile.id, profile.organization_id ?? null, farm)
}

async function list(profile) {
  const items = await farmsRepository.findAllByOwner(profile.id)
  return { count: items.length, items }
}

async function detail(profile, id) {
  validateId(id)
  const farm = await farmsRepository.findByIdAndOwner(id, profile.id)
  if (!farm) throw createHttpError('Không tìm thấy cơ sở nuôi', 404)
  return farm
}

async function update(profile, id, input) {
  validateId(id)
  const changes = normalizeFarmInput(input, { partial: true })
  const farm = await farmsRepository.update(id, profile.id, changes)
  if (!farm) throw createHttpError('Không tìm thấy cơ sở nuôi', 404)
  return farm
}

async function remove(profile, id) {
  validateId(id)
  try {
    const farm = await farmsRepository.remove(id, profile.id)
    if (!farm) throw createHttpError('Không tìm thấy cơ sở nuôi', 404)
  } catch (error) {
    if (error.code === '23503') {
      throw createHttpError('Không thể xóa cơ sở đang có ao nuôi', 409)
    }
    throw error
  }
}

module.exports = { create, detail, list, remove, update }
