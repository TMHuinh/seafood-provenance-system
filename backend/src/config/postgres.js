const { readFileSync } = require('node:fs')
const path = require('node:path')
const { Pool } = require('pg')
const env = require('./env')

let pool

function databasePool() {
  if (!env.databaseUrl) {
    throw Object.assign(new Error('Thiếu kết nối PostgreSQL cho yêu cầu gia nhập'), { status: 503 })
  }
  if (!pool) {
    const url = new URL(env.databaseUrl)
    const officialSupabase = url.hostname.endsWith('.supabase.com') || url.hostname.endsWith('.supabase.co')
    const ca = env.databaseCaFile || (officialSupabase ? path.join(__dirname, 'supabase-root-2021.pem') : null)
    const sslMode = url.searchParams.get('sslmode')
    if (officialSupabase || ca || (sslMode && sslMode !== 'disable')) {
      url.searchParams.delete('sslmode')
      url.searchParams.delete('sslrootcert')
    }
    pool = new Pool({
      connectionString: url.toString(),
      ssl: officialSupabase || ca || (sslMode && sslMode !== 'disable')
        ? { rejectUnauthorized: true, ...(ca ? { ca: readFileSync(ca, 'utf8') } : {}) }
        : false,
      max: 5, connectionTimeoutMillis: 5000,
    })
    pool.on('error', error => console.error('PostgreSQL idle connection error', { code: error.code }))
  }
  return pool
}

async function transaction(run) {
  const client = await databasePool().connect()
  let discard = false
  try {
    await client.query('BEGIN')
    await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'")
    const result = await run(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try { await client.query('ROLLBACK') } catch { discard = true }
    if (['23P01', '55P03', '40P01'].includes(error.code)) {
      throw Object.assign(new Error('Dữ liệu đã thay đổi. Vui lòng thử lại'), { status: 409 })
    }
    throw error
  } finally {
    client.release(discard)
  }
}

module.exports = { transaction }
