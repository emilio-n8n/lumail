import { many, withAdminDb } from '@/integrations/database/client'
import { enqueueJob } from '@/lib/jobs/queue'
import { createHmac } from 'node:crypto'

/**
 * Outbound webhooks.
 *
 * Subscribers receive signed deliveries for the events they selected. Delivery
 * happens through the job queue with exponential-ish backoff, and every attempt
 * is logged in `public.webhook_deliveries` so failures are inspectable in the UI.
 *
 * The request timeout is deliberately short. An endpoint that never answers must
 * not be able to hold a worker slot for long enough to delay unrelated jobs.
 */

import { WEBHOOK_EVENTS, type WebhookEvent } from './events'

export { WEBHOOK_EVENTS }
export type { WebhookEvent } 

export async function queueEventWebhooks(
  workspaceId: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const endpoints = await withAdminDb(async (tx) =>
    many<{ id: string; url: string; events: unknown }>(
      tx,
      `select id, url, events from public.webhooks
       where workspace_id = $1 and is_active = true`,
      [workspaceId],
    ),
  )

  for (const endpoint of endpoints) {
    const subscribed = Array.isArray(endpoint.events) ? (endpoint.events as string[]) : []
    if (!subscribed.includes('*') && !subscribed.includes(event)) continue

    await enqueueJob({
      workspaceId,
      kind: 'webhook_deliver',
      payload: { webhookId: endpoint.id, event, data: payload },
      maxAttempts: 6,
    })
  }
}

export async function deliverWebhook(job: {
  webhookId: string
  event: string
  data: Record<string, unknown>
}): Promise<void> {
  const record = await withAdminDb(async (tx) =>
    many<Record<string, any>>(
      tx,
      'select * from public.webhooks where id = $1',
      [job.webhookId],
    ),
  )

  const endpoint = record[0]
  if (!endpoint || !endpoint.is_active) return

  const deliveryId = await withAdminDb(async (tx) => {
    const row = await tx.query<{ id: string }>(
      `
      insert into public.webhook_deliveries (workspace_id, webhook_id, event, payload, status)
      values ($1,$2,$3,$4,'processing')
      returning id
      `,
      [endpoint.workspace_id, job.webhookId, job.event, JSON.stringify(job.data)],
    )
    return row.rows[0]!.id
  })

  const body = JSON.stringify({
    event: job.event,
    createdAt: new Date().toISOString(),
    workspaceId: endpoint.workspace_id,
    data: job.data,
  })

  const signature = createHmac('sha256', endpoint.secret as string)
    .update(body)
    .digest('hex')

  let status = 0
  let error: string | null = null
  try {
    const response = await fetch(endpoint.url as string, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-lumail-event': job.event,
        'x-lumail-delivery': deliveryId,
        'x-lumail-signature': `sha256=${signature}`,
        'user-agent': 'Lumail-Webhook/1.0',
      },
      body,
      signal: AbortSignal.timeout(5_000),
    })
    status = response.status
    if (!response.ok) error = `HTTP ${response.status}`
  } catch (caught) {
    error = (caught as Error).message
  }

  await withAdminDb(async (tx) => {
    await tx.query(
      `
      update public.webhook_deliveries set
        status = $2::public.job_status, response_code = $3, error = $4,
        attempts = attempts + 1, completed_at = now()
      where id = $1
      `,
      [deliveryId, error ? 'failed' : 'completed', status || null, error],
    )
    await tx.query(
      `update public.webhooks set last_status = $2, last_delivery_at = now(), last_error = $3 where id = $1`,
      [job.webhookId, status || null, error],
    )
  })

  if (error) throw new Error(error)
}