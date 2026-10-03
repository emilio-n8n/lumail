import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { z } from 'zod'

/**
 * Auth server functions.
 *
 * The domain layer reaches the database and `node:crypto`, so it must never
 * enter the browser graph. `createServerOnlyFn` is the boundary: the framework
 * replaces the body with a throwing stub in the client build and drops its
 * imports, while the server keeps the real implementation.
 */

const sessionDeps = createServerOnlyFn(async () => {
  const [crypto, domain] = await Promise.all([
    import('@/lib/auth/session'),
    import('@/lib/domain/workspace'),
  ])
  return {
    createSession: crypto.createSession,
    destroySession: crypto.destroySession,
    resolveSession: crypto.resolveSession,
    setWorkspaceCookie: crypto.setWorkspaceCookie,
    ForbiddenError: crypto.ForbiddenError,
    listUserWorkspaces: domain.listUserWorkspaces,
  }
})

function session() {
  return sessionDeps()
}

/**
 * Normalises an error for the browser.
 *
 * Domain errors carry an HTTP status and are surfaced verbatim. Anything else is
 * treated as a bug: the detail is logged server-side and the client receives a
 * generic message, so internals are never leaked.
 */
export function toClientError(error: unknown): {
  message: string
  status: number
  code: string
} {
  const status = (error as { status?: number }).status
  if (typeof status === 'number' && status >= 400 && status < 600) {
    return {
      message: (error as Error).message,
      status,
      code: (error as Error).name,
    }
  }

  if (error instanceof z.ZodError) {
    return {
      message: error.issues.map((issue) => issue.message).join(', '),
      status: 400,
      code: 'ValidationError',
    }
  }

  const redirectSignal = error as { isRedirect?: boolean }
  if (typeof redirectSignal?.isRedirect === 'boolean') throw error

  console.error('[server-fn] unhandled error:', error)
  return {
    message: 'Something went wrong. Please try again.',
    status: 500,
    code: 'InternalError',
  }
}

/** Runs a handler and re-throws a typed error the client can act on. */
export async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    const clientError = toClientError(error)
    const thrown = new Error(clientError.message) as Error & {
      status: number
      code: string
    }
    thrown.status = clientError.status
    thrown.code = clientError.code
    throw thrown
  }
}

export const authSignup = createServerFn({ method: 'POST' })
    .validator(
      z.object({
        email: z.string().email('Enter a valid email address'),
        password: z.string().min(8, 'Use at least 8 characters'),
        fullName: z.string().min(1).max(120).optional(),
      }),
    )
    .handler(async ({ data }) =>
      guard(async () => {
        const { createSession, setWorkspaceCookie } = await session()
        const result = await createSession({
          email: data.email,
          password: data.password,
          fullName: data.fullName ?? null,
        })
        if (result.workspaceId) setWorkspaceCookie(result.workspaceId)
        return {
          ok: true,
          user: result.user,
          workspaceId: result.workspaceId,
        }
      }),
    )

export const authLogin = createServerFn({ method: 'POST' })
    .validator(
      z.object({
        email: z.string().email('Enter a valid email address'),
        password: z.string().min(1, 'Enter your password'),
      }),
    )
    .handler(async ({ data }) =>
      guard(async () => {
        const { createSession, setWorkspaceCookie } = await session()
        const result = await createSession(data)
        if (result.workspaceId) setWorkspaceCookie(result.workspaceId)
        return {
          ok: true,
          user: result.user,
          workspaceId: result.workspaceId,
        }
      }),
    )

export const authLogout = createServerFn({ method: 'POST' }).handler(async () =>
    guard(async () => {
      const { destroySession } = await session()
      await destroySession()
      return { ok: true }
    }),
  )

export const authWhoami = createServerFn({ method: 'GET' }).handler(async () =>
    guard(async () => {
      const { resolveSession } = await session()
      const current = await resolveSession()
      return {
        authenticated: Boolean(current),
        workspaceId: current?.workspaceId ?? null,
      }
    }),
  )

export const authWorkspaces = createServerFn({ method: 'GET' }).handler(async () =>
    guard(async () => {
      const { listUserWorkspaces } = await session()
      return { workspaces: await listUserWorkspaces() }
    }),
  )

export const authSwitchWorkspace = createServerFn({ method: 'POST' })
    .validator(z.object({ workspaceId: z.string().uuid() }))
    .handler(async ({ data }) =>
      guard(async () => {
        const { listUserWorkspaces, setWorkspaceCookie, ForbiddenError } =
          await session()
        const workspaces = await listUserWorkspaces()
        if (!workspaces.some((workspace) => workspace.id === data.workspaceId)) {
          throw new ForbiddenError('You are not a member of that workspace')
        }
        setWorkspaceCookie(data.workspaceId)
        return { ok: true }
      }),
    )

export const authServerFns = {
  signup: authSignup,
  login: authLogin,
  logout: authLogout,
  whoami: authWhoami,
  workspaces: authWorkspaces,
  switchWorkspace: authSwitchWorkspace,
}

