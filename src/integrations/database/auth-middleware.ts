import { createMiddleware } from '@tanstack/react-start'

/**
 * Global function middleware, registered in `src/start.ts`.
 *
 * It resolves the caller's session once per server-function call and stores it
 * in request-scoped async storage. It grants nothing: every domain service
 * re-reads the workspace membership, and PostgreSQL row level security enforces
 * tenant isolation independently.
 *
 * This module is part of the client bundle (it is wired into the Start
 * configuration), so the session module — which reaches the database and
 * `node:crypto` — is imported lazily inside the server callback.
 */
export const attachAuth = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    const { authStorage, resolveSession } = await import('@/lib/auth/session')
    const session = await resolveSession()
    return authStorage.run(session, () => next({ context: { auth: session } }))
  },
)