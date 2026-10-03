/** Webhook event vocabulary. Pure data — safe to import from the browser. */

export const WEBHOOK_EVENTS = [
  'contact.created',
  'contact.updated',
  'contact.deleted',
  'contact.unsubscribed',
  'campaign.scheduled',
  'campaign.sent',
  'campaign.completed',
  'message.sent',
  'message.delivered',
  'message.opened',
  'message.clicked',
  'message.bounced',
  'message.complained',
  'message.unsubscribed',
  'workflow.activated',
  'workflow.paused',
  'workflow.run.completed',
  'segment.contact_added',
] as const

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]