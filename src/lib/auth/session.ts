import { AsyncLocalStorage } from 'node:async_hooks'
import {
  getCookie,
  getRequestHeaders,
  setCookie,
} from '@tanstack/react-start/server'
import { withAdminDb, one, type Tx } from '@/integrations/database/client'
import { createClient } from '@supabase/supabase-js'

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


/* ----------------------------------------------------------- Cloud auth */

function readBearer(): string | undefined {
  const header = getRequestHeaders().get('authorization')
  if (header?.toLowerCase().startsWith('bearer ')) {
    const token = header.slice(7).trim()
    if (token && token.split('.').length === 3) return token
  }
  return undefined
}

function readSessionToken(): string | undefined {
  return (
    readBearer() ??
    getCookie(SESSION_COOKIE) ??
    readCookieFromHeader(getRequestHeaders().get('cookie'), SESSION_COOKIE)
  )
}

/** Verifies a Lovable Cloud access token and returns the user it belongs to. */
export async function verifyAccessToken(
  token: string,
): Promise<{ id: string; email: string; fullName: string | null } | null> {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_PUBLISHABLE_KEY']
  if (!url || !key) return null
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  })
  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user || !data.user.email) return null
  const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>
  const fullName =
    (typeof meta['full_name'] === 'string' && meta['full_name']) ||
    (typeof meta['name'] === 'string' && meta['name']) ||
    null
  return { id: data.user.id, email: data.user.email.toLowerCase(), fullName: fullName || null }
}

type ProfileRow = {
  user_id: string
  email: string
  full_name: string | null
  avatar_color: string
  first_workspace_id: string | null
  role: AppRole | null
}

const tokenCache = new Map<string, { userId: string; expires: number }>()

async function userIdForToken(token: string): Promise<string | null> {
  const cached = tokenCache.get(token)
  if (cached && cached.expires > Date.now()) return cached.userId
  const user = await verifyAccessToken(token)
  if (!user) return null
  if (tokenCache.size > 500) tokenCache.clear()
  tokenCache.set(token, { userId: user.id, expires: Date.now() + 60_000 })
  return user.id
}

export async function resolveSession(): Promise<AuthSession | null> {
  const cached = authStorage.getStore()
  if (cached !== undefined) return cached

  const token = readSessionToken()
  if (!token) return null

  const userId = await userIdForToken(token)
  if (!userId) return null

  return withAdminDb(async (tx) => {
    const row = await one<ProfileRow>(
      tx,
      `
      select
        p.id           as user_id,
        p.email,
        p.full_name,
        p.avatar_color,
        m.workspace_id as first_workspace_id,
        m.role
      from public.profiles p
      left join lateral (
        select mm.workspace_id, mm.role
        from public.memberships mm
        where mm.user_id = p.id
        order by mm.created_at asc
        limit 1
      ) m on true
      where p.id = $1
      `,
      [userId],
    )

    if (!row) return null

    const requestedWorkspace =
      getCookie(WORKSPACE_COOKIE) ??
      readCookieFromHeader(getRequestHeaders().get('cookie'), WORKSPACE_COOKIE)

    // The cookie is a hint, not an authority: only a workspace the user is
    // actually a member of may be selected.
    const workspaceId =
      requestedWorkspace && (await isMemberOf(tx, row.user_id, requestedWorkspace))
        ? requestedWorkspace
        : row.first_workspace_id

    return {
      sessionId: '',
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

/**
 * Binds a verified Lovable Cloud session to this browser.
 *
 * Makes sure the user has a profile and at least one workspace (every new user
 * starts as owner of their own), then stores the access token in an httpOnly
 * cookie so server-rendered pages know who is asking.
 */
export async function establishSession(accessToken: string): Promise<AuthSession> {
  const user = await verifyAccessToken(accessToken)
  if (!user) throw new UnauthorizedError('Your session has expired. Sign in again.')

  await withAdminDb(async (tx) => {
    await tx.query(
      `insert into public.profiles (id, email, full_name)
       values ($1, $2, $3)
       on conflict (id) do update set email = excluded.email, last_seen_at = now()`,
      [user.id, user.email, user.fullName ?? user.email.split('@')[0]],
    )

    const membership = await one<{ id: string }>(
      tx,
      'select id from public.memberships where user_id = $1 limit 1',
      [user.id],
    )
    if (membership) return

    const slug = await uniqueSlug(tx, user.email)
    await tx.query(
      `with ws as (
         insert into public.workspaces (name, slug) values ($1, $2) returning id
       )
       insert into public.memberships (workspace_id, user_id, role)
       select id, $3, 'owner' from ws`,
      [personalWorkspaceName(user.fullName, user.email), slug, user.id],
    )
  })

  setSessionCookie(accessToken)
  tokenCache.set(accessToken, { userId: user.id, expires: Date.now() + 60_000 })

  const session = await authStorage.run(undefined as never, () => resolveSessionForToken(accessToken))
  if (!session) throw new UnauthorizedError()
  if (session.workspaceId) setWorkspaceCookie(session.workspaceId)
  return session
}

async function resolveSessionForToken(token: string): Promise<AuthSession | null> {
  const userId = await userIdForToken(token)
  if (!userId) return null
  return withAdminDb(async (tx) => {
    const row = await one<ProfileRow>(
      tx,
      `select p.id as user_id, p.email, p.full_name, p.avatar_color,
              m.workspace_id as first_workspace_id, m.role
       from public.profiles p
       left join lateral (
         select mm.workspace_id, mm.role from public.memberships mm
         where mm.user_id = p.id order by mm.created_at asc limit 1
       ) m on true
       where p.id = $1`,
      [userId],
    )
    if (!row) return null
    return {
      sessionId: '',
      user: { id: row.user_id, email: row.email, fullName: row.full_name, avatarColor: row.avatar_color },
      workspaceId: row.first_workspace_id,
      role: row.role,
    }
  })
}

export function setSessionCookie(token: string): void {
  setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })
}

export function setWorkspaceCookie(workspaceId: string): void {
  setCookie(WORKSPACE_COOKIE, workspaceId, {
    httpOnly: false,
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })
}

export async function destroySession(): Promise<void> {
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
    .split('@')[0]!
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32)
    .replace(/-$/, '')
  const root = base.length >= 2 ? base : `ws-${base || 'team'}`

  let candidate = root
  let counter = 1
  for (;;) {
    const clash = await one<{ id: string }>(
      tx,
      'select id from public.workspaces where slug = $1',
      [candidate],
    )
    if (!clash) return candidate
    counter += 1
    candidate = `${root}-${counter}`
  }
}
