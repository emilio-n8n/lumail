import type { Tx } from '@/integrations/database/client'
import { many } from '@/integrations/database/client'
import type { ActivityItem, EventType } from './types'
import { mapActivity } from './mappers'

/**
 * The activity stream. Every meaningful thing that happens to a contact writes
 * one immutable row here — which is what powers the contact timeline, campaign
 * analytics, segment conditions and workflow triggers from a single source.
 */
export async function recordEvent(
  tx: Tx,
  input: {
    workspaceId: string
    contactId?: string | null
    eventType: EventType
    campaignId?: string | null
    messageId?: string | null
    workflowId?: string | null
    nodeId?: string | null
    url?: string | null
    ip?: string | null
    userAgent?: string | null
    metadata?: Record<string, unknown>
  },
): Promise<string> {
  const result = await tx.query<{ id: string }>(
    `
    insert into public.contact_events (
      workspace_id, contact_id, event_type, campaign_id, message_id,
      workflow_id, node_id, url, ip, user_agent, metadata
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    returning id
    `,
    [
      input.workspaceId,
      input.contactId ?? null,
      input.eventType,
      input.campaignId ?? null,
      input.messageId ?? null,
      input.workflowId ?? null,
      input.nodeId ?? null,
      input.url ?? null,
      input.ip ?? null,
      input.userAgent ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  )

  if (input.contactId) {
    await tx.query(
      `update public.contacts set last_activity_at = $2, updated_at = $2 where id = $1`,
      [input.contactId, new Date().toISOString()],
    )
  }

  return result.rows[0]!.id
}

export async function listActivity(
  tx: Tx,
  input: {
    contactId?: string | null
    campaignId?: string | null
    eventTypes?: EventType[]
    limit?: number
  },
): Promise<ActivityItem[]> {
  const params: unknown[] = []
  const filters: string[] = []

  if (input.contactId) {
    params.push(input.contactId)
    filters.push(`e.contact_id = $${params.length}`)
  }
  if (input.campaignId) {
    params.push(input.campaignId)
    filters.push(`e.campaign_id = $${params.length}`)
  }
  if (input.eventTypes?.length) {
    params.push(input.eventTypes)
    filters.push(`e.event_type = any($${params.length}::public.event_type[])`)
  }

  params.push(Math.min(input.limit ?? 100, 500))

  const rows = await many<Record<string, any>>(
    tx,
    `
    select e.*, c.email as contact_email, camp.name as campaign_name
    from public.contact_events e
    left join public.contacts c on c.id = e.contact_id
    left join public.campaigns camp on camp.id = e.campaign_id
    ${filters.length ? `where ${filters.join(' and ')}` : ''}
    order by e.occurred_at desc
    limit $${params.length}
    `,
    params,
  )

  return rows.map(mapActivity)
}