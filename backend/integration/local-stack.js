// This stack only ever connects to the fixed loopback ports in integration/compose.yml.
const { spawnSync } = require('node:child_process')
const { readFileSync, readdirSync } = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { createHmac } = require('node:crypto')
const root = path.resolve(__dirname, '../..')
const composeFile = path.join(__dirname, 'compose.yml')
const secret = 'seafood-test-only-jwt-secret-at-least-32-characters'
function jwt(role) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role, iss: 'supabase', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 7200 })}`
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`
}
function docker(args, input) {
  const result = spawnSync('docker', ['compose', '-f', composeFile, ...args], {
    input,
    encoding: 'utf8',
    timeout: 300000,
    maxBuffer: 8 * 1024 * 1024,
  })
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || result.stdout)
  return result.stdout
}
function sql(source) {
  return docker(
    ['exec', '-T', 'db', 'psql', '-U', 'postgres', '-d', 'seafood_test', '-v', 'ON_ERROR_STOP=1', '-At'],
    source,
  )
}
async function ready(url, body) {
  for (let i = 0; i < 120; i++) {
    // Keep the deadline referenced: AbortSignal.timeout alone can let Node exit
    // while an unreferenced health-check connection is still pending.
    const controller = new AbortController()
    const deadline = setTimeout(() => controller.abort(), 1500)
    try {
      const response = await fetch(url, {
        method: body ? 'POST' : 'GET',
        body: body && JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
      })
      await response.arrayBuffer()
      if (response.ok) return
    } catch {
      /* service starting */
    } finally {
      clearTimeout(deadline)
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Test service did not start: ${url}`)
}
async function gateway() {
  const server = http.createServer((req, res) => {
    const auth = req.url.startsWith('/auth/v1/')
    const prefix = auth ? '/auth/v1' : '/rest/v1'
    if (!req.url.startsWith(prefix)) {
      res.writeHead(404).end()
      return
    }
    const upstream = http.request(
      {
        hostname: '127.0.0.1',
        port: auth ? 6543 : 6542,
        path: req.url.slice(prefix.length) || '/',
        method: req.method,
        agent: false,
        headers: { ...req.headers, host: '127.0.0.1', connection: 'close' },
      },
      (reply) => {
        res.writeHead(reply.statusCode, { ...reply.headers, connection: 'close' })
        reply.pipe(res)
      },
    )
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502)
      res.end()
    })
    req.pipe(upstream)
  })
  await new Promise((resolve) => server.listen(6541, '127.0.0.1', resolve))
  return server
}
async function rpcGateway() {
  let offline = false
  const server = http.createServer((req, res) => {
    if (offline) {
      res.writeHead(503).end('RPC unavailable')
      return
    }
    const upstream = http.request(
      {
        hostname: '127.0.0.1',
        port: 6546,
        path: '/',
        method: req.method,
        agent: false,
        headers: { ...req.headers, host: '127.0.0.1', connection: 'close' },
      },
      (reply) => {
        res.writeHead(reply.statusCode, { ...reply.headers, connection: 'close' })
        reply.pipe(res)
      },
    )
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502)
      res.end()
    })
    req.pipe(upstream)
  })
  await new Promise((resolve) => server.listen(6547, '127.0.0.1', resolve))
  server.setOffline = (value) => {
    offline = value
  }
  return server
}
async function migrate() {
  const directory = path.join(root, 'supabase/migrations')
  const sources = []
  for (const file of readdirSync(directory)
    .filter((file) => file.endsWith('.sql'))
    .sort()) {
    let source = readFileSync(path.join(directory, file), 'utf8')
    // The initial schema includes an uncommented DOWN section. Apply UP only.
    const down = source.search(/--\s*(?:migrate:down|DOWN\b)/i)
    if (down >= 0) source = source.slice(0, down)
    sources.push(source)
  }
  sql(sources.join('\n') + "\nNOTIFY pgrst, 'reload schema';")
  await new Promise((resolve) => setTimeout(resolve, 1000))
}
module.exports = { root, docker, sql, ready, gateway, rpcGateway, migrate, jwt }
