const { readFileSync, readdirSync } = require('node:fs')
const { join, resolve } = require('node:path')

async function createTestDatabase() {
  const packageRoot = process.env.PGLITE_PACKAGE
  const { PGlite } = require(packageRoot ? join(resolve(packageRoot), 'dist/index.cjs') : '@electric-sql/pglite')
  const { btree_gist } = require(packageRoot
    ? join(resolve(packageRoot), 'dist/contrib/btree_gist.cjs') : '@electric-sql/pglite/contrib/btree_gist')
  const db = new PGlite({ extensions: { btree_gist } })
  const directory = join(__dirname, '../migrations')
  const migrations = readdirSync(directory).filter(name => name.endsWith('.sql')).sort()

  try {
    await db.exec(`
      CREATE SCHEMA auth;
      CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role BYPASSRLS;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
    `)
    for (const file of migrations) {
      try {
        await db.exec(readFileSync(join(directory, file), 'utf8').split('-- migrate:down')[0])
      } catch (error) {
        throw new Error(file + ': ' + error.message, { cause: error })
      }
    }
  } catch (error) {
    await db.close()
    throw error
  }
  return { db, migrations }
}

module.exports = { createTestDatabase }
