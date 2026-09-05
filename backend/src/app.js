const cors = require('cors')
const express = require('express')

const env = require('./config/env')
const {
  errorHandler,
  notFoundHandler,
} = require('./shared/middleware/error-handler')
const authRoutes = require('./modules/auth/auth.routes')
const batchesRoutes = require('./modules/batches/batches.routes')
const farmsRoutes = require('./modules/farms/farms.routes')
const healthRoutes = require('./modules/health/health.routes')

const app = express()

app.disable('x-powered-by')
app.use(
  cors({
    origin: env.frontendUrl,
    credentials: true,
  }),
)
app.use(express.json({ limit: '1mb' }))

app.use('/api/health', healthRoutes)
app.use('/api/auth', authRoutes)
app.use('/api/batches', batchesRoutes)
app.use('/api/farms', farmsRoutes)

app.use(notFoundHandler)
app.use(errorHandler)

module.exports = app
