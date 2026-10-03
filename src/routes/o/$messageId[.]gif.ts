import { createFileRoute } from '@tanstack/react-router'

/**
 * Open-tracking pixel: `/o/{messageId}.gif`
 *
 * The file name is `$messageId[.]gif.ts` so the router generator treats the dot
 * as part of the segment instead of a path separator — the pixel keeps its file
 * extension, which is what mail clients expect.
 *
 * Public endpoint by necessity — it is fetched by the recipient's mail client,
 * which cannot present credentials. It is therefore extremely narrow: it accepts
 * only a message id, records one open, and returns a 1×1 transparent GIF.
 * Nothing else is exposed, and no response content depends on the caller.
 */

// 1x1 transparent GIF
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
)

export const Route = createFileRoute('/o/$messageId.gif')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        // The generator names the param after the whole segment, `.gif` included.
        const messageId = String(params['messageId.gif'] ?? '').replace(
          /\.gif$/,
          '',
        )

        if (/^[0-9a-f-]{36}$/i.test(messageId)) {
          try {
            const { applyMessageEvent } = await import(
              '@/lib/email/messages'
            )
            await applyMessageEvent({
              messageId,
              eventType: 'opened',
              ip: request.headers.get('x-forwarded-for') ?? null,
              userAgent: request.headers.get('user-agent')?.slice(0, 300) ?? null,
            })
          } catch {
            // Never fail the image request.
          }
        }

        return new Response(new Uint8Array(PIXEL), {
          status: 200,
          headers: {
            'content-type': 'image/gif',
            'content-length': String(PIXEL.byteLength),
            'cache-control': 'no-store, no-cache, must-revalidate',
          },
        })
      },
    },
  },
})