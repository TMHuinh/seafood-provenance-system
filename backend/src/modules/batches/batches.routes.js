const express = require('express')

const { requireAuth } = require('../auth/auth.middleware')
const batchesController = require('./batches.controller')

const router = express.Router()

router.get('/', requireAuth, batchesController.list)
router.get('/:id', requireAuth, batchesController.detail)

module.exports = router
