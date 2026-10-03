import { AsyncLocalStorage } from 'node:async_hooks'
import {
  getCookie,
  getRequestHeaders,
  setCookie,
} from '@tanstack/react-start/server'
import { withAdminDb, one, type Tx } from '@/integrations/database/client'
import { generateToken, hashPassword, sha256, verifyPassword } from './crypto'

export const SESSION_COOKIE = 'lm_session'
export const WORKSPACE_COOKIE = 'lm_workspace'
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30

export type AppRole = 'owner' | 'admin' | 'member'

export type AuthUser = {
  id: string
  email: string
  fullName: string | null
  avatarColor: string
}

export type AuthSession = {
  user: AuthUser
  workspaceId: string | null
  role: AppRole | null
  sessionId: string
  /** Set when the caller authenticated with an API key instead of a session. */
  apiKeyId?: string
}

export class UnauthorizedError extends Error {
  status = 401
  constructor(message = 'Authentication required') {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends Error {
  status = 403
  constructor(message = 'You do not have access to this resource') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

export class NotFoundError extends Error {
  status = 404
  constructor(message = 'Not found') {
    super(message)
    this.name = 'NotFoundError'
  }
}

export class ValidationError extends Error {
  status = 400
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

/**
 * Per-request session cache. The global `attachAuth` function middleware primes
 * this store once per server-function call; route handlers fall back to reading
 * the cookie directly.
 */
export const authStorage = new AsyncLocalStorage<AuthSession | null>()

/**
 * Request-scoped store for API-key callers (public REST API, MCP server, webhooks).
 *
 * When present, `requireWorkspace` resolves authorisation from it instead of the
 * session cookie. This is what lets an agent call the *same* domain services as
 * the dashboard — there is no second, weaker implementation.
 */
export type ApiKeyContext = {
  workspaceId: string
  apiKeyId: string
  scopes: string[]
  name: string
  /** The member the key acts on behalf of; drives the effective role. */
  principalUserId: string
}

export const apiKeyStorage = new AsyncLocalStorage<ApiKeyContext | null>()

type SessionRow = {
  session_id: string
  expires_at: Date
  user_id: string
  email: string
  full_name: string | null
  avatar_color: string
  last_workspace_id: string | null
  role: AppRole | null
}

export async function resolveSession(): Promise<AuthSession | null> {
  const cached = authStorage.getStore()
  if (cached !== undefined) return cached

  const token =
    getCookie(SESSION_COOKIE) ??
    readCookieFromHeader(getRequestHeaders().get('cookie'), SESSION_COOKIE)

  if (!token) return null

  return withAdminDb(async (tx) => {
    const row = await one<SessionRow>(
      tx,
      `
      select
        s.id                as session_id,
        s.expires_at,
        u.id                as user_id,
        u.email,
        u.full_name,
        u.avatar_color,
        m.workspace_id      as last_workspace_id,
        m.role
      from public.sessions s
      join public.users u on u.id = s.user_id
      left join lateral (
        select mm.workspace_id, mm.role
        from public.memberships mm
        where mm.user_id = u.id
        order by mm.created_at asc
        limit 1
      ) m on true
      where s.token_hash = $1
        and s.expires_at > now()
      `,
      [sha256(token)],
    )

    if (!row) return null

    const requestedWorkspace =
      getCookie(WORKSPACE_COOKIE) ??
      readCookieFromHeader(getRequestHeaders().get('cookie'), WORKSPACE_COOKIE)

    // The cookie is a hint, not an authority: only a workspace the user is
    // actually a member of may be selected. Anything else falls back to their
    // first workspace, which also keeps a stale or hand-edited cookie from
    // reaching a uuid parameter.
    const workspaceId =
      requestedWorkspace && (await isMemberOf(tx, row.user_id, requestedWorkspace))
        ? requestedWorkspace
        : row.last_workspace_id

    return {
      sessionId: row.session_id,
      user: {
        id: row.user_id,
        email: row.email,
        fullName: row.full_name,
        avatarColor: row.avatar_color,
      },
      workspaceId,
      role: row.role,
    } satisfies AuthSession
  })
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function isMemberOf(
  tx: Tx,
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  if (!UUID_RE.test(workspaceId)) return false
  const row = await one<{ id: string }>(
    tx,
    'select id from public.memberships where user_id = $1 and workspace_id = $2',
    [userId, workspaceId],
  )
  return Boolean(row)
}

function readCookieFromHeader(
  header: string | null | undefined,
  name: string,
): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return undefined
}

export async function createSession(input: {
  email: string
  password: string
  fullName?: string | null
  userAgent?: string | null
  ip?: string | null
}): Promise<AuthSession> {
  const passwordHash = hashPassword(input.password)

  return withAdminDb(async (tx) => {
    const existing = await one<{ id: string }>(
      tx,
      'select id from public.users where email = $1',
      [input.email.toLowerCase()],
    )

    let userId = existing?.id

    if (!userId) {
      const created = await one<{ id: string }>(
        tx,
        `
        insert into public.users (email, password_hash, full_name)
        values ($1, $2, $3)
        returning id
        `,
        [input.email.toLowerCase(), passwordHash, input.fullName ?? null],
      )
      userId = created!.id

      // Every new user starts with their own workspace as owner. The slug
      // lookup reuses the open transaction: opening a second one here would
      // deadlock against the single PGlite connection.
      const slug = await uniqueSlug(tx, input.email)
      const workspace = await one<{ id: string }>(
        tx,
        `
        insert into public.workspaces (name, slug)
        values ($1, $2)
        returning id
        `,
        [personalWorkspaceName(input.fullName, input.email), slug],
      )
      await tx.query(
        `insert into public.memberships (workspace_id, user_id, role) values ($1, $2, 'owner')`,
        [workspace!.id, userId],
      )
    } else {
      const row = await one<{ password_hash: string }>(
        tx,
        'select password_hash from public.users where id = $1',
        [userId],
      )
      if (!row || !verifyPassword(input.password, row.password_hash)) {
        throw new UnauthorizedError('Incorrect email or password')
      }
    }

    const token = generateToken()
    await tx.query(
      `
      insert into public.sessions (user_id, token_hash, expires_at, user_agent, ip)
      values ($1, $2, now() + ($3 || ' seconds')::interval, $4, $5)
      `,
      [userId, sha256(token), String(SESSION_TTL_SECONDS), input.userAgent ?? null, input.ip ?? null],
    )

    const user = await one<AuthUser>(
      tx,
      'select id, email, full_name as "fullName", avatar_color as "avatarColor" from public.users where id = $1',
      [userId],
    )
    const membership = await one<{ workspace_id: string; role: AppRole }>(
      tx,
      'select workspace_id, role from public.memberships where user_id = $1 order by created_at asc limit 1',
      [userId],
    )

    setSessionCookie(token)

    return {
      sessionId: '',
      user: user!,
      workspaceId: membership?.workspace_id ?? null,
      role: membership?.role ?? null,
    } satisfies AuthSession
  })
}

export function setSessionCookie(token: string): void {
  setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })
}

export function setWorkspaceCookie(workspaceId: string): void {
  setCookie(WORKSPACE_COOKIE, workspaceId, {
    httpOnly: false,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })
}

export async function destroySession(): Promise<void> {
  const token = getCookie(SESSION_COOKIE)
  if (token) {
    await withAdminDb(async (tx) => {
      await tx.query('delete from public.sessions where token_hash = $1', [
        sha256(token),
      ])
    })
  }
  setCookie(SESSION_COOKIE, '', { path: '/', maxAge: 0 })
}

function personalWorkspaceName(
  fullName: string | null | undefined,
  email: string,
): string {
  if (fullName?.trim()) return `${fullName.trim()}'s workspace`
  return `${email.split('@')[0]}'s workspace`
}

async function uniqueSlug(tx: Tx, seed: string): Promise<string> {
  const base = seed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32)
    .replace(/-$/, '')
    || 'workspace'

  let candidate = base
  let counter = 1
  for (;;) {
    const clash = await one<{ id: string }>(
      tx,
      'select id from public.workspaces where slug = $1',
      [candidate],
    )
    if (!clash) return candidate
    counter += 1
    candidate = `${base}-${counter}`
  }
}