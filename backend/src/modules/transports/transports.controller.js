const service = require('./transports.service')
async function list(req, res, next) { try { res.json({ success: true, ...await service.list(req.auth.profile, req.params.farmId, req.params.pondId, req.params.id, req.params.lotId) }) } catch (e) { next(e) } }
async function listRecipients(req, res, next) { try { res.json({ success: true, ...await service.listRecipients(req.auth.profile) }) } catch (e) { next(e) } }
async function create(req, res, next) { try { const result = await service.create(req.auth.profile, req.params.farmId, req.params.pondId, req.params.id, req.params.lotId, req.body); res.status(result.replayed ? 200 : 201).json({ success: true, ...result }) } catch (e) { next(e) } }
async function dashboard(req, res, next) { try { res.json({ success: true, ...await service.transporterDashboard(req.auth.profile) }) } catch (e) { next(e) } }
async function claim(req, res, next) { try { res.json({ success: true, ...await service.claim(req.auth.profile, req.params.transportId) }) } catch (e) { next(e) } }
async function updateOwnStatus(req, res, next) { try { res.json({ success: true, ...await service.updateTransporterStatus(req.auth.profile, req.params.transportId, req.body) }) } catch (e) { next(e) } }
async function recordCheckpoint(req, res, next) { try { res.status(201).json({ success: true, ...await service.recordCheckpoint(req.auth.profile, req.params.transportId, req.body) }) } catch (e) { next(e) } }
async function recordTrackingUpdate(req, res, next) { try { res.status(201).json({ success: true, ...await service.recordTrackingUpdate(req.auth.profile, req.params.transportId, req.body) }) } catch (e) { next(e) } }
async function receivingDashboard(req, res, next) { try { res.json({ success: true, ...await service.receivingDashboard(req.auth.profile) }) } catch (e) { next(e) } }
async function confirmDelivery(req, res, next) { try { res.json({ success: true, ...await service.confirmDelivery(req.auth.profile, req.params.transportId, req.body) }) } catch (e) { next(e) } }
async function assignRecipient(req, res, next) { try { res.json({ success: true, ...await service.assignRecipient(req.auth.profile, req.params.transportId, req.body) }) } catch (e) { next(e) } }
module.exports = { list, listRecipients, create, dashboard, receivingDashboard, claim, updateOwnStatus, recordCheckpoint, recordTrackingUpdate, confirmDelivery, assignRecipient }
