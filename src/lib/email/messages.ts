import { many, one, withAdminDb } from '@/integrations/database/client'
import { recordEvent } from '@/lib/domain/activity'
import type { EmailMessage, EventType } from '@/lib/domain/types'
import { mapMessage } from '@/lib/domain/mappers'

/**
 * The message ledger. One row per outbound message, shared by campaigns,
 * automations and the transactional API. Analytics, the contact timeline and
 * workflow conditions are all derived from it.
 */

export type MessageEventInput = {
  messageId: string
  eventType: Extract<
    EventType,
    'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'complained' | 'unsubscribed'
  >
  url?: string | null
  ip?: string | null
  userAgent?: string | null
  metadata?: Record<string, unknown>
  /** For historical backfill (seeding); defaults to now. */
  occurredAt?: Date
  /** Skip writing the duplicate activity row (seeding writes them in bulk). */
  skipActivityEvent?: boolean
}

export async function applyMessageEvent(
  input: MessageEventInput,
): Promise<{ contactId: string | null; workspaceId: string } | null> {
  return withAdminDb(async (tx) => {
    const message = await one<Record<string, any>>(
      tx,
      'select * from public.email_messages where id = $1',
      [input.messageId],
    )
    if (!message) {
      // The message is gone — its campaign was deleted between the event being
      // reported and being processed. There is nothing to record and retrying
      // cannot change that, so this is a no-op rather than a failure: throwing
      // here used to fill the queue with permanently failing jobs.
      console.warn(`[email] ignoring event for missing message ${input.messageId}`)
      return null
    }

    const occurredAt = (input.occurredAt ?? new Date()).toISOString()
    const workspaceId = message.workspace_id as string

    // Terminal states are absorbing: a late "delivered" must not resurrect a
    // message that already bounced.
    const terminal = ['bounced', 'complained', 'unsubscribed']
    const current = String(message.status)
    if (terminal.includes(current) && input.eventType !== current) {
      return {
        contactId: message.contact_id as string | null,
        workspaceId,
      }
    }

    // Opens and clicks are first-touch for the timestamps but always counted.
    const columnByEvent: Partial<Record<MessageEventInput['eventType'], string>> = {
      delivered: 'delivered_at',
      opened: 'first_opened_at',
      clicked: 'first_clicked_at',
      bounced: 'bounced_at',
    }
    const column = columnByEvent[input.eventType]
    const nextStatus = statusAfter(current, input.eventType)

    await tx.query(
      `
      update public.email_messages set
        status = $2::public.message_status,
        ${column ? `${column} = coalesce(${column}, $3)` : 'sent_at = coalesce(sent_at, $3)'}
      where id = $1
      `,
      [input.messageId, nextStatus, occurredAt],
    )

    if (input.eventType === 'unsubscribed' && message.contact_id) {
      await tx.query(
        `update public.contacts
         set status = 'unsubscribed', unsubscribed_at = $2, updated_at = $2
         where id = $1`,
        [message.contact_id, occurredAt],
      )
    }

    if (input.eventType === 'bounced' && message.contact_id) {
      await tx.query(
        `update public.contacts set status = 'bounced', updated_at = $2 where id = $1`,
        [message.contact_id, occurredAt],
      )
    }

    if (input.eventType === 'complained' && message.contact_id) {
      await tx.query(
        `update public.contacts set status = 'complained', updated_at = $2 where id = $1`,
        [message.contact_id, occurredAt],
      )
    }

    if (!input.skipActivityEvent) {
      await recordEvent(tx, {
        workspaceId,
        contactId: message.contact_id,
        eventType: input.eventType,
        campaignId: message.campaign_id,
        messageId: input.messageId,
        workflowId: message.workflow_id,
        url: input.url ?? null,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        metadata: input.metadata ?? {},
      })
    }

    // Opt the contact out of every future campaign send to this workspace.
    if (input.eventType === 'unsubscribed' && message.contact_id) {
      await tx.query(
        `update public.email_messages set status = 'unsubscribed'
         where contact_id = $1 and id <> $2 and status in ('queued', 'sent')`,
        [message.contact_id, input.messageId],
      )
    }

    return { contactId: message.contact_id as string | null, workspaceId }
  })
}

function statusAfter(current: string, event: string): string {
  switch (event) {
    case 'sent':
      return 'sent'
    case 'delivered':
      return 'delivered'
    case 'opened':
      return 'opened'
    case 'clicked':
      return 'clicked'
    case 'bounced':
      return 'bounced'
    case 'complained':
      return 'complained'
    case 'unsubscribed':
      return 'unsubscribed'
    default:
      return current
  }
}

export async function listMessages(input: {
  workspaceId: string
  campaignId?: string | null
  workflowId?: string | null
  contactId?: string | null
  kind?: string | null
  status?: string | null
  search?: string | null
  limit?: number
}): Promise<EmailMessage[]> {
  const params: unknown[] = [input.workspaceId]
  const filters = ['m.workspace_id = $1']

  const add = (clause: string, value: unknown) => {
    params.push(value)
    filters.push(clause.replace('$?', `$${params.length}`))
  }

  if (input.campaignId) add('m.campaign_id = $?', input.campaignId)
  if (input.workflowId) add('m.workflow_id = $?', input.workflowId)
  if (input.contactId) add('m.contact_id = $?', input.contactId)
  if (input.kind) add('m.kind = $?', input.kind)
  if (input.status) add('m.status = $?::public.message_status', input.status)
  if (input.search) {
    params.push(`%${input.search.toLowerCase()}%`)
    filters.push(`lower(m.to_email) like $${params.length}`)
  }

  params.push(Math.min(input.limit ?? 100, 1000))

  const result = await withAdminDb((tx) =>
    many<Record<string, any>>(
      tx,
      `
      select m.* from public.email_messages m
      where ${filters.join(' and ')}
      order by m.created_at desc
      limit $${params.length}
      `,
      params,
    ),
  )

  return result.map(mapMessage)
}