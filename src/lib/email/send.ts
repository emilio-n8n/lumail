import { withAdminDb, one } from '@/integrations/database/client'
import { getEmailProvider } from './index'
import { interpolate, contactVariables } from './variables'
import { htmlToText, renderDocument, rewriteLinksForTracking } from './render'
import { signToken } from '@/lib/auth/crypto'
import { withJobBatch } from '@/lib/jobs/queue'
import { recordEvent } from '@/lib/domain/activity'
import type { ContactRow, EmailDocument } from '@/lib/domain/types'
import { queueEventWebhooks } from '@/lib/webhooks/dispatch'

/**
 * The single outbound email path.
 *
 * Campaign sends, automation sends and transactional API sends all funnel
 * through `deliverMessage`. There is no second code path, which is why a message
 * created by the AI assistant behaves exactly like one created by hand.
 */

export type OutboundRequest = {
  workspaceId: string
  to: string
  toName?: string | null
  subject: string
  document?: EmailDocument
  html?: string
  preheader?: string | null
  fromEmail: string
  fromName: string
  replyTo?: string | null
  contactId?: string | null
  campaignId?: string | null
  workflowId?: string | null
  workflowRunId?: string | null
  templateId?: string | null
  kind?: 'campaign' | 'workflow' | 'transactional'
  variables?: Record<string, string>
  includeUnsubscribe?: boolean
  metadata?: Record<string, unknown>
  /** Skip link rewriting + pixel (HTML is already final). */
  raw?: boolean
  /**
   * Reuse a message row that was already reserved (campaign fan-out freezes the
   * audience up-front). When omitted, a row is created here.
   */
  messageId?: string
}

export type DeliveryOutcome = {
  messageId: string
  status: 'sent' | 'bounced' | 'failed'
  provider: string
  providerMessageId: string | null
  error?: string
}

export function getAppUrl(): string {
  return (
    process.env.APP_URL ??
    process.env.PUBLIC_APP_URL ??
    'http://localhost:3000'
  ).replace(/\/$/, '')
}

export async function deliverMessage(
  request: OutboundRequest,
): Promise<DeliveryOutcome> {
  const baseUrl = getAppUrl()

  // 1. Persist the message first so tracking links and the open pixel can be
  //    built from a real id — even if delivery then fails.
  const unsubscribeToken =
    request.includeUnsubscribe === false
      ? null
      : signToken(
          { contactId: request.contactId ?? null, workspaceId: request.workspaceId },
          60 * 60 * 24 * 365 * 3,
        )

  const messageId =
    request.messageId ??
    (await withAdminDb(async (tx) => {
      const row = await one<{ id: string }>(
        tx,
        `
      insert into public.email_messages (
        workspace_id, contact_id, campaign_id, workflow_id, workflow_run_id,
        template_id, kind, to_email, to_name, from_email, from_name, reply_to,
        subject, html, text_body, status, provider, unsubscribe_token, metadata
      )
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'','', 'queued', null, $14, $15)
      returning id
      `,
        [
          request.workspaceId,
          request.contactId ?? null,
          request.campaignId ?? null,
          request.workflowId ?? null,
          request.workflowRunId ?? null,
          request.templateId ?? null,
          request.kind ?? 'campaign',
          request.to,
          request.toName ?? null,
          request.fromEmail,
          request.fromName,
          request.replyTo ?? null,
          request.subject,
          unsubscribeToken,
          JSON.stringify(request.metadata ?? {}),
        ],
      )
      return row!.id
    }))

  // 2. Render outside the transaction — no database lock is held while doing
  //    string work or talking to the provider.
  let html = request.html ?? ''
  if (request.document) {
    html = renderDocument(request.document, {
      baseUrl,
      preheader: request.preheader,
      preview: false,
    })
  }

  const text = htmlToText(html)
  const subject = interpolate(request.subject, request.variables ?? {})

  let tracked = html
  if (!request.raw) {
    tracked = interpolate(html, request.variables ?? {})
    tracked = rewriteLinksForTracking(tracked, { baseUrl, messageId })
  }

  await withAdminDb((tx) =>
    tx.query(
      `update public.email_messages set html = $2, text_body = $3, subject = $4 where id = $1`,
      [messageId, tracked, text, subject],
    ),
  )

  // 3. Hand to the provider.
  try {
    const provider = getEmailProvider()

    const result = await withJobBatch(() =>
      provider.send(
        {
          to: request.to,
          toName: request.toName ?? null,
          from: request.fromEmail,
          fromName: request.fromName,
          replyTo: request.replyTo ?? null,
          subject,
          html: tracked,
          text,
        },
        {
          messageId,
          workspaceId: request.workspaceId,
          contactId: request.contactId ?? null,
          campaignId: request.campaignId ?? null,
          workflowId: request.workflowId ?? null,
          templateId: request.templateId ?? null,
        },
      ),
    )

    await withAdminDb(async (tx) => {
      await tx.query(
        `update public.email_messages
         set status = 'sent', provider = $2, provider_message_id = $3, sent_at = now(), attempts = attempts + 1
         where id = $1`,
        [messageId, result.provider, result.providerMessageId],
      )
      await recordEvent(tx, {
        workspaceId: request.workspaceId,
        contactId: request.contactId ?? null,
        eventType: 'sent',
        campaignId: request.campaignId ?? null,
        messageId,
        workflowId: request.workflowId ?? null,
        metadata: { subject, provider: result.provider },
      })
    })

    await queueEventWebhooks(request.workspaceId, 'message.sent', {
      messageId,
      campaignId: request.campaignId,
      workflowId: request.workflowId,
      to: request.to,
      subject,
    })

    return {
      messageId,
      status: 'sent',
      provider: result.provider,
      providerMessageId: result.providerMessageId,
    }
  } catch (error) {
    const message = (error as Error).message

    await withAdminDb(async (tx) => {
      await tx.query(
        `update public.email_messages set status = 'failed', error = $2, attempts = attempts + 1 where id = $1`,
        [messageId, message.slice(0, 2000)],
      )
    })

    await queueEventWebhooks(request.workspaceId, 'message.failed', {
      messageId,
      error: message,
    })

    return {
      messageId,
      status: 'failed',
      provider: getEmailProvider().name,
      providerMessageId: null,
      error: message,
    }
  }
}

/** Renders + delivers for a single contact, resolving their merge fields. */
export async function deliverToContact(input: {
  workspaceId: string
  contact: ContactRow
  subject: string
  document?: EmailDocument
  html?: string
  preheader?: string | null
  fromEmail: string
  fromName: string
  replyTo?: string | null
  campaignId?: string | null
  workflowId?: string | null
  workflowRunId?: string | null
  templateId?: string | null
  kind?: 'campaign' | 'workflow' | 'transactional'
  variables?: Record<string, string>
  includeUnsubscribe?: boolean
  messageId?: string
}): Promise<DeliveryOutcome> {
  const variables = contactVariables(
    {
      email: input.contact.email,
      firstName: input.contact.first_name,
      lastName: input.contact.last_name,
      phone: input.contact.phone,
      company: input.contact.company,
      createdAt: input.contact.created_at as string,
      customFields: input.contact.custom_fields ?? {},
    },
    input.variables,
  )

  return deliverMessage({
    workspaceId: input.workspaceId,
    to: input.contact.email,
    toName: [input.contact.first_name, input.contact.last_name]
      .filter(Boolean)
      .join(' ') || null,
    subject: input.subject,
    document: input.document,
    html: input.html,
    preheader: input.preheader,
    fromEmail: input.fromEmail,
    fromName: input.fromName,
    replyTo: input.replyTo,
    contactId: input.contact.id,
    campaignId: input.campaignId,
    workflowId: input.workflowId,
    workflowRunId: input.workflowRunId,
    templateId: input.templateId,
    kind: input.kind ?? 'campaign',
    variables,
    includeUnsubscribe: input.includeUnsubscribe,
    messageId: input.messageId,
  })
}