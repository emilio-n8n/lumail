import type {
  ActivityItem,
  ApiKey,
  Campaign,
  CampaignStats,
  EmailDocument,
  Contact,
  ContactRow,
  CustomFieldDefinition,
  DomainRecord,
  EmailMessage,
  EmailTemplate,
  Segment,
  SegmentCondition,
  Tag,
  TagRow,
  Webhook,
  Workflow,
  WorkflowDefinition,
  WorkflowRun,
  JsonObject,
  JsonValue,
} from './types'

/** Row → domain mappers. Every read path funnels through these so the UI, the
 * public API and the MCP tools always return byte-identical shapes. */

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function requiredIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

export function mapTag(row: TagRow | Record<string, any>): Tag {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: requiredIso(row.created_at),
  }
}

export function mapContact(row: ContactRow, tags: Tag[] = []): Contact {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
    company: row.company,
    status: row.status,
    source: row.source,
    customFields: (row.custom_fields ?? {}) as JsonObject,
    attributes: (row.attributes ?? {}) as JsonObject,
    createdAt: requiredIso(row.created_at),
    updatedAt: requiredIso(row.updated_at),
    lastActivityAt: iso(row.last_activity_at),
    unsubscribedAt: iso(row.unsubscribed_at),
    tags,
  }
}

export function mapSegment(row: Record<string, any>): Segment {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    matchMode: row.match_mode,
    conditions: (row.conditions ?? []) as SegmentCondition[],
    includeManuallyAdded: row.include_manually_added,
    cachedCount: row.cached_count ?? null,
    lastCalculatedAt: iso(row.last_calculated_at),
    createdAt: requiredIso(row.created_at),
    updatedAt: requiredIso(row.updated_at),
  }
}

export function mapTemplate(row: Record<string, any>): EmailTemplate {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    subject: row.subject,
    preheader: row.preheader,
    html: row.html,
    document: (row.document ?? { blocks: [] }) as EmailDocument,
    isTransactional: row.is_transactional,
    createdAt: requiredIso(row.created_at),
    updatedAt: requiredIso(row.updated_at),
  }
}

export function mapCampaign(row: Record<string, any>): Campaign {
  return {
    id: row.id,
    name: row.name,
    subject: row.subject,
    preheader: row.preheader,
    fromEmail: row.from_email,
    fromName: row.from_name,
    replyTo: row.reply_to,
    templateId: row.template_id,
    segmentId: row.segment_id,
    segmentName: row.segment_name ?? null,
    html: row.html,
    document: (row.document ?? { blocks: [] }) as EmailDocument,
    status: row.status,
    scheduledAt: iso(row.scheduled_at),
    startedAt: iso(row.started_at),
    sentAt: iso(row.sent_at),
    completedAt: iso(row.completed_at),
    recipientsCount: row.recipients_count ?? 0,
    createdAt: requiredIso(row.created_at),
    updatedAt: requiredIso(row.updated_at),
  }
}

export function mapWorkflow(row: Record<string, any>): Workflow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    trigger: row.trigger ?? {},
    definition: (row.definition ?? { nodes: [], edges: [] }) as WorkflowDefinition,
    createdAt: requiredIso(row.created_at),
    updatedAt: requiredIso(row.updated_at),
    activatedAt: iso(row.activated_at),
    lastRunAt: iso(row.last_run_at),
    runsCount: row.runs_count ?? 0,
  }
}

export function mapWorkflowRun(row: Record<string, any>): WorkflowRun {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    contactId: row.contact_id,
    status: row.status,
    currentNodeId: row.current_node_id,
    context: (row.context ?? {}) as JsonObject,
    error: row.error,
    startedAt: requiredIso(row.started_at),
    completedAt: iso(row.completed_at),
  }
}

