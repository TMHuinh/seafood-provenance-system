const service = require('./ponds.service')

async function list(req, res, next) { try { res.json({ success: true, ...(await service.list(req.auth.profile, req.params.farmId)) }) } catch (e) { next(e) } }
async function create(req, res, next) { try { res.status(201).json({ success: true, pond: await service.create(req.auth.profile, req.params.farmId, req.body) }) } catch (e) { next(e) } }
async function update(req, res, next) { try { res.json({ success: true, pond: await service.update(req.auth.profile, req.params.farmId, req.params.id, req.body) }) } catch (e) { next(e) } }
async function remove(req, res, next) { try { await service.remove(req.auth.profile, req.params.farmId, req.params.id); res.status(204).end() } catch (e) { next(e) } }

module.exports = { create, list, remove, update }
