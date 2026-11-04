/**
 * drizzle-kit (https://orm.drizzle.team/docs/drizzle-config-file). `db:generate` writes SQL migrations into `drizzle/`,
 * committed; the server and `pnpm db:migrate` apply them (`migrateDb`, src/db/client.ts). `db:studio` needs
 * DATABASE_SESSION_URL or DATABASE_URL in the shell; nothing here reads `.env`.
 */
import { defineConfig } from 'drizzle-kit'

const url = process.env.DATABASE_SESSION_URL ?? process.env.DATABASE_URL

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  schemaFilter: ['meniscus'],
  migrations: { schema: 'meniscus', table: 'drizzle_migrations' },
  strict: true,
  verbose: true,
  ...(url ? { dbCredentials: { url } } : {}),
})
