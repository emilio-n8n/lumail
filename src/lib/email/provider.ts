/**
 * Outbound email provider contract.
 *
 * Everything above this line (campaigns, automations, transactional sends) is
 * provider-agnostic; everything below is an adapter. Two adapters ship:
 *
 *   - `ResendProvider`  — real delivery when RESEND_API_KEY is configured.
 *   - `MockProvider`    — development provider that simulates delivery, opens,
 *                         clicks, bounces and unsubscribes so the whole product
 *                         is demonstrable without touching a real inbox.
 *
 * The active adapter is selected once, at module load, from the environment.
 */

export type OutboundEmail = {
  to: string
  toName?: string | null
  from: string
  fromName?: string | null
  replyTo?: string | null
  subject: string
  html: string
  text?: string | null
  headers?: Record<string, string>
}

export type SendContext = {
  messageId: string
  workspaceId: string
  contactId: string | null
  campaignId: string | null
  workflowId: string | null
  templateId: string | null
  /** Skip link rewriting — used for already-rendered transactional HTML. */
  alreadyTracked?: boolean
}

export type SendResult = {
  provider: string
  providerMessageId: string
  accepted: string[]
  rejected: string[]
}

export type ProviderHealth = {
  name: string
  live: boolean
  detail: string
}

export interface EmailProvider {
  readonly name: string
  health(): Promise<ProviderHealth>
  send(email: OutboundEmail, context: SendContext): Promise<SendResult>
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable = true,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}