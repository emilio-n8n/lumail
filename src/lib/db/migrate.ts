import { getPglite } from './pglite'
import { migrations } from './migrations'

/**
 * Applies pending migrations exactly once per process.
 *
 * The whole set runs inside a single transaction guarded by a Postgres
 * advisory lock, so a concurrent dev-server reload cannot double-apply DDL.
 */
export async function runMigrations(): Promise<void> {
  if (!globalThis.__lumailMigrationPromise) {
    globalThis.__lumailMigrationPromise = applyMigrations().catch((error) => {
      // Allow a later request to retry rather than caching the failure.
      globalThis.__lumailMigrationPromise = undefined
      throw error
    })
  }
  return globalThis.__lumailMigrationPromise
}

async function applyMigrations(): Promise<void> {
  const db = getPglite()

  await db.exec(`
    create table if not exists public.schema_migrations (
      id text primary key,
      applied_at timestamptz not null default now()
    );
  `)

  const lockId = 8_140_223_771
  await db.query('select pg_advisory_lock($1)', [lockId])

  try {
    const existing = await db.query<{ id: string }>(
      'select id from public.schema_migrations order by id',
    )
    const applied = new Set(existing.rows.map((row) => row.id))

    for (const migration of migrations) {
      if (applied.has(migration.id)) continue

      await db.transaction(async (tx) => {
        await tx.exec(migration.sql)
        await tx.query('insert into public.schema_migrations (id) values ($1)', [
          migration.id,
        ])
      })

      // eslint-disable-next-line no-console
      console.info(`[db] applied migration ${migration.id}`)
    }
  } finally {
    await db.query('select pg_advisory_unlock($1)', [lockId])
  }
}