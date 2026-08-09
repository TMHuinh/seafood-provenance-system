const cors = require('cors')
const express = require('express')

const env = require('./config/env')
const {
  errorHandler,
  notFoundHandler,
} = require('./middleware/error-handler')
const authRoutes = require('./routes/auth.routes')
const batchesRoutes = require('./routes/batches.routes')
const healthRoutes = require('./routes/health.routes')

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

app.use(notFoundHandler)
app.use(errorHandler)

module.exports = app