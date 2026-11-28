const { requireFarmManager } = require('../ponds/pond-access')
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
  const organizationId = Object.hasOwn(input ?? {}, 'organizationId') ? input.organizationId : profile.organization_id
  if (organizationId != null) validateId(organizationId)
  if (!(await canCreate(profile, organizationId))) {
    throw createHttpError('Chỉ người quản lý mới được tạo cơ sở cho đơn vị', 403)
  }
  return { ...await farmsRepository.create(profile.id, organizationId ?? null, farm), can_manage: true }
}

function canCreate(profile, organizationId) {
  if (organizationId) return farmsRepository.canCreateIn(profile, organizationId)
  return ['FARMER', 'ADMIN'].includes(profile.role)
}

async function list(profile) {
  const [items, can_create] = await Promise.all([
    farmsRepository.visible(profile), canCreate(profile, profile.organization_id),
  ])
  return { count: items.length, items, can_create }
}

async function detail(profile, id) {
  validateId(id)
  const farm = await farmsRepository.visible(profile, id)
  if (!farm) throw createHttpError('Không tìm thấy cơ sở nuôi', 404)
  return farm
}

async function update(profile, id, input) {
  validateId(id)
  await requireFarmManager(profile, id)
  const changes = normalizeFarmInput(input, { partial: true })
  const farm = await farmsRepository.update(id, changes)
  if (!farm) throw createHttpError('Không tìm thấy cơ sở nuôi', 404)
  return { ...farm, can_manage: true }
}

async function remove(profile, id) {
  validateId(id)
  await requireFarmManager(profile, id)
  try {
    const farm = await farmsRepository.remove(id)
    if (!farm) throw createHttpError('Không tìm thấy cơ sở nuôi', 404)
  } catch (error) {
    if (error.code === '23503') {
      throw createHttpError('Không thể xóa cơ sở đang có ao nuôi', 409)
    }
    throw error
  }
}

module.exports = { create, detail, list, remove, update }
