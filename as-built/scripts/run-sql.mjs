// Runs a SQL file against the local Supabase database.
// Usage: node scripts/run-sql.mjs supabase/seed.sql
import { readFileSync } from "node:fs"
import pg from "pg"

const file = process.argv[2]
if (!file) {
  console.error("Usage: node scripts/run-sql.mjs <file.sql>")
  process.exit(1)
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:57322/postgres",
})
await client.connect()
try {
  await client.query(readFileSync(file, "utf8"))
  console.log(`Ran ${file}`)
} finally {
  await client.end()
}
