const farmingLogsService = require('./farming-logs.service')
const cloudinary = require('../../shared/services/cloudinary')

async function authorizeImageUpload(request, response, next) {
  try {
    await farmingLogsService.authorizeImageUpload(request.auth.profile, request.params.batchId)
    next()
  } catch (error) {
    next(error)
  }
}

async function uploadImage(request, response, next) {
  try {
    if (!request.file) throw Object.assign(new Error('Vui lòng chọn ảnh để tải lên'), { status: 400 })
    const imageUrl = await cloudinary.uploadFarmingLogImage(request.file)
    response.status(201).json({ success: true, imageUrl })
  } catch (error) {
    next(error)
  }
}

async function create(request, response, next) {
  try {
    const log = await farmingLogsService.create(request.auth.profile, request.body)
    response.status(201).json({ success: true, log })
  } catch (error) {
    next(error)
  }
}

async function update(request, response, next) {
  try {
    const log = await farmingLogsService.update(request.auth.profile, request.params.id, request.body)
    response.json({ success: true, log })
  } catch (error) {
    next(error)
  }
}

async function confirm(request, response, next) { try { response.json({ success: true, log: await farmingLogsService.confirm(request.auth.profile, request.params.id) }) } catch (error) { next(error) } }
async function correct(request, response, next) { try { response.json({ success: true, log: await farmingLogsService.correct(request.auth.profile, request.params.id, request.body) }) } catch (error) { next(error) } }
async function revoke(request, response, next) { try { response.json({ success: true, log: await farmingLogsService.revoke(request.auth.profile, request.params.id, request.body) }) } catch (error) { next(error) } }
async function history(request, response, next) { try { response.json({ success: true, ...(await farmingLogsService.history(request.auth.profile, request.params.id)) }) } catch (error) { next(error) } }

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

module.exports = { create, authorizeImageUpload, uploadImage, update, confirm, correct, revoke, history, listByBatch, verifyBatch }
