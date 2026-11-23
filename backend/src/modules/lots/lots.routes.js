const express = require('express')
const { requireAuth } = require('../auth/auth.middleware')
const { createLotsRepository } = require('./lots.repository')
const { createLotsService } = require('./lots.service')
const db = require('../../config/supabase')
const { dossier } = require('../trace/trace.routes')
const service = createLotsService(createLotsRepository(db), { dossier })
const router = express.Router()
router.use(requireAuth)
function handler(action) {
  return async (req, res, next) => {
    try {
      const result = await service[action](req.auth.profile, action === 'report' ? req.params.id : req.query)
      res.set('Cache-Control', 'no-store').json({ success: true, ...result })
    } catch (error) { next(error) }
  }
}
router.get('/options', handler('options'))
router.get('/production', handler('production'))
router.get('/:id/report', handler('report'))
router.get('/', handler('list'))
module.exports = router
