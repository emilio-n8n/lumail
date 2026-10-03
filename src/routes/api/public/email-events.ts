import { createFileRoute } from '@tanstack/react-router'

/**
 * Provider delivery-status callbacks: `/api/public/email-events`
 *
 * Public by necessity, and therefore self-verifying: the payload is only trusted
 * when its HMAC signature checks out against RESEND_WEBHOOK_SECRET.
 */

export const Route = createFileRoute('/api/public/email-events')({
  server: {
    handlers: {
      GET: async () =>
        json({
          endpoint: '/api/public/email-events',
          method: 'POST',
          authentication: 'Resend svix signature over the raw request body',
        }),

      POST: async ({ request }) => {
        const { verifyResendSignature, mapResendEvent } = await import(
          '@/lib/email/resend'
        )
        const { applyMessageEvent } = await import('@/lib/email/messages')
        const { handleTrigger } = await import('@/lib/workflows/engine')
        const { withAdminDb, one } = await import(
          '@/integrations/database/client'
        )
        const secret = process.env.RESEND_WEBHOOK_SECRET
        if (!secret) {
          return json({ error: 'RESEND_WEBHOOK_SECRET is not configured' }, 503)
        }

        const raw = await request.text()
        const headers = Object.fromEntries(
          Array.from(request.headers.entries()).map(([key, value]) => [
            key.toLowerCase(),
            value,
          ]),
        )

        if (!verifyResendSignature(raw, headers, secret)) {
          return json({ error: 'Invalid signature' }, 401)
        }

        const payload = JSON.parse(raw) as {
          type?: string
          created_at?: string
          data?: { email_id?: string }
        }

        const type = mapResendEvent(payload.type ?? '')
        if (!type) return json({ ok: true, ignored: payload.type ?? 'unknown' })

        const messageId = payload.data?.email_id
          ? await withAdminDb(async (tx) =>
              one<{ id: string }>(
                tx,
                'select id from public.email_messages where provider_message_id = $1 limit 1',
                [payload.data!.email_id],
              ),
            )
          : null

        if (!messageId) return json({ ok: true, ignored: 'no matching message' })

        const eventMap = {
          'email.delivered': 'delivered',
          'email.opened': 'opened',
          'email.clicked': 'clicked',
          'email.bounced': 'bounced',
          'email.complained': 'complained',
        } as const

        const event = eventMap[type as keyof typeof eventMap]
        if (!event) return json({ ok: true, ignored: type })

        const result = await applyMessageEvent({
          messageId: messageId.id,
          eventType: event,
          occurredAt: payload.created_at ? new Date(payload.created_at) : undefined,
        })

        if (event === 'opened' && result?.contactId) {
          void handleTrigger({
            type: 'email_opened',
            workspaceId: result.workspaceId,
            contactId: result.contactId,
          }).catch(() => 0)
        }

        return json({ ok: true, event, messageId: messageId.id })
      },
    },
  },
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
