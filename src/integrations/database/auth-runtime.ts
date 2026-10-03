import { many, one, withAdminDb } from '@/integrations/database/client'
import {
  apiKeyStorage,
  authStorage,
  ForbiddenError,
  resolveSession,
  UnauthorizedError,
  type ApiKeyContext,
  type AppRole,
  type AuthSession,
} from '@/lib/auth/session'

/**
 * The authorisation runtime.
 *
 * Every privileged operation in the product goes through one of these helpers.
 * They resolve the caller from request-scoped state, then re-read the role from
 * the database — the role cached in a session or attached to an API key is never
 * trusted on its own.
 *
 * PostgreSQL row level security is the second, independent barrier.
 */

export type { AppRole, AuthSession, ApiKeyContext }

function apiKeySession(context: ApiKeyContext): Promise<AuthSession> {
  return withAdminDb(async (tx) => {
    const membership = await one<{ role: AppRole; email: string }>(
      tx,
      `select m.role, u.email
       from public.memberships m
       join public.users u on u.id = m.user_id
       where m.workspace_id = $1 and m.user_id = $2`,
      [context.workspaceId, context.principalUserId],
    )

    if (!membership) {
      throw new ForbiddenError(
        'The API key no longer belongs to an active member',
      )
    }

    return {
      user: {
        id: context.principalUserId,
        email: membership.email,
        fullName: null,
        avatarColor: 'citron',
      },
      workspaceId: context.workspaceId,
      role: membership.role,
      sessionId: '',
      apiKeyId: context.apiKeyId,
    }
  })
}

/**
 * Current session or `null`. For API-key callers (public REST API, MCP server)
 * this resolves the key's workspace instead. Never sufficient on its own for an
 * authorisation decision — see `requireWorkspace`.
 */
export async function getAuthSession(): Promise<AuthSession | null> {
  const apiKey = apiKeyStorage.getStore()
  if (apiKey) return apiKeySession(apiKey)

  return resolveSession()
}

export async function requireAuth(): Promise<AuthSession> {
  const session = await getAuthSession()
  if (!session) throw new UnauthorizedError()
  return session
}

/** Session with a selected workspace and a membership that still exists. */
export async function requireWorkspace(
  requiredRoles?: AppRole[],
): Promise<AuthSession & { workspaceId: string }> {
  const session = await requireAuth()
  if (!session.workspaceId) throw new ForbiddenError('No workspace selected')

  const membership = await withAdminDb(async (tx) =>
    one<{ role: AppRole }>(
      tx,
      'select role from public.memberships where workspace_id = $1 and user_id = $2',
      [session.workspaceId, session.user.id],
    ),
  )

  if (!membership) {
    throw new ForbiddenError('You are not a member of this workspace')
  }
  if (requiredRoles && !requiredRoles.includes(membership.role)) {
    throw new ForbiddenError(`This action requires one of: ${requiredRoles.join(', ')}`)
  }

  return { ...session, workspaceId: session.workspaceId, role: membership.role }
}

export type WorkspaceAccess = {
  userId: string
  workspaceId: string
  role: AppRole
}

/** Membership check used by every write path. */
export async function requireWorkspaceMember(
  requiredRoles?: AppRole[],
): Promise<WorkspaceAccess> {
  const session = await requireWorkspace(requiredRoles)
  return {
    userId: session.user.id,
    workspaceId: session.workspaceId,
    role: session.role!,
  }
}

/** Membership check used for API keys, domains, webhooks and team management. */
export async function requireWorkspaceAdmin(): Promise<WorkspaceAccess> {
  const session = await requireWorkspace(['owner', 'admin'])
  return {
    userId: session.user.id,
    workspaceId: session.workspaceId,
    role: session.role!,
  }
}

/** Owner-only operations, such as changing someone's role. */
export async function requireWorkspaceOwner(): Promise<WorkspaceAccess> {
  const session = await requireWorkspace(['owner'])
  return {
    userId: session.user.id,
    workspaceId: session.workspaceId,
    role: session.role!,
  }
}

/**
 * Primes the request-scoped session cache for the duration of a server
 * function. Invoked from the global middleware in `src/start.ts`.
 */
export async function primeAuthContext(): Promise<AuthSession | null> {
  const session = await resolveSession()
  return authStorage.run(session, () => session)
}

void many