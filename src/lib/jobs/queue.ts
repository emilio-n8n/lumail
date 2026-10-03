import type { Tx } from '@/integrations/database/client'
import { withAdminDb } from '@/integrations/database/client'

/**
 * A minimal, durable job queue backed by `public.scheduled_jobs`.
 *
 * It powers campaign fan-out, workflow delays, retries and simulated mailbox
 * events. It is deliberately not an external broker: the product must run
 * end-to-end from a single process.
 */

export type JobKind =
  | 'campaign_send'
  | 'workflow_step'
  | 'webhook_deliver'
  | 'mock_delivered'
  | 'mock_opened'
  | 'mock_clicked'
  | 'mock_bounce'
  | 'mock_complaint'
  | 'mock_unsubscribed'

export type JobInput = {
  workspaceId: string
  kind: JobKind
  payload?: Record<string, unknown>
  runAt?: Date
  maxAttempts?: number
}

export type JobRecord = {
  id: string
  workspace_id: string
  kind: JobKind
  payload: Record<string, unknown>
  attempts: number
  max_attempts: number
}

export type JobRow = {
  id: string
  workspace_id: string
  kind: JobKind
  payload: Record<string, unknown>
  attempts: number
  max_attempts: number
  run_at: Date
}

/**
 * Collects jobs emitted inside a scope so a fan-out of hundreds of messages
 * costs one transaction instead of hundreds.
 */
let batch: JobInput[] | null = null

export async function withJobBatch<T>(fn: () => Promise<T>): Promise<T> {
  if (batch) return fn()

  batch = []
  try {
    return await fn()
  } finally {
    const pending = batch
    batch = null
    if (pending.length > 0) {
      await flush(pending)
    }
  }
}

async function flush(jobs: JobInput[]) {
  for (const job of jobs) {
    await withAdminDb((tx) => tx.query(
      `
      insert into public.scheduled_jobs (workspace_id, kind, payload, run_at, max_attempts)
      values ($1, $2, $3, $4, $5)
      `,
      [
        job.workspaceId,
        job.kind,
        JSON.stringify(job.payload ?? {}),
        (job.runAt ?? new Date()).toISOString(),
        job.maxAttempts ?? 5,
      ],
    ))
  }
}

export async function enqueueJob(input: JobInput): Promise<void> {
  if (batch) {
    batch.push(input)
    return
  }
  await flush([input])
}

/** Inserts a job inside an existing transaction. */
export async function enqueueJobInTx(tx: Tx, input: JobInput): Promise<string> {
  const result = await tx.query<{ id: string }>(
    `
    insert into public.scheduled_jobs (workspace_id, kind, payload, run_at, max_attempts)
    values ($1, $2, $3, $4, $5)
    returning id
    `,
    [
      input.workspaceId,
      input.kind,
      JSON.stringify(input.payload ?? {}),
      (input.runAt ?? new Date()).toISOString(),
      input.maxAttempts ?? 5,
    ],
  )
  return result.rows[0]!.id
}

export async function claimDueJobs(limit: number): Promise<JobRow[]> {
  return withAdminDb(async (tx) => {
    const result = await tx.query<JobRow>(
      `
      update public.scheduled_jobs
      set status = 'processing', locked_at = now(), attempts = attempts + 1, updated_at = now()
      where id in (
        select id from public.scheduled_jobs
        where status = 'pending' and run_at <= now()
        order by run_at asc
        limit $1
        for update skip locked
      )
      returning *
      `,
      [limit],
    )
    return result.rows
  })
}

export async function completeJob(id: string): Promise<void> {
  await withAdminDb((tx) =>
    tx.query(
      `update public.scheduled_jobs set status = 'completed', updated_at = now() where id = $1`,
      [id],
    ),
  )
}

export async function failJob(
  id: string,
  error: string,
  retryable: boolean,
): Promise<void> {
  await withAdminDb(async (tx) => {
    if (!retryable) {
      await tx.query(
        `update public.scheduled_jobs set status = 'failed', last_error = $2, updated_at = now() where id = $1`,
        [id, error.slice(0, 2000)],
      )
      return
    }

    await tx.query(
      `
      update public.scheduled_jobs set
        status = case when attempts >= max_attempts then 'failed'::public.job_status else 'pending'::public.job_status end,
        run_at = now() + (least(attempts, 6) || ' minutes')::interval,
        last_error = $2,
        updated_at = now()
      where id = $1
      `,
      [id, error.slice(0, 2000)],
    )
  })
}

export async function pendingJobCount(workspaceId: string): Promise<number> {
  return withAdminDb(async (tx) => {
    const result = await tx.query<{ count: number }>(
      `select count(*)::int as count from public.scheduled_jobs where status = 'pending' and workspace_id = $1`,
      [workspaceId],
    )
    return result.rows[0]?.count ?? 0
  })
}