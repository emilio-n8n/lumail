import { createFileRoute } from '@tanstack/react-router'
import { isValidSecret } from '@/lib/security/redirect'

/**
 * External, non-dashboard endpoints.
 *
 *   POST /api/public/jobs/tick     — drain the job queue (cron)
 *   POST /api/public/email-events  — delivery-status callbacks from the provider
 *
 * Both bypass normal session authentication and therefore verify the caller
 * themselves with a shared secret or a provider signature. Being under
 * `/api/public` grants nothing on its own.
 */

function isAuthorised(request: Request, secret: string): boolean {
  return isValidSecret(request.headers.get('x-lumail-secret') ?? '', secret)
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export const Route = createFileRoute('/api/public/jobs/tick')({
  server: {
    handlers: {
      GET: async () =>
        json({
          endpoint: '/api/public/jobs/tick',
          method: 'POST',
          authentication: 'x-lumail-secret header matching JOB_SECRET',
          description:
            'Claims due jobs and executes them: campaign fan-out, automation steps, webhook delivery and simulated mailbox events.',
        }),

      POST: async ({ request }) => {
        const { runDueJobs } = await import('@/lib/jobs/runner')
        const secret = process.env.JOB_SECRET
        if (!(secret && isAuthorised(request, secret))) {
          const { authenticateCronRequest } = await import('@/integrations/supabase/cron-auth')
          const denied = await authenticateCronRequest(request)
          if (denied) return denied
        }

        const summary = await runDueJobs(50)
        return json({ ok: true, ...summary })
      },
    },
  },
})
