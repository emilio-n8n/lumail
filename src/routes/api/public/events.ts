import { createFileRoute } from '@tanstack/react-router'

/**
 * External webhooks: `/api/public/events`
 *
 * This route is outside the dashboard's authentication flow, so it verifies the
 * caller itself with a workspace API key. It accepts an event from an external
 * system and starts every matching automation — the programmatic entry point
 * into the automation engine.
 */

function verifyBearer(request: Request): { key: string } | null {
  const header = request.headers.get('authorization') ?? ''
  if (!header.startsWith('Bearer ')) return null
  return { key: header.slice(7) }
}

export const Route = createFileRoute('/api/public/events')({
  server: {
    handlers: {
      GET: async () =>
        new Response(
          JSON.stringify({
            endpoint: '/api/public/events',
            method: 'POST',
            authentication: 'Authorization: Bearer lm_live_…',
            body: { name: 'string', contactId: 'uuid', data: 'object' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),

      POST: async ({ request }) => {
        const [{ withAdminDb, one }, { resolveApiKey }, { apiKeyStorage }] =
          await Promise.all([
            import('@/integrations/database/client'),
            import('@/lib/domain/platform'),
            import('@/lib/auth/session'),
          ])
        const bearer = verifyBearer(request)
        if (!bearer) {
          return new Response(
            JSON.stringify({ error: 'Provide an API key as "Authorization: Bearer lm_live_…"' }),
            { status: 401, headers: { 'content-type': 'application/json' } },
          )
        }

        const resolved = await resolveApiKey(bearer.key)
        if (!resolved) {
          return new Response(JSON.stringify({ error: 'Invalid or revoked API key' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          })
        }

        const payload = (await request.json().catch(() => null)) as {
          name?: string
          contactId?: string
          email?: string
          data?: Record<string, unknown>
        } | null

        if (!payload?.name) {
          return new Response(JSON.stringify({ error: 'An event "name" is required' }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          })
        }

        const context = {
          workspaceId: resolved.workspaceId,
          apiKeyId: resolved.apiKeyId,
          scopes: resolved.scopes,
          name: resolved.name,
          principalUserId: resolved.principalUserId,
        }

        return apiKeyStorage.run(context, async () => {
          const contactId = await resolveContactId(context.workspaceId, payload)
          if (!contactId) {
            return new Response(
              JSON.stringify({
                error: 'A contactId, or an email that resolves to a contact, is required',
              }),
              { status: 400, headers: { 'content-type': 'application/json' } },
            )
          }

          const { handleTrigger } = await import('@/lib/workflows/engine')
          const started = await handleTrigger({
            type: 'custom_event',
            workspaceId: context.workspaceId,
            contactId,
            data: { eventName: payload.name, ...(payload.data ?? {}) },
          })

          return new Response(
            JSON.stringify({ ok: true, event: payload.name, automationsStarted: started }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        })
      },
    },
  },
})

async function resolveContactId(
  workspaceId: string,
  payload: { contactId?: string; email?: string },
): Promise<string | null> {
  if (payload.contactId) return payload.contactId
  if (!payload.email) return null

  const { withAdminDb, one } = await import(
    '@/integrations/database/client'
  )

  const row = await withAdminDb((tx) =>
    one<{ id: string }>(
      tx,
      'select id from public.contacts where workspace_id = $1 and email = $2',
      [workspaceId, payload.email!.toLowerCase()],
    ),
  )
  return row?.id ?? null
}
