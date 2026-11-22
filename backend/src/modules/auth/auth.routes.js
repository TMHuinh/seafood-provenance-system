const express = require('express')

const authController = require('./auth.controller')
const { requireAdmin, requireAuth } = require('./auth.middleware')

const router = express.Router()

router.post('/register', authController.register)
router.post('/login', authController.login)
router.post('/forgot-password', authController.forgotPassword)
router.post('/reset-password', authController.resetPassword)
router.get('/users', requireAuth, requireAdmin, authController.listUsers)
router.patch('/users/:userId', requireAuth, requireAdmin, authController.updateUser)
router.get('/me', requireAuth, authController.me)
router.post('/logout', requireAuth, authController.logout)

module.exports = router
