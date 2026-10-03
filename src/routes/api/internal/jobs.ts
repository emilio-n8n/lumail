import { createFileRoute } from '@tanstack/react-router'

/**
 * Internal worker bootstrap: `GET /api/internal/jobs`
 *
 * The durable job queue needs a worker. Rather than starting one per request,
 * the dashboard calls this once when it mounts and the worker then runs for the
 * lifetime of the process.
 *
 * The endpoint returns the queue's current state so the Settings → Jobs panel
 * and a monitoring system can use it as a health probe.
 *
 * This is a server route, so its module never reaches the browser bundle — which
 * is what lets it import the worker directly.
 */
export const Route = createFileRoute('/api/internal/jobs')({
  server: {
    handlers: {
      GET: async () => {
        const { ensureJobTicker } = await import('@/lib/jobs/ticker')
        const { jobHealth } = await import('@/lib/jobs/runner')

        ensureJobTicker()
        const health = await jobHealth()

        return new Response(
          JSON.stringify({
            ok: true,
            ticker: 'running',
            queue: health.counts,
            lastError: health.lastError,
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
          },
        )
      },
    },
  },
})