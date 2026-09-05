const express = require('express')
const controller = require('./ponds.controller')
const pondBatchesRoutes = require('../batches/pond-batches.routes')

const router = express.Router({ mergeParams: true })
router.get('/', controller.list)
router.post('/', controller.create)
router.use('/:pondId/batches', pondBatchesRoutes)
router.patch('/:id', controller.update)
router.delete('/:id', controller.remove)

module.exports = router
