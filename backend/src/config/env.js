const path = require('node:path')

require('dotenv').config({
  path: path.resolve(__dirname, '../../.env'),
})

const requiredVariables = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY']
const missingVariables = requiredVariables.filter((name) => !process.env[name])

if (missingVariables.length > 0) {
  throw new Error(
    `Missing required environment variables: ${missingVariables.join(', ')}`,
  )
}

const port = Number(process.env.PORT ?? 3000)

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535')
}

module.exports = Object.freeze({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port,
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseSecretKey: process.env.SUPABASE_SECRET_KEY,
})
