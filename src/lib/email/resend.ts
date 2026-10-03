import { Resend } from 'resend'
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { EmailProvider, OutboundEmail, ProviderHealth, SendContext, SendResult } from './provider'
import { ProviderError } from './provider'

export type ResendEventType =
  | 'email.sent'
  | 'email.delivered'
  | 'email.bounced'
  | 'email.complained'
  | 'email.opened'
  | 'email.clicked'

/**
 * Real transactional delivery via Resend.
 *
 * Activated only when RESEND_API_KEY is present. Delivery status callbacks are
 * authenticated with HMAC-SHA256 over the raw request body (see
 * `verifyResendSignature`) — an unsigned callback is never trusted.
 */
export class ResendProvider implements EmailProvider {
  readonly name = 'resend'
  private readonly client: Resend
  private readonly fromDomain: string

  constructor(apiKey: string, fromDomain: string) {
    this.client = new Resend(apiKey)
    this.fromDomain = fromDomain
  }

  async health(): Promise<ProviderHealth> {
    try {
      const domains = await this.client.domains.list()
      const rows = (domains.data?.data ?? []) as { name: string; status: string }[]
      return {
        name: this.name,
        live: true,
        detail: rows.length
          ? `${rows.length} domain(s) configured · sending from @${this.fromDomain}`
          : `connected · default sender @${this.fromDomain}`,
      }
    } catch (error) {
      return {
        name: this.name,
        live: false,
        detail: (error as Error).message,
      }
    }
  }

  async send(email: OutboundEmail, context: SendContext): Promise<SendResult> {
    const from = email.fromName
      ? `${email.fromName} <${email.from}>`
      : email.from

    try {
      const { data, error } = await this.client.emails.send({
        from,
        to: email.to,
        subject: email.subject,
        html: email.html,
        text: email.text ?? undefined,
        reply_to: email.replyTo ?? undefined,
        headers: {
          ...email.headers,
          // Echoed back on every provider webhook so events join to our row.
          'X-Lumail-Message-Id': context.messageId,
          'X-Lumail-Workspace-Id': context.workspaceId,
        },
      } as Parameters<Resend['emails']['send']>[0])

      if (error) {
        throw new ProviderError(error.message, true)
      }
      if (!data?.id) {
        throw new ProviderError('Provider did not return a message id', true)
      }

      return {
        provider: this.name,
        providerMessageId: data.id,
        accepted: [email.to],
        rejected: [],
      }
    } catch (error) {
      if (error instanceof ProviderError) throw error
      throw new ProviderError((error as Error).message, true)
    }
  }
}

/** Verifies the `svix` style signature Resend sends on webhook callbacks. */
export function verifyResendSignature(
  payload: string,
  headers: Record<string, string | undefined>,
  secret: string,
): boolean {
  const svixId = headers['svix-id']
  const svixTimestamp = headers['svix-timestamp']
  const svixSignature = headers['svix-signature']
  if (!svixId || !svixTimestamp || !svixSignature) return false

  const timestampAge = Math.abs(Date.now() / 1000 - Number(svixTimestamp))
  if (!Number.isFinite(timestampAge) || timestampAge > 300) return false

  const expected = createHmac('sha256', secret)
    .update(`${svixId}.${svixTimestamp}.${payload}`)
    .digest('base64')

  const provided = svixSignature.split(' ').map((part) =>
    part.replace(/^v1,/, ''),
  )

  return provided.some((candidate) => {
    const a = Buffer.from(candidate)
    const b = Buffer.from(expected)
    return a.length === b.length && timingSafeEqual(a, b)
  })
}

export function mapResendEvent(
  type: string,
): ResendEventType | null {
  const allowed: ResendEventType[] = [
    'email.sent',
    'email.delivered',
    'email.bounced',
    'email.complained',
    'email.opened',
    'email.clicked',
  ]
  return allowed.includes(type as ResendEventType)
    ? (type as ResendEventType)
    : null
}