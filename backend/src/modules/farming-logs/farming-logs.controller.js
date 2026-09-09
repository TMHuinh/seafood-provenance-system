const farmingLogsService = require('./farming-logs.service')

async function create(request, response, next) {
  try {
    const log = await farmingLogsService.create(request.auth.profile, request.body)
    response.status(201).json({ success: true, log })
  } catch (error) {
    next(error)
  }
}

async function listByBatch(request, response, next) {
  try {
    const result = await farmingLogsService.listByBatch(request.auth.profile, request.params.batchId)
    response.json({ success: true, ...result })
  } catch (error) {
    next(error)
  }
}

async function verifyBatch(request, response, next) {
  try {
    const result = await farmingLogsService.verify(request.auth.profile, request.params.batchId)
    response.json({ success: true, ...result })
  } catch (error) {
    next(error)
  }
}

module.exports = { create, listByBatch, verifyBatch }