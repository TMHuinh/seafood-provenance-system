const express = require('express')

const batchesController = require('../controllers/batches.controller')
const { requireAuth } = require('../middleware/auth.middleware')

const router = express.Router()

router.get('/', requireAuth, batchesController.list)
router.get('/:id', requireAuth, batchesController.detail)

module.exports = router