/**
 * Postgres drivers.
 *
 * The application talks to one of two backends and never to both:
 *
 *   `pglite` — embedded Postgres in WASM, a single connection. Used for local
 *              development and for the test suite, so the project runs with
 *              nothing installed.
 *   `tcp`    — a real Postgres over the wire, which is what a Supabase project's
 *              connection pooler provides. Chosen as soon as `DATABASE_URL` is
 *              set.
 *
 * Both backends share one schema, the SQL in `supabase/migrations`, so there is
 * a single definition of the database and nothing to keep in sync.
 *
 * The surface is deliberately tiny: run a transaction, run a script. Everything
 * above this file — the domain layer, row level security, the segment compiler
 * — is written against that surface and is identical either way.
 */

export type QueryResult<T> = {
  rows: T[]
  affectedRows?: number
}

export type Tx = {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>
  exec(sql: string): Promise<unknown>
}

export type Driver = {
  kind: 'pglite' | 'tcp'
  /** False when the backend has exactly one connection and must serialise. */
  pooled: boolean
  /** Runs `fn` inside a transaction. */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>
  /** Runs a multi-statement script outside any transaction. */
  exec(sql: string): Promise<unknown>
  /** Releases the underlying handles. */
  close(): Promise<void>
}

/** Which backend this process should use. */
export function driverKind(): 'pglite' | 'tcp' {
  return process.env.DATABASE_URL ? 'tcp' : 'pglite'
}

/* ------------------------------------------------------------------ PGlite */

async function pgliteDriver(): Promise<Driver> {
  const { getPglite } = await import('@/lib/db/pglite')
  const instance = getPglite()

  return {
    kind: 'pglite',
    pooled: false,
    async transaction<T>(fn: (tx: Tx) => Promise<T>) {
      return instance.transaction(async (raw) => {
        const tx: Tx = {
          async query<U>(sql: string, params: unknown[] = []) {
            const result = await (raw as { query: Function }).query(sql, params)
            return {
              rows: result.rows as U[],
              affectedRows: result.affectedRows,
            }
          },
          async exec(sql: string) {
            return (raw as { exec: Function }).exec(sql)
          },
        }
        return fn(tx)
      }) as Promise<T>
    },
    async exec(sql: string) {
      return instance.exec(sql)
    },
    async close() {
      const { closePglite } = await import('@/lib/db/pglite')
      await closePglite()
    },
  }
}

/* --------------------------------------------------------------------- TCP */

async function tcpDriver(): Promise<Driver> {
  const postgres = (await import('postgres')).default
  const sql = postgres(process.env.DATABASE_URL!, {
    // Supabase's pooler multiplexes, so a modest pool is plenty; a large one
    // only queues.
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => {},
  })

  return {
    kind: 'tcp',
    pooled: true,
    async transaction<T>(fn: (tx: Tx) => Promise<T>) {
      return sql.begin(async (connection) => {
        const tx: Tx = {
          async query<U>(statement: string, params: unknown[] = []) {
            const result = await (connection as any).unsafe(statement, params)
            return {
              rows: (Array.isArray(result) ? result : []) as U[],
              affectedRows: result?.count ?? undefined,
            }
          },
          async exec(statement: string) {
            return (connection as any).unsafe(statement)
          },
        }
        return fn(tx)
      }) as Promise<T>
    },
    async exec(script: string) {
      return sql.unsafe(script)
    },
    async close() {
      await sql.end({ timeout: 5 })
    },
  }
}

/* ---------------------------------------------------------------- registry */

declare global {
  // eslint-disable-next-line no-var
  var __lumailDriver: Promise<Driver> | undefined
}

export function getDriver(): Promise<Driver> {
  globalThis.__lumailDriver ??= driverKind() === 'tcp' ? tcpDriver() : pgliteDriver()
  return globalThis.__lumailDriver
}

/** Closes the driver. Used by scripts and on server shutdown. */
export async function closeDriver(): Promise<void> {
  const pending = globalThis.__lumailDriver
  globalThis.__lumailDriver = undefined
  if (!pending) return
  try {
    await (await pending).close()
  } catch {
    /* already closed */
  }
}