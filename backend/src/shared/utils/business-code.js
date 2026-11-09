const { randomBytes } = require('node:crypto')

function generateBusinessCode(prefix) {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  const suffix = randomBytes(6).toString('hex').toUpperCase()
  return `${prefix}-${date}-${suffix}`
}

function generateRequestCode(prefix, requestId) {
  return `${prefix}-${String(requestId).replaceAll('-', '').toUpperCase()}`
}

module.exports = { generateBusinessCode, generateRequestCode }