export function mapMessage(row: Record<string, any>): EmailMessage {
  return {
    id: row.id,
    contactId: row.contact_id,
    campaignId: row.campaign_id,
    workflowId: row.workflow_id,
    templateId: row.template_id,
    kind: row.kind,
    toEmail: row.to_email,
    toName: row.to_name,
    fromEmail: row.from_email,
    fromName: row.from_name,
    subject: row.subject,
    status: row.status,
    provider: row.provider,
    error: row.error,
    attempts: row.attempts,
    queuedAt: requiredIso(row.queued_at),
    sentAt: iso(row.sent_at),
    deliveredAt: iso(row.delivered_at),
    firstOpenedAt: iso(row.first_opened_at),
    firstClickedAt: iso(row.first_clicked_at),
    bouncedAt: iso(row.bounced_at),
  }
}

export function mapActivity(row: Record<string, any>): ActivityItem {
  return {
    id: row.id,
    contactId: row.contact_id,
    contactEmail: row.contact_email ?? null,
    eventType: row.event_type,
    campaignId: row.campaign_id,
    campaignName: row.campaign_name ?? null,
    workflowId: row.workflow_id,
    url: row.url,
    metadata: (row.metadata ?? {}) as JsonObject,
    occurredAt: requiredIso(row.occurred_at),
  }
}

export function mapCustomField(row: Record<string, any>): CustomFieldDefinition {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    fieldType: row.field_type,
    options: (row.options ?? []) as string[],
    createdAt: requiredIso(row.created_at),
  }
}

export function mapApiKey(row: Record<string, any>): ApiKey {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: (row.scopes ?? ['*']) as string[],
    lastUsedAt: iso(row.last_used_at),
    lastUsedIp: iso(row.last_used_ip),
    revokedAt: iso(row.revoked_at),
    createdAt: requiredIso(row.created_at),
  }
}

export function mapWebhook(row: Record<string, any>): Webhook {
  return {
    id: row.id,
    url: row.url,
    events: (row.events ?? ['*']) as string[],
    isActive: row.is_active,
    description: row.description,
    lastStatus: row.last_status ?? null,
    lastDeliveryAt: iso(row.last_delivery_at),
    lastError: row.last_error,
    createdAt: requiredIso(row.created_at),
  }
}

export function mapDomain(
  row: Record<string, any>,
  appUrl: string,
): DomainRecord {
  const name = row.name as string
  const selector = row.dkim_selector as string
  return {
    id: row.id,
    name,
    status: row.status,
    dkimSelector: selector,
    dkimPublicKey: row.dkim_public_key,
    verificationToken: row.verification_token,
    isDefault: row.is_default,
    verifiedAt: iso(row.verified_at),
    createdAt: requiredIso(row.created_at),
    spfRecord: `v=spf1 include:_spf.${name} ~all`,
    dmarcRecord: `_dmarc.${name}  TXT  "v=DMARC1; p=none; rua=mailto:dmarc@${name}"`,
    dkimRecordName: `${selector}._domainkey.${name}`,
    cnameRecordName: `lm1._domainkey.${name}`,
    cnameRecordValue: `lm1.dkim.${row.verification_token}.lumail.email`,
  }
}

export function mapCampaignStats(row: Record<string, any>): CampaignStats {
  const delivered = Number(row.delivered ?? 0)
  const uniqueOpens = Number(row.unique_opens ?? 0)
  const uniqueClicks = Number(row.unique_clicks ?? 0)
  const recipients = Number(row.recipients ?? 0)
  const bounces = Number(row.bounces ?? 0)
  const unsubscribes = Number(row.unsubscribes ?? 0)

  const rate = (value: number, base: number) =>
    base > 0 ? Math.round((value / base) * 1000) / 1000 : 0

  return {
    campaignId: row.id,
    name: row.name,
    status: row.status,
    sentAt: iso(row.sent_at),
    recipients,
    delivered,
    opens: Number(row.opens ?? 0),
    uniqueOpens,
    clicks: Number(row.clicks ?? 0),
    uniqueClicks,
    bounces,
    unsubscribes,
    openRate: rate(uniqueOpens, delivered),
    clickRate: rate(uniqueClicks, delivered),
    bounceRate: rate(bounces, recipients),
    clickToOpenRate: rate(uniqueClicks, uniqueOpens),
  }
}