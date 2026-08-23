const batchesService = require('./batches.service')

async function list(request, response, next) {
  try {
    const result = await batchesService.list(request.auth.profile)
    response.json({ success: true, ...result })
  } catch (error) {
    next(error)
  }
}

async function detail(request, response, next) {
  try {
    const result = await batchesService.detail(request.params.id)
    response.json({ success: true, ...result })
  } catch (error) {
    next(error)
  }
}

module.exports = { detail, list }
