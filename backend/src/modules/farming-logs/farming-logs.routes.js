const express = require('express')

const { requireAuth } = require('../auth/auth.middleware')
const farmingLogsController = require('./farming-logs.controller')

const router = express.Router({ mergeParams: true })

// Bắt buộc đăng nhập
router.use(requireAuth)

// Tạo nhật ký mới
router.post('/', farmingLogsController.create)

// Chỉnh sửa nhật ký và ghi lại hash lên blockchain
router.patch('/:id', farmingLogsController.update)
router.post('/:id/confirm', farmingLogsController.confirm)
router.post('/:id/corrections', farmingLogsController.correct)
router.post('/:id/revoke', farmingLogsController.revoke)
router.get('/:id/history', farmingLogsController.history)

// Lấy danh sách nhật ký theo mã lô nuôi
router.get('/batch/:batchId', farmingLogsController.listByBatch)

// Kiểm tra đồng bộ nhật ký với dữ liệu blockchain
router.get('/batch/:batchId/verify', farmingLogsController.verifyBatch)

module.exports = router
