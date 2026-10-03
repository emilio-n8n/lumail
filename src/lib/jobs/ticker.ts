import { runDueJobs } from './runner'

/**
 * In-process job ticker.
 *
 * A durable queue needs a worker. In production that is a cron hitting
 * `POST /api/public/jobs/tick` with the shared secret; for a single-process
 * deployment (and for the demo to feel alive) a lightweight interval is started
 * once per process instead.
 */

declare global {
  // eslint-disable-next-line no-var
  var __lumailTicker: NodeJS.Timeout | undefined
}

const INTERVAL_MS = Number(process.env.JOB_TICK_INTERVAL_MS ?? 2000)

let running = false

export function ensureJobTicker(): void {
  if (process.env.JOB_TICKER === 'off') return
  if (globalThis.__lumailTicker) return

  globalThis.__lumailTicker = setInterval(() => {
    if (running) return
    running = true
    void runDueJobs(25)
      .catch((error) => {
        console.error('[ticker]', (error as Error).message)
      })
      .finally(() => {
        running = false
      })
  }, INTERVAL_MS)

  // Never hold the process open just for the ticker.
  globalThis.__lumailTicker.unref?.()
}

export function stopJobTicker(): void {
  if (globalThis.__lumailTicker) {
    clearInterval(globalThis.__lumailTicker)
    globalThis.__lumailTicker = undefined
  }
}