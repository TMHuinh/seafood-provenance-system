const express = require('express')

const { requireAuth } = require('../auth/auth.middleware')
const farmsController = require('./farms.controller')
const pondsRoutes = require('../ponds/ponds.routes')

const router = express.Router()

router.use(requireAuth)
router.get('/', farmsController.list)
router.post('/', farmsController.create)
router.use('/:farmId/ponds', pondsRoutes)
router.get('/:id', farmsController.detail)
router.patch('/:id', farmsController.update)
router.delete('/:id', farmsController.remove)

module.exports = router
