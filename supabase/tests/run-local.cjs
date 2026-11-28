const { readFileSync, readdirSync } = require('node:fs')
const { join } = require('node:path')
const { createTestDatabase } = require('./test-database.cjs')

async function run() {
  const available = readdirSync(__dirname).filter(name => name.endsWith('.sql')).sort()
  const requested = process.argv.slice(2)
  if (requested.some(name => !available.includes(name))) throw new Error('Unknown SQL fixture')
  const { db, migrations } = await createTestDatabase()
  try {
    console.log(`Applied ${migrations.length} migrations`)
    for (const file of requested.length ? requested : available) {
      try {
        await db.exec(readFileSync(join(__dirname, file), 'utf8'))
        console.log(`PASS ${file}`)
      } catch (error) {
        throw new Error(file + ': ' + error.message, { cause: error })
      }
    }
  } finally {
    await db.close()
  }
}

run().catch(error => {
  console.error(error.message, error.cause?.where ?? '')
  process.exitCode = 1
})
