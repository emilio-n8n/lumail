import { runInTxScope } from './tx-scope'
import { getDriver, type QueryResult, type Tx } from './driver'

/**
 * Request-scoped database access.
 *
 * The application connects as the database owner and then *assumes a role* for
 * the duration of every transaction:
 *
 *   authenticated  → row level security applies, tenant isolation enforced by
 *                    Postgres itself.
 *   service_role   → BYPASSRLS. Reserved for cross-tenant system work: the job
 *                    runner, tracking pixels, webhook delivery and seeding.
 *                    Never used to serve a dashboard read.
 *
 * The caller is identified the way PostgREST identifies it: by putting a signed
 * JWT's claims into `request.jwt.claims`. Supabase Auth's `auth.uid()` and
 * `auth.jwt()` read exactly that setting, so the policies in
 * `supabase/migrations` behave identically whether the request came through
 * PostgREST or through this layer. Nothing here trusts the client — the user id
 * comes from a verified session, never from a request header.
 */

export type { QueryResult, Tx }
export { getDriver, closeDriver, driverKind } from './driver'

export type AuthContext = {
  userId: string
  workspaceId: string | null
}

/**
 * Serialises transactions only when the backend has a single connection. PGlite
 * needs it; a pooled Postgres does not, and serialising there would throw away
 * the entire point of having a pool.
 *
 * The chain lives on `globalThis` alongside the driver, so a hot reload cannot
 * leave two independent chains queueing onto one connection — which deadlocks
 * the moment one's transaction body awaits the other's.
 */
declare global {
  // eslint-disable-next-line no-var
  var __lumailDbChain: Promise<unknown> | undefined
}

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const previous = globalThis.__lumailDbChain ?? Promise.resolve()
  const result = previous.then(fn, fn)
  globalThis.__lumailDbChain = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

async function inRole<T>(
  role: 'authenticated' | 'service_role',
  claims: AuthContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const driver = await getDriver()

  const run = async (tx: Tx) => {
    await tx.query(`set local role ${role}`)

    // The envelope PostgREST sets. `auth.uid()` and `auth.jwt()` read exactly
    // this setting, so `supabase/migrations` resolves the caller from it.
    await tx.query('select set_config($1, $2, true)', [
      'request.jwt.claims',
      JSON.stringify({
        sub: claims.userId,
        role,
        app_metadata: { workspace_id: claims.workspaceId ?? null },
      }),
    ])

    // The pre-Supabase claims, set alongside. Policies written against them
    // read `current_setting('app.user_id')`; the Supabase ones never look at
    // these. Carrying both means a database can be migrated policy by policy
    // instead of all at once — and `current_workspace_id()` prefers the JWT
    // claim, so the Supabase behaviour wins as soon as it exists.
    await tx.query('select set_config($1, $2, true)', [
      'app.user_id',
      claims.userId ?? '',
    ])
    await tx.query('select set_config($1, $2, true)', [
      'app.workspace_id',
      claims.workspaceId ?? '',
    ])

    return fn(tx)
  }

  // `runInTxScope` throws rather than deadlocking if this is called from inside
  // an open transaction — see tx-scope.ts for why that matters on PGlite.
  const once = () =>
    runInTxScope(() => (driver.pooled ? driver.transaction(run) : serialize(() => driver.transaction(run))))

  return once()
}

/**
 * Runs `fn` as an authenticated workspace member. Every statement is subject to
 * the workspace's row level security policies.
 */
export function withAuthenticatedDb<T>(
  context: AuthContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return inRole('authenticated', context, fn)
}

/**
 * Runs `fn` with RLS bypassed. Use only for system work that must cross tenant
 * boundaries — never for a request that renders a dashboard page.
 */
export function withAdminDb<T>(
  fn: (tx: Tx) => Promise<T>,
  claims: AuthContext = { userId: '', workspaceId: null },
): Promise<T> {
  return inRole('service_role', claims, fn)
}

export async function one<T>(
  tx: Tx,
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const result = await tx.query<T>(sql, params)
  return result.rows[0] ?? null
}

export async function many<T>(
  tx: Tx,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await tx.query<T>(sql, params)
  return result.rows
}