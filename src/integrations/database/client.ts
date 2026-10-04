import { createTx, type QueryResult, type Tx } from './driver'

/**
 * Request-scoped database access.
 *
 * Every statement runs under an assumed role:
 *
 *   authenticated  → row level security applies, tenant isolation enforced by
 *                    Postgres itself.
 *   service_role   → BYPASSRLS. Reserved for cross-tenant system work: the job
 *                    runner, tracking pixels, webhook delivery.
 *                    Never used to serve a dashboard read.
 *
 * The caller is identified the way PostgREST identifies it: by `request.jwt.claims`,
 * which `auth.uid()` and `auth.jwt()` read. The user id always comes from a
 * verified session, never from a request header.
 */

export type { QueryResult, Tx }

export type AuthContext = {
  userId: string
  workspaceId: string | null
}

async function inRole<T>(
  role: 'authenticated' | 'service_role',
  claims: AuthContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const tx = createTx(role, {
    sub: claims.userId || null,
    role,
    app_metadata: { workspace_id: claims.workspaceId ?? null },
  })
  return fn(tx)
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
