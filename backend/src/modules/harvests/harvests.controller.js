const service = require('./harvests.service')

async function list(req, res, next) {
  try { res.json({ success: true, ...await service.list(req.auth.profile, req.params.farmId, req.params.pondId, req.params.id) }) }
  catch (error) { next(error) }
}
async function create(req, res, next) {
  try {
    const result = await service.create(req.auth.profile, req.params.farmId, req.params.pondId, req.params.id, req.body)
    res.status(result.replayed ? 200 : 201).json({ success: true, ...result })
  } catch (error) { next(error) }
}
module.exports = { list, create }
