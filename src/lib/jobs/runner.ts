import { claimDueJobs, completeJob, failJob, withJobBatch } from './queue'
import type { JobKind, JobRow } from './queue'
import { applyMessageEvent } from '@/lib/email/messages'
import { processCampaignSend } from '@/lib/domain/campaigns'
import { processWorkflowStep } from '@/lib/workflows/engine'
import { deliverWebhook } from '@/lib/webhooks/dispatch'
import { one, withAdminDb } from '@/integrations/database/client'

/**
 * The job runner. One loop, one place that knows how each job kind is handled.
 * Everything scheduled in the product — campaign fan-out, workflow delays,
 * retries, webhook delivery and the simulated mailbox lifecycle — flows through
 * here, so behaviour is identical whether it runs in dev or in production.
 */

export type RunSummary = {
  claimed: number
  completed: number
  failed: number
  kinds: Record<string, number>
}

const HANDLERS: Record<
  JobKind,
  (payload: Record<string, unknown>) => Promise<void>
> = {
  campaign_send: async (payload) => {
    await processCampaignSend({ campaignId: String(payload.campaignId) })
  },

  workflow_step: async (payload) => {
    await processWorkflowStep({
      runId: String(payload.runId),
      nodeId: payload.nodeId ? String(payload.nodeId) : null,
      goalEvent: payload.goalEvent ? String(payload.goalEvent) : undefined,
    })
  },

  webhook_deliver: async (payload) => {
    await deliverWebhook({
      webhookId: String(payload.webhookId),
      event: String(payload.event),
      data: (payload.data as Record<string, unknown>) ?? {},
    })
  },

  mock_delivered: async (payload) => {
    await applyMessageEvent({
      messageId: String(payload.messageId),
      eventType: 'delivered',
    })
  },

  mock_opened: async (payload) => {
    const event = await applyMessageEvent({
      messageId: String(payload.messageId),
      eventType: 'opened',
      userAgent: 'Mozilla/5.0 (simulated open)',
    })
    if (event?.contactId) {
      const { contactId, workspaceId } = event
      await dispatchEngagementTrigger(workspaceId, contactId, 'email_opened')
    }
  },

  mock_clicked: async (payload) => {
    const event = await applyMessageEvent({
      messageId: String(payload.messageId),
      eventType: 'clicked',
      url: 'https://example.com/pricing',
      userAgent: 'Mozilla/5.0 (simulated click)',
    })
    if (event?.contactId) {
      const { contactId, workspaceId } = event
      await dispatchEngagementTrigger(workspaceId, contactId, 'link_clicked', {
        url: 'https://example.com/pricing',
      })
    }
  },

  mock_bounce: async (payload) => {
    await applyMessageEvent({
      messageId: String(payload.messageId),
      eventType: 'bounced',
      metadata: { reason: payload.reason ?? '550 mailbox unavailable' },
    })
  },

  mock_complaint: async (payload) => {
    await applyMessageEvent({
      messageId: String(payload.messageId),
      eventType: 'complained',
    })
  },

  mock_unsubscribed: async (payload) => {
    const event = await applyMessageEvent({
      messageId: String(payload.messageId),
      eventType: 'unsubscribed',
    })
    if (event?.contactId) {
      const { contactId, workspaceId } = event
      await dispatchEngagementTrigger(workspaceId, contactId, 'custom_event', {
        eventName: 'unsubscribed',
      })
    }
  },
}

async function dispatchEngagementTrigger(
  workspaceId: string,
  contactId: string,
  type: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  const { handleTrigger } = await import('@/lib/workflows/engine')
  try {
    await handleTrigger({ type, workspaceId, contactId, data })
  } catch (error) {
    console.error('[jobs] trigger dispatch failed:', (error as Error).message)
  }
}

/**
 * How many claimed jobs run at once.
 *
 * Handlers do two very different kinds of work. Database work is serialised
 * anyway — PGlite has one connection — but outbound webhook delivery waits on
 * the network. Running those one at a time let a single unreachable endpoint
 * block the whole worker for the length of its timeout, which starved every
 * other kind of job behind it. A small amount of concurrency fixes that without
 * adding any database pressure.
 */
const JOB_CONCURRENCY = 8

/** Runs `fn` over `items` with at most `size` in flight at a time. */
async function inBatches<T>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  for (let index = 0; index < items.length; index += size) {
    await Promise.all(items.slice(index, index + size).map(fn))
  }
}

export async function runDueJobs(limit = 25): Promise<RunSummary> {
  const jobs = await claimDueJobs(limit)
  const summary: RunSummary = { claimed: 0, completed: 0, failed: 0, kinds: {} }

  for (const job of jobs) {
    summary.claimed += 1
    summary.kinds[job.kind] = (summary.kinds[job.kind] ?? 0) + 1
  }

  await inBatches(jobs, JOB_CONCURRENCY, async (job) => {
    const handler = HANDLERS[job.kind]

    if (!handler) {
      await failJob(job.id, `No handler for job kind "${job.kind}"`, false)
      summary.failed += 1
      return
    }

    try {
      // Batch the job inserts a handler creates so a fan-out costs one
      // transaction instead of one per message.
      await withJobBatch(() => handler((job.payload ?? {}) as Record<string, unknown>))
      await completeJob(job.id)
      summary.completed += 1
    } catch (error) {
      const message = (error as Error).message
      console.error(`[jobs] ${job.kind} (${job.id}) failed:`, message)
      await failJob(job.id, message, (job.attempts ?? 0) < (job.max_attempts ?? 5))
      summary.failed += 1
    }
  })

  await sweepScheduledCampaigns()

  return summary
}

/**
 * Launches campaigns whose scheduled time has arrived. Kept separate from the
 * job table so that editing `scheduledAt` takes effect immediately.
 */
export async function sweepScheduledCampaigns(): Promise<number> {
  const due = await withAdminDb(async (tx) => {
    const rows = await tx.query<{ id: string }>(
      `
      update public.campaigns
      set status = 'draft', updated_at = now()
      where status = 'scheduled' and scheduled_at is not null and scheduled_at <= now()
      returning id
      `,
    )
    return rows.rows
  })

  if (due.length === 0) return 0

  const { launchCampaign } = await import('@/lib/domain/campaigns')
  for (const row of due) {
    try {
      await launchCampaign(row.id)
    } catch (error) {
      console.error(`[jobs] scheduled campaign ${row.id} failed:`, (error as Error).message)
    }
  }

  return due.length
}

/** Health surface used by the Settings page. */
export async function jobHealth() {
  return withAdminDb(async (tx) => {
    const counts = await tx.query<{ status: string; count: number }>(
      `select status::text, count(*)::int as count
       from public.scheduled_jobs group by status`,
    )
    const lastError = await one<{ last_error: string; created_at: Date }>(
      tx,
      `select last_error, created_at from public.scheduled_jobs
       where status = 'failed' order by created_at desc limit 1`,
    )
    return {
      counts: Object.fromEntries(counts.rows.map((row) => [row.status, row.count])),
      lastError: lastError?.last_error ?? null,
      lastErrorAt: lastError?.created_at ?? null,
    }
  })
}