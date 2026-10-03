import { createFileRoute } from '@tanstack/react-router'

/**
 * Click tracking: `/c/{token}`
 *
 * The token is an HMAC-signed pair (messageId, url), so a recipient can follow
 * the link but cannot forge one to redirect elsewhere or to attribute a click to
 * a message that was never sent. Invalid or tampered tokens go to a dead end.
 */

export const Route = createFileRoute('/c/$token')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const { verifyToken } = await import('@/lib/auth/crypto')
        const { isSafeRedirect } = await import('@/lib/security/redirect')
        const payload = verifyToken<{ messageId: string; url: string }>(
          String(params.token),
        )

        if (!payload?.url || !isSafeRedirect(payload.url)) {
          return new Response('This link is invalid or has expired.', {
            status: 400,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
          })
        }

        try {
          const [{ applyMessageEvent }, { handleTrigger }] = await Promise.all([
            import('@/lib/email/messages'),
            import('@/lib/workflows/engine'),
          ])
          const result = await applyMessageEvent({
            messageId: payload.messageId,
            eventType: 'clicked',
            url: payload.url,
            ip: request.headers.get('x-forwarded-for') ?? null,
            userAgent: request.headers.get('user-agent')?.slice(0, 300) ?? null,
          })

          if (result?.contactId) {
            void handleTrigger({
              type: 'link_clicked',
              workspaceId: result.workspaceId,
              contactId: result.contactId,
              data: { url: payload.url },
            }).catch(() => 0)
          }
        } catch {
          // Still redirect — a tracking failure must never break the click.
        }

        return new Response(null, {
          status: 302,
          headers: { location: payload.url, 'cache-control': 'no-store' },
        })
      },
    },
  },
})