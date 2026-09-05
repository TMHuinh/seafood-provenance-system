const express = require('express')
const controller = require('./batches.controller')
const router = express.Router({ mergeParams: true })
router.get('/', controller.listByPond)
router.post('/', controller.createForPond)
router.patch('/:id', controller.updateForPond)
router.delete('/:id', controller.removeForPond)
module.exports = router
