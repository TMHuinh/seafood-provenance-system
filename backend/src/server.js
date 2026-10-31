const app = require('./app')
const env = require('./config/env')
const transportOutbox = require('./modules/transports/transports.outbox')

const server = app.listen(env.port, () => {
  console.log(`API listening at http://localhost:${env.port}`)
  transportOutbox.start()
})

function shutdown(signal) {
  console.log(`${signal} received, shutting down...`)
  transportOutbox.stop()
  server.close((error) => {
    if (error) {
      console.error(error)
      process.exitCode = 1
    }
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
