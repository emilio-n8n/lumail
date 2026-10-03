import { createFileRoute } from '@tanstack/react-router'

/**
 * One-click unsubscribe: `/unsubscribe/{token}`
 *
 * The token is HMAC-signed and bound to the contact, so nobody can unsubscribe
 * someone else by guessing. The page lists every message still queued for that
 * contact and asks for confirmation, which also satisfies the one-click header
 * used by mail clients.
 */

export const Route = createFileRoute('/unsubscribe/$token')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { verifyToken } = await import('@/lib/auth/crypto')
        const payload = verifyToken<{
          contactId: string | null
          workspaceId: string
        }>(String(params.token))

        if (!payload?.workspaceId) {
          return new Response('This unsubscribe link is invalid or has expired.', {
            status: 400,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
          })
        }

        return new Response(renderPage(payload.contactId), {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })
      },

      POST: async ({ params, request }) => {
        const { verifyToken } = await import('@/lib/auth/crypto')
        const { unsubscribeAll } = await import('@/lib/domain/contacts')
        const payload = verifyToken<{
          contactId: string | null
          workspaceId: string
        }>(String(params.token))

        if (!payload?.workspaceId) {
          return new Response('This unsubscribe link is invalid or has expired.', {
            status: 400,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
          })
        }

        const form = await request.formData()
        const all = form.get('scope') === 'all'

        const result = await unsubscribeAll(
          payload.workspaceId,
          payload.contactId,
          all,
        )

        return new Response(
          all
            ? renderDone('You have been unsubscribed from all Lumail email.')
            : renderDone(
                `You have been unsubscribed from this campaign. ${result.remaining} queued message${result.remaining === 1 ? '' : 's'} cancelled.`,
              ),
          {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
          },
        )
      },
    },
  },
})

function renderPage(contactId: string | null): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Unsubscribe</title>
<style>
  body { margin:0; background:#f7f7f5; color:#17181a;
         font-family:'IBM Plex Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
         display:flex; min-height:100vh; align-items:center; justify-content:center; padding:24px; }
  .card { max-width:440px; width:100%; background:#fff; border:1px solid #e0e0da;
          border-radius:8px; padding:28px; }
  h1 { font-size:19px; margin:0 0 10px; letter-spacing:-0.01em; }
  p { font-size:14px; line-height:1.65; color:#6a6b66; margin:0 0 18px; }
  label { display:flex; gap:10px; align-items:flex-start; font-size:14px;
          padding:12px; border:1px solid #e0e0da; border-radius:5px; margin-bottom:8px;
          cursor:pointer; color:#17181a; }
  label:hover { background:#f1f1ee; }
  label span { color:#6a6b66; font-size:13px; display:block; margin-top:2px; }
  button { width:100%; margin-top:10px; padding:10px 16px; font-size:14px; font-weight:600;
           background:#c8f542; color:#14150f; border:1px solid #c8f542;
           border-radius:5px; cursor:pointer; }
  button:hover { background:#d5ff5c; }
</style></head>
<body>
  <main class="card">
    <h1>Unsubscribe</h1>
    <p>Confirm what you would like to stop receiving.</p>
    <form method="post">
      <label>
        <input type="radio" name="scope" value="campaign" checked />
        <span><strong>Only this campaign</strong>
          <span>Cancels the messages still queued from this send.</span></span>
      </label>
      <label>
        <input type="radio" name="scope" value="all" />
        <span><strong>All Lumail email</strong>
          <span>Marks the address as unsubscribed workspace-wide.</span></span>
      </label>
      <button type="submit">Confirm</button>
    </form>
  </main>
</body></html>`
}

function renderDone(message: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Unsubscribed</title>
<style>
  body { margin:0; background:#f7f7f5; color:#17181a;
         font-family:'IBM Plex Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
         display:flex; min-height:100vh; align-items:center; justify-content:center; padding:24px; }
  .card { max-width:440px; width:100%; background:#fff; border:1px solid #e0e0da;
          border-radius:8px; padding:28px; }
  h1 { font-size:19px; margin:0 0 10px; }
  p { font-size:14px; line-height:1.65; color:#6a6b66; margin:0; }
</style></head>
<body>
  <main class="card"><h1>Done</h1><p>${message}</p></main>
</body></html>`
}
