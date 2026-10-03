import { one, withAdminDb } from '@/integrations/database/client'
import { requireWorkspaceMember } from '@/integrations/database/auth-runtime'
import { ValidationError } from '@/lib/auth/session'
import { deliverMessage } from '@/lib/email/send'
import { resolveSender } from './workspace'

/**
 * Transactional email for developers: `POST /api/v1/emails`.
 *
 * Uses the same `deliverMessage` pipeline as campaigns and automations, so
 * transactional messages get the same provider, tracking and analytics.
 */

export type TransactionalInput = {
  to: string
  subject: string
  templateId?: string
  templateName?: string
  html?: string
  variables?: Record<string, string>
}

export async function sendTransactional(input: TransactionalInput) {
  const { workspaceId } = await requireWorkspaceMember()

  if (!input.templateId && !input.templateName && !input.html) {
    throw new ValidationError(
      'Provide one of: templateId, templateName, or html',
    )
  }

  const template = input.templateId || input.templateName
    ? await withAdminDb(async (tx) =>
        one<Record<string, any>>(
          tx,
          input.templateId
            ? 'select * from public.templates where id = $1 and workspace_id = $2'
            : 'select * from public.templates where workspace_id = $1 and name = $2 limit 1',
          input.templateId
            ? [input.templateId, workspaceId]
            : [workspaceId, input.templateName],
        ),
      )
    : null

  if ((input.templateId || input.templateName) && !template) {
    throw new ValidationError('No transactional template matched that request')
  }

  const sender = await resolveSender(workspaceId)

  const html = input.html ?? template?.html ?? ''
  if (!html.trim()) {
    throw new ValidationError('The template has no content to send')
  }

  const subject = (template?.subject as string | undefined) || input.subject

  const result = await deliverMessage({
    workspaceId,
    to: input.to,
    subject,
    html,
    fromEmail: sender.fromEmail,
    fromName: sender.fromName,
    replyTo: sender.replyTo,
    templateId: template?.id ?? null,
    kind: 'transactional',
    variables: input.variables,
    includeUnsubscribe: false,
    raw: true,
  })

  return {
    id: result.messageId,
    status: result.status,
    provider: result.provider,
    providerMessageId: result.providerMessageId,
    to: input.to,
    subject,
    error: result.error ?? null,
  }
}