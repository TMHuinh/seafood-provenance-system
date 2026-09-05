const farmsService = require('./farms.service')

async function create(request, response, next) {
  try {
    const farm = await farmsService.create(request.auth.profile, request.body)
    response.status(201).json({ success: true, farm })
  } catch (error) {
    next(error)
  }
}

async function list(request, response, next) {
  try {
    const result = await farmsService.list(request.auth.profile)
    response.json({ success: true, ...result })
  } catch (error) {
    next(error)
  }
}

async function detail(request, response, next) {
  try {
    const farm = await farmsService.detail(request.auth.profile, request.params.id)
    response.json({ success: true, farm })
  } catch (error) {
    next(error)
  }
}

async function update(request, response, next) {
  try {
    const farm = await farmsService.update(request.auth.profile, request.params.id, request.body)
    response.json({ success: true, farm })
  } catch (error) {
    next(error)
  }
}

async function remove(request, response, next) {
  try {
    await farmsService.remove(request.auth.profile, request.params.id)
    response.status(204).end()
  } catch (error) {
    next(error)
  }
}

module.exports = { create, detail, list, remove, update }
