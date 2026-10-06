/**
 * The serverless runtime has no long-lived process, so there is no in-process
 * timer: the queue is drained by the scheduled `POST /api/public/jobs/tick`
 * callback and by the dashboard while it is open. Kept as a no-op so callers
 * that "nudge" the worker stay valid.
 */
export function ensureJobTicker(): void {}
export function stopJobTicker(): void {}
