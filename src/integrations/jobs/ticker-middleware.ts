import { createMiddleware } from '@tanstack/react-start'

/**
 * Boots the in-process job worker.
 *
 * Campaign sends, workflow delays, webhook deliveries and simulated mailbox
 * events all end up in `public.scheduled_jobs`, which needs a worker to drain
 * it. Two workers are supported: an external cron calling
 * `POST /api/public/jobs/tick` with the shared secret, and this interval for
 * single-process deployments. `ensureJobTicker` is idempotent (it guards on a
 * process global), so calling it on the first request is enough to make the
 * queue live for every entry point — UI, REST and MCP alike.
 *
 * The ticker reaches the database, so it is imported lazily inside the server
 * callback rather than at module scope.
 */
export const startJobTicker = createMiddleware({ type: 'request' }).server(
  async ({ next }) => {
    const { ensureJobTicker } = await import('@/lib/jobs/ticker')
    ensureJobTicker()
    return next()
  },
)