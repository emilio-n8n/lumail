import { PGlite } from '@electric-sql/pglite'

/**
 * Embedded Postgres (PGlite) — the persistence runtime for the app.
 *
 * PGlite is real PostgreSQL compiled to WebAssembly: enums, generated columns,
 * `security definer` functions, GRANTs and row level security all behave
 * exactly as they do on a managed server. The single global instance is
 * required because PGlite is a one-connection database; creating a second
 * instance against the same data directory would fail to acquire the lock.
 */

declare global {
  // eslint-disable-next-line no-var
  var __lumailPglite: PGlite | undefined
  // eslint-disable-next-line no-var
  var __lumailMigrationPromise: Promise<void> | undefined
}

const dataDir = process.env.PGLITE_DATA_DIR ?? '.pglite'
const useMemory = process.env.PGLITE_IN_MEMORY === '1'

export function getPglite(): PGlite {
  if (!globalThis.__lumailPglite) {
    globalThis.__lumailPglite = useMemory
      ? new PGlite()
      : new PGlite({ dataDir })
  }
  return globalThis.__lumailPglite
}

export async function closePglite(): Promise<void> {
  if (globalThis.__lumailPglite) {
    const db = globalThis.__lumailPglite
    globalThis.__lumailPglite = undefined
    await db.close()
  }
}