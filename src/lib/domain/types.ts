/** Shared domain types. These are the contracts the UI, the public API, the
 * MCP tools and the AI assistant all speak — there is exactly one shape per
 * resource so an agent and a human produce identical results. */

/** JSON-safe values. Everything crossing the server-function boundary must be
 * structurally serialisable, so domain types are constrained to this. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export type JsonObject = { [key: string]: JsonValue }

export type EventType =
  | 'created'
  | 'updated'
  | 'tag_added'
  | 'tag_removed'
  | 'segment_added'
  | 'segment_removed'
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'opened'
  | 'clicked'
  | 'bounced'
  | 'complained'
  | 'unsubscribed'
  | 'purchased'
  | 'workflow_enrolled'
  | 'workflow_completed'
  | 'custom'

export const ENGAGEMENT_EVENTS: EventType[] = [
  'sent',
  'delivered',
  'opened',
  'clicked',
  'bounced',
  'complained',
  'unsubscribed',
]

export type ContactStatus =
  | 'subscribed'
  | 'unsubscribed'
  | 'bounced'
  | 'complained'
  | 'archived'

export type Contact = {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  phone: string | null
  company: string | null
  status: ContactStatus
  source: string | null
  customFields: JsonObject
  attributes: JsonObject
  createdAt: string
  updatedAt: string
  lastActivityAt: string | null
  unsubscribedAt: string | null
  tags: Tag[]
}

export type ContactRow = {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  phone: string | null
  company: string | null
  status: ContactStatus
  source: string | null
  custom_fields: JsonObject
  attributes: JsonObject
  created_at: Date | string
  updated_at: Date | string
  last_activity_at: Date | string | null
  unsubscribed_at: Date | string | null
}

export type Tag = {
  id: string
  name: string
  color: string
  createdAt: string
}

export type TagRow = { id: string; name: string; color: string; created_at: Date | string }

export type SegmentCondition = {
  id: string
  field: SegmentField
  operator: SegmentOperator
  value: string
  /** Only for `campaign_*` fields. */
  campaignId?: string | null
  /** Only for `event` fields. */
  eventName?: string | null
  /** Only for `custom_field` values. */
  customField?: string | null
}

export type SegmentField =
  | 'email'
  | 'first_name'
  | 'last_name'
  | 'phone'
  | 'company'
  | 'status'
  | 'source'
  | 'tag'
  | 'created_at'
  | 'last_activity_at'
  | 'sent_count'
  | 'delivered_count'
  | 'opened_count'
  | 'clicked_count'
  | 'bounced_count'
  | 'purchased'
  | 'campaign_received'
  | 'campaign_opened'
  | 'campaign_clicked'
  | 'event'

export type SegmentOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'greater_than'
  | 'less_than'
  | 'before'
  | 'after'
  | 'within_last_days'
  | 'not_within_last_days'
  | 'is_empty'
  | 'is_not_empty'
  | 'in'
  | 'not_in'

export type Segment = {
  id: string
  name: string
  description: string | null
  matchMode: 'all' | 'any'
  conditions: SegmentCondition[]
  includeManuallyAdded: boolean
  cachedCount: number | null
  lastCalculatedAt: string | null
  createdAt: string
  updatedAt: string
}

export type CampaignStatus =
  | 'draft'
  | 'scheduled'
  | 'sending'
  | 'sent'
  | 'paused'
  | 'cancelled'

export type TemplateCategory =
  | 'newsletter'
  | 'welcome'
  | 'product_update'
  | 'transactional'
  | 'promotion'
  | 'onboarding'

export type EmailTemplate = {
  id: string
  name: string
  category: TemplateCategory
  subject: string
  preheader: string | null
  html: string
  document: EmailDocument
  isTransactional: boolean
  createdAt: string
  updatedAt: string
}

export type Campaign = {
  id: string
  name: string
  subject: string
  preheader: string | null
  fromEmail: string | null
  fromName: string | null
  replyTo: string | null
  templateId: string | null
  segmentId: string | null
  segmentName: string | null
  html: string
  document: EmailDocument
  status: CampaignStatus
  scheduledAt: string | null
  startedAt: string | null
  sentAt: string | null
  completedAt: string | null
  recipientsCount: number
  createdAt: string
  updatedAt: string
}

export type WorkflowStatus = 'draft' | 'active' | 'paused' | 'archived'

export type WorkflowNodeType =
  | 'trigger'
  | 'wait'
  | 'condition'
  | 'send_email'
  | 'add_tag'
  | 'remove_tag'
  | 'update_contact'
  | 'add_to_segment'
  | 'remove_from_segment'
  | 'webhook'
  | 'goal'
  | 'split'

export type WorkflowNode = {
  id: string
  type: WorkflowNodeType
  name?: string
  config: Record<string, any>
  position: { x: number; y: number }
}

export type WorkflowEdge = {
  id: string
  source: string
  target: string
  /** Set on the outgoing edge of a condition/split node. */
  branch?: string
}

export type WorkflowDefinition = {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

export type Workflow = {
  id: string
  name: string
  description: string | null
  status: WorkflowStatus
  trigger: Record<string, any>
  definition: WorkflowDefinition
  createdAt: string
  updatedAt: string
  activatedAt: string | null
  lastRunAt: string | null
  runsCount: number
}

export type RunStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled'

export type WorkflowRun = {
  id: string
  workflowId: string
  contactId: string
  status: RunStatus
  currentNodeId: string | null
  context: JsonObject
  error: string | null
  startedAt: string
  completedAt: string | null
}

export type MessageStatus =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'opened'
  | 'clicked'
  | 'bounced'
  | 'complained'
  | 'unsubscribed'
  | 'failed'

export type EmailMessage = {
  id: string
  contactId: string | null
  campaignId: string | null
  workflowId: string | null
  templateId: string | null
  kind: 'campaign' | 'workflow' | 'transactional'
  toEmail: string
  toName: string | null
  fromEmail: string
  fromName: string | null
  subject: string
  status: MessageStatus
  provider: string | null
  error: string | null
  attempts: number
  queuedAt: string
  sentAt: string | null
  deliveredAt: string | null
  firstOpenedAt: string | null
  firstClickedAt: string | null
  bouncedAt: string | null
}

export type ActivityItem = {
  id: string
  contactId: string | null
  contactEmail: string | null
  eventType: EventType
  campaignId: string | null
  campaignName: string | null
  workflowId: string | null
  url: string | null
  metadata: JsonObject
  occurredAt: string
}

export type CustomFieldDefinition = {
  id: string
  key: string
  label: string
  fieldType: 'text' | 'number' | 'date' | 'boolean' | 'select'
  options: string[]
  createdAt: string
}

export type ApiKey = {
  id: string
  name: string
  prefix: string
  scopes: string[]
  lastUsedAt: string | null
  lastUsedIp: string | null
  revokedAt: string | null
  createdAt: string
}

export type Webhook = {
  id: string
  url: string
  events: string[]
  isActive: boolean
  description: string | null
  lastStatus: number | null
  lastDeliveryAt: string | null
  lastError: string | null
  createdAt: string
}

export type DomainRecord = {
  id: string
  name: string
  status: 'pending' | 'verified' | 'failed'
  dkimSelector: string
  dkimPublicKey: string
  verificationToken: string
  isDefault: boolean
  verifiedAt: string | null
  createdAt: string
  spfRecord: string
  dmarcRecord: string
  dkimRecordName: string
  cnameRecordName: string
  cnameRecordValue: string
}

export type OverviewStats = {
  emailsSent: number
  emailsDelivered: number
  deliveredRate: number
  openRate: number
  clickRate: number
  clickToOpenRate: number
  bounceRate: number
  unsubscribeRate: number
  complaintRate: number
  totalContacts: number
  subscribedContacts: number
  activeCampaigns: number
  activeWorkflows: number
}

export type TimeseriesPoint = {
  date: string
  sent: number
  delivered: number
  opened: number
  clicked: number
  bounced: number
  unsubscribed: number
}

export type CampaignStats = {
  campaignId: string
  name: string
  status: CampaignStatus
  sentAt: string | null
  recipients: number
  delivered: number
  opens: number
  uniqueOpens: number
  clicks: number
  uniqueClicks: number
  bounces: number
  unsubscribes: number
  openRate: number
  clickRate: number
  bounceRate: number
  clickToOpenRate: number
}

export type Paginated<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

export const EMPTY_PAGE: Paginated<never> = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 25,
  pageCount: 0,
}

/* -------------------------------------------------------------------------
 * Email document model — a linear list of blocks rendered to HTML.
 * ---------------------------------------------------------------------- */

export type EmailBlock =
  | { id: string; type: 'heading'; props: { level: 1 | 2 | 3; text: string; align: 'left' | 'center' } }
  | { id: string; type: 'text'; props: { text: string; align: 'left' | 'center'; size: 'sm' | 'md' | 'lg' } }
  | { id: string; type: 'image'; props: { src: string; alt: string; href: string; width: 'full' | 'content' } }
  | { id: string; type: 'button'; props: { label: string; href: string; align: 'left' | 'center'; variant: 'primary' | 'outline' | 'ghost' } }
  | { id: string; type: 'divider'; props: {} }
  | { id: string; type: 'spacer'; props: { height: number } }
  | { id: string; type: 'columns'; props: { columns: EmailColumn[] } }
  | { id: string; type: 'html'; props: { html: string } }
  | { id: string; type: 'social'; props: { links: { label: string; href: string }[] } }

export type EmailColumn = {
  id: string
  blocks: EmailBlock[]
}

export type EmailDocument = {
  blocks: EmailBlock[]
}
export type InviteRow = {
  id: string
  email: string
  role: 'owner' | 'admin' | 'member'
  status: string
  createdAt: string
  expiresAt: string
  acceptedAt: string | null
}

export type MemberRow = {
  id: string
  role: 'owner' | 'admin' | 'member'
  createdAt: string
  userId: string
  email: string
  fullName: string | null
}
