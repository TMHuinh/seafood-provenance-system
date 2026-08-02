const app = require('./app')
const env = require('./config/env')

const server = app.listen(env.port, () => {
  console.log(`API listening at http://localhost:${env.port}`)
})

function shutdown(signal) {
  console.log(`${signal} received, shutting down...`)
  server.close((error) => {
    if (error) {
      console.error(error)
      process.exitCode = 1
    }
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
