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

async function listByPond(req, res, next) { try { res.json({ success: true, ...(await batchesService.listByPond(req.auth.profile, req.params.farmId, req.params.pondId)) }) } catch (e) { next(e) } }
async function createForPond(req, res, next) { try { res.status(201).json({ success: true, batch: await batchesService.createForPond(req.auth.profile, req.params.farmId, req.params.pondId, req.body) }) } catch (e) { next(e) } }
async function updateForPond(req, res, next) { try { res.json({ success: true, batch: await batchesService.updateForPond(req.auth.profile, req.params.farmId, req.params.pondId, req.params.id, req.body) }) } catch (e) { next(e) } }
async function removeForPond(req, res, next) { try { await batchesService.removeForPond(req.auth.profile, req.params.farmId, req.params.pondId, req.params.id); res.status(204).end() } catch (e) { next(e) } }

module.exports = { createForPond, detail, list, listByPond, removeForPond, updateForPond }
