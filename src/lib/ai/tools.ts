import { z } from 'zod'
import * as contacts from '@/lib/domain/contacts'
import * as segments from '@/lib/domain/segments'
import * as campaigns from '@/lib/domain/campaigns'
import * as templates from '@/lib/domain/templates'
import * as workflows from '@/lib/domain/workflows'
import * as analytics from '@/lib/domain/analytics'
import { sendTransactional } from '@/lib/domain/transactional'
import { startRun } from '@/lib/workflows/engine'
import { handleTrigger } from '@/lib/workflows/engine'
import { listMessages } from '@/lib/email/messages'
import { EMAIL_VARIABLES } from '@/lib/email/variables'
import { SEGMENT_FIELDS, SEGMENT_OPERATORS } from '@/lib/domain/segment-query'
import { requireWorkspaceMember } from '@/integrations/database/auth-runtime'
import type { SegmentCondition, WorkflowDefinition } from '@/lib/domain/types'

/**
 * The tool surface.
 *
 * This module is the single definition of "what Lumail can do". It is consumed
 * by:
 *   - the MCP server (`mcp/server.ts`) exposed to external agents,
 *   - the in-product AI assistant (streaming tool calling),
 *   - the generated API reference in the dashboard.
 *
 * Every handler calls the same domain services the dashboard calls, so an agent
 * that creates a campaign produces exactly the row a human would.
 *
 * Descriptions are written for an LLM: what the tool does, when to use it, what
 * it returns, and the important constraints.
 */

export type ToolDefinition = {
  name: string
  title: string
  description: string
  scope: string
  schema: z.ZodType
  handler: (input: any) => Promise<unknown>
}

const conditionSchema = z.object({
  field: z.enum(SEGMENT_FIELDS as unknown as [string, ...string[]]).describe(
    'Contact property, tag, engagement counter, campaign activity or event to test.',
  ),
  operator: z
    .enum(SEGMENT_OPERATORS as unknown as [string, ...string[]])
    .describe('Comparison to apply.'),
  value: z.string().describe('Comparison value. Comma-separated for in / not_in.'),
  campaignId: z.string().optional().describe(
    'Required when field is campaign_received, campaign_opened or campaign_clicked.',
  ),
  eventName: z.string().optional().describe('Required when field is "event".'),
})

export const tools: ToolDefinition[] = [
  /* ------------------------------------------------------------- contacts */
  {
    name: 'list_contacts',
    title: 'List contacts',
    scope: 'contacts:read',
    description:
      'List contacts with pagination, search, filtering and sorting.\n\nSearch matches email, first name, last name and company (case-insensitive). Use `tagNames` to require all of the given tags. Returns the page of contacts plus `total` and `pageCount`.',
    schema: z.object({
      page: z.number().int().min(1).optional().describe('1-based page number.'),
      pageSize: z.number().int().min(1).max(200).optional().describe('Rows per page, default 25.'),
      search: z.string().optional().describe('Free-text search across email, name, company.'),
      status: z
        .enum(['subscribed', 'unsubscribed', 'bounced', 'complained', 'archived'])
        .optional()
        .describe('Filter by contact status.'),
      tagNames: z.array(z.string()).optional().describe('Require contacts carrying all these tags.'),
      sort: z
        .enum(['created_at', 'email', 'last_activity_at', 'first_name'])
        .optional(),
      direction: z.enum(['asc', 'desc']).optional(),
    }),
    handler: async (input) =>
      contacts.listContacts({
        page: input.page,
        pageSize: input.pageSize,
        search: input.search,
        status: input.status ?? null,
        sort: input.sort,
        direction: input.direction,
        tagIds: await tagIdsFor(input.tagNames),
      }),
  },
  {
    name: 'search_contacts',
    title: 'Search contacts',
    scope: 'contacts:read',
    description:
      'Find contacts using email, name, tags, custom fields, campaign activity or engagement.\n\nThis is the tool to reach for when someone asks "who clicked the pricing link but never bought?" — filter by `campaignOpenedId` / `campaignClickedId` and by the `purchased` custom field or a `purchased` event. Returns up to `limit` contacts (default 50, max 200) with their tags and engagement counters, plus the total number matched.',
    schema: z.object({
      query: z.string().optional().describe('Free-text search across email, name, company.'),
      tagNames: z.array(z.string()).optional().describe('Require contacts carrying all these tags.'),
      campaignId: z.string().optional().describe('Restrict to recipients of this campaign.'),
      campaignClicked: z
        .boolean()
        .optional()
        .describe('With campaignId: only contacts who clicked a link in it.'),
      campaignOpened: z
        .boolean()
        .optional()
        .describe('With campaignId: only contacts who opened it.'),
      notPurchased: z
        .boolean()
        .optional()
        .describe('Only contacts with no "purchased" event and purchased=false.'),
      inactiveDays: z
        .number()
        .int()
        .optional()
        .describe('Only contacts whose last activity is older than N days.'),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    handler: async (input) => {
      const conditions: SegmentCondition[] = []

      if (input.campaignId) {
        conditions.push({
          id: 'tool_campaign',
          field: 'campaign_received',
          operator: 'equals',
          value: '',
          campaignId: input.campaignId,
        })
        if (input.campaignClicked) {
          conditions.push({
            id: 'tool_clicked',
            field: 'campaign_clicked',
            operator: 'equals',
            value: '',
            campaignId: input.campaignId,
          })
        }
        if (input.campaignOpened && !input.campaignClicked) {
          conditions.push({
            id: 'tool_opened',
            field: 'campaign_opened',
            operator: 'equals',
            value: '',
            campaignId: input.campaignId,
          })
        }
      }

      for (const tag of input.tagNames ?? []) {
        conditions.push({ id: `tool_tag_${tag}`, field: 'tag', operator: 'equals', value: tag })
      }

      if (input.notPurchased) {
        conditions.push({
          id: 'tool_not_purchased',
          field: 'purchased',
          operator: 'not_equals',
          value: 'true',
        })
      }

      if (input.inactiveDays) {
        conditions.push({
          id: 'tool_inactive',
          field: 'last_activity_at',
          operator: 'not_within_last_days',
          value: String(input.inactiveDays),
        })
      }

      const page = await segments.previewSegment(conditions, 'all')

      if (!input.query && conditions.length === 0) {
        return { total: page.count, contacts: [], hint: 'Add at least one filter.' }
      }

      const result = await contacts.listContacts({
        search: input.query,
        pageSize: Math.min(input.limit ?? 50, 200),
      })

      return {
        total: page.count,
        returned: result.items.length,
        contacts: result.items.map((contact) => ({
          id: contact.id,
          email: contact.email,
          firstName: contact.firstName,
          lastName: contact.lastName,
          company: contact.company,
          status: contact.status,
          tags: contact.tags.map((tag) => tag.name),
          lastActivityAt: contact.lastActivityAt,
        })),
      }
    },
  },
  {
    name: 'get_contact',
    title: 'Get a contact',
    scope: 'contacts:read',
    description:
      'Fetch one contact by id, including tags, custom fields, engagement counters (sent / delivered / opened / clicked / bounced / unsubscribed), the 200 most recent activity events, and the campaigns and automations they have been part of.',
    schema: z.object({ id: z.string().describe('Contact id.') }),
    handler: async (input) => contacts.getContact(input.id),
  },
  {
    name: 'create_contact',
    title: 'Create a contact',
    scope: 'contacts:write',
    description:
      'Add a contact. Email addresses are lower-cased and must be unique within the workspace. `tagNames` creates tags on the fly if they do not exist. The contact is immediately visible in the dashboard and eligible for automations.',
    schema: z.object({
      email: z.string().email(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      company: z.string().optional(),
      phone: z.string().optional(),
      status: z
        .enum(['subscribed', 'unsubscribed', 'bounced', 'complained', 'archived'])
        .optional(),
      customFields: z.record(z.string(), z.unknown()).optional(),
      tagNames: z.array(z.string()).optional(),
      source: z.string().optional(),
    }),
    handler: async (input) => contacts.createContact(input),
  },
  {
    name: 'update_contact',
    title: 'Update a contact',
    scope: 'contacts:write',
    description:
      'Patch a contact. Only the fields you pass are changed. Custom fields are merged, not replaced. Passing `tagNames` replaces the full tag set.',
    schema: z.object({
      id: z.string(),
      email: z.string().email().optional(),
      firstName: z.string().nullable().optional(),
      lastName: z.string().nullable().optional(),
      company: z.string().nullable().optional(),
      phone: z.string().nullable().optional(),
      status: z
        .enum(['subscribed', 'unsubscribed', 'bounced', 'complained', 'archived'])
        .optional(),
      customFields: z.record(z.string(), z.unknown()).optional(),
      tagNames: z.array(z.string()).optional(),
    }),
    handler: async (input) => {
      const { id, ...patch } = input
      return contacts.updateContact(id, patch)
    },
  },
  {
    name: 'delete_contacts',
    title: 'Delete contacts',
    scope: 'contacts:write',
    description:
      'Permanently delete one or more contacts along with their tags, segment memberships and activity. Returns the number deleted.',
    schema: z.object({ ids: z.array(z.string()).min(1) }),
    handler: async (input) => ({
      deleted: await contacts.deleteContacts(input.ids),
    }),
  },
  {
    name: 'add_tags_to_contacts',
    title: 'Tag contacts',
    scope: 'contacts:write',
    description:
      'Attach one or more tags to the given contacts, creating any tags that do not exist yet. Returns the number of contacts updated.',
    schema: z.object({
      contactIds: z.array(z.string()).min(1),
      tagNames: z.array(z.string()).min(1),
    }),
    handler: async (input) => ({
      updated: await contacts.addTagsToContacts(input.contactIds, input.tagNames),
    }),
  },
  {
    name: 'get_contact_activity',
    title: 'Contact activity',
    scope: 'contacts:read',
    description:
      'Return the engagement timeline for a contact: sends, deliveries, opens, clicks, bounces, complaints, unsubscribes, tag changes and automation steps, newest first. `eventTypes` filters the stream.',
    schema: z.object({
      contactId: z.string(),
      eventTypes: z
        .array(
          z.enum([
            'created',
            'updated',
            'tag_added',
            'tag_removed',
            'segment_added',
            'segment_removed',
            'sent',
            'delivered',
            'opened',
            'clicked',
            'bounced',
            'complained',
            'unsubscribed',
            'purchased',
            'workflow_enrolled',
            'workflow_completed',
            'custom',
          ]),
        )
        .optional(),
      limit: z.number().int().min(1).max(500).optional(),
    }),
    handler: async (input) => {
      const detail = await contacts.getContact(input.contactId)
      const events = input.eventTypes
        ? detail.activity.filter((event) => input.eventTypes!.includes(event.eventType))
        : detail.activity
      return {
        contact: {
          id: detail.contact.id,
          email: detail.contact.email,
          tags: detail.contact.tags.map((tag) => tag.name),
        },
        counters: detail.counters,
        activity: events.slice(0, input.limit ?? 100),
      }
    },
  },

  /* ------------------------------------------------------------- segments */
  {
    name: 'list_segments',
    title: 'List segments',
    scope: 'segments:read',
    description:
      'List every segment with its conditions, match mode and a plain-English summary of the rule.',
    schema: z.object({}),
    handler: async () => ({ segments: await segments.listSegments() }),
  },
  {
    name: 'get_segment',
    title: 'Get a segment',
    scope: 'segments:read',
    description:
      'Fetch one segment definition and a page of the contacts that currently match it.',
    schema: z.object({
      id: z.string(),
      page: z.number().int().min(1).optional(),
      pageSize: z.number().int().min(1).max(200).optional(),
    }),
    handler: async (input) => {
      const [segment, members] = await Promise.all([
        segments.getSegment(input.id),
        segments.getSegmentMembers(input.id, input.page ?? 1, input.pageSize ?? 25),
      ])
      return { ...segment, members }
    },
  },
  {
    name: 'create_segment',
    title: 'Create a segment',
    scope: 'segments:write',
    description:
      'Create a dynamic segment from a list of conditions.\n\n`matchMode` is "all" (AND) or "any" (OR). Conditions are evaluated live against the contact base on every read — the segment is never a stale snapshot.\n\nUseful fields: email / first_name / last_name / company / status / source, `tag`, `created_at`, `last_activity_at`, engagement counters (sent_count, delivered_count, opened_count, clicked_count, bounced_count), `purchased`, `event`, and campaign activity (campaign_received, campaign_opened, campaign_clicked — each requiring `campaignId`).\n\nOperators: equals, not_equals, contains, not_contains, starts_with, ends_with, greater_than, less_than, before, after, within_last_days, not_within_last_days, is_empty, is_not_empty, in, not_in.\n\nReturns the created segment and its current member count.',
    schema: z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      matchMode: z.enum(['all', 'any']).optional(),
      conditions: z.array(conditionSchema).min(1),
      includeManuallyAdded: z
        .boolean()
        .optional()
        .describe('Include contacts explicitly added to the segment. Default true.'),
    }),
    handler: async (input) => {
      const segment = await segments.createSegment({
        name: input.name,
        description: input.description,
        matchMode: input.matchMode,
        conditions: input.conditions as SegmentCondition[],
        includeManuallyAdded: input.includeManuallyAdded,
      })
      const preview = await segments.previewSegment(
        input.conditions as SegmentCondition[],
        input.matchMode,
      )
      return { ...segment, memberCount: preview.count }
    },
  },
  {
    name: 'update_segment',
    title: 'Update a segment',
    scope: 'segments:write',
    description: 'Change a segment name, description, match mode or conditions.',
    schema: z.object({
      id: z.string(),
      name: z.string().optional(),
      description: z.string().nullable().optional(),
      matchMode: z.enum(['all', 'any']).optional(),
      conditions: z.array(conditionSchema).optional(),
      includeManuallyAdded: z.boolean().optional(),
    }),
    handler: async (input) => {
      const { id, ...patch } = input
      return segments.updateSegment(id, patch as never)
    },
  },
  {
    name: 'add_contacts_to_segment',
    title: 'Add contacts to a segment',
    scope: 'segments:write',
    description:
      'Explicitly add contacts to a segment, regardless of the dynamic rules. Returns the number added.',
    schema: z.object({
      segmentId: z.string(),
      contactIds: z.array(z.string()).min(1),
    }),
    handler: async (input) => ({
      added: await segments.setSegmentMembers(
        input.segmentId,
        input.contactIds,
        'add',
      ),
    }),
  },

  /* ------------------------------------------------------------ campaigns */
  {
    name: 'list_campaigns',
    title: 'List campaigns',
    scope: 'campaigns:read',
    description:
      'List campaigns newest first, optionally filtered by status (draft, scheduled, sending, sent, paused, cancelled).',
    schema: z.object({
      status: z
        .enum(['draft', 'scheduled', 'sending', 'sent', 'paused', 'cancelled'])
        .optional(),
      search: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    handler: async (input) => ({ campaigns: await campaigns.listCampaigns(input) }),
  },
  {
    name: 'create_campaign',
    title: 'Create a campaign',
    scope: 'campaigns:write',
    description:
      'Create a campaign. Provide either `templateId` (to start from a saved template) or `document` (an ordered list of email blocks) plus `html`.\n\nA campaign starts as a draft. Use `send_campaign` to launch it now or `schedule_campaign` to queue it. The audience is resolved from `segmentId` at launch time and frozen into recipients.',
    schema: z.object({
      name: z.string().min(1),
      subject: z.string().optional(),
      preheader: z.string().optional(),
      fromEmail: z.string().optional(),
      fromName: z.string().optional(),
      replyTo: z.string().optional(),
      templateId: z.string().optional(),
      segmentId: z.string().optional(),
      html: z.string().optional(),
      document: z
        .object({ blocks: z.array(z.any()) })
        .optional()
        .describe('Ordered block list: heading, text, image, button, divider, spacer, columns, html, social.'),
    }),
    handler: async (input) => campaigns.createCampaign(input as never),
  },
  {
    name: 'update_campaign',
    title: 'Update a campaign',
    scope: 'campaigns:write',
    description:
      'Patch a draft or scheduled campaign: name, subject, preheader, sender identity, segment, content or schedule time.',
    schema: z.object({
      id: z.string(),
      name: z.string().optional(),
      subject: z.string().optional(),
      preheader: z.string().nullable().optional(),
      fromEmail: z.string().nullable().optional(),
      fromName: z.string().nullable().optional(),
      replyTo: z.string().nullable().optional(),
      templateId: z.string().nullable().optional(),
      segmentId: z.string().nullable().optional(),
      html: z.string().optional(),
      document: z.object({ blocks: z.array(z.any()) }).optional(),
      scheduledAt: z.string().nullable().optional(),
    }),
    handler: async (input) => {
      const { id, ...patch } = input
      return campaigns.updateCampaign(id, patch as never)
    },
  },
  {
    name: 'send_campaign',
    title: 'Send a campaign',
    scope: 'campaigns:write',
    description:
      'Launch a campaign immediately. Validates subject and content, freezes the audience from its segment, queues one message per subscribed contact and hands delivery to the job runner. Returns the campaign and the number of recipients.',
    schema: z.object({ id: z.string().describe('Campaign id.') }),
    handler: async (input) => campaigns.launchCampaign(input.id),
  },
  {
    name: 'schedule_campaign',
    title: 'Schedule a campaign',
    scope: 'campaigns:write',
    description:
      'Queue a campaign for an ISO-8601 timestamp (e.g. "2026-03-04T09:00:00Z"). It launches automatically when the scheduler runs.',
    schema: z.object({
      id: z.string(),
      scheduledAt: z.string().describe('ISO-8601 date-time, UTC.'),
    }),
    handler: async (input) =>
      campaigns.scheduleCampaign(input.id, new Date(input.scheduledAt)),
  },
  {
    name: 'get_campaign_analytics',
    title: 'Campaign analytics',
    scope: 'analytics:read',
    description:
      'Delivery, open, click, bounce and unsubscribe figures for one campaign, including rates (openRate, clickRate, clickToOpenRate, bounceRate) and per-message totals.',
    schema: z.object({ id: z.string().describe('Campaign id.') }),
    handler: async (input) => campaigns.campaignStats(input.id),
  },
  {
    name: 'get_workspace_overview',
    title: 'Workspace overview',
    scope: 'analytics:read',
    description:
      'Headline numbers for the workspace: emails sent and delivered, open/click/bounce/unsubscribe rates, contact totals, active campaigns and automations, plus a daily time series.',
    schema: z.object({
      range: z.enum(['24h', '7d', '30d', '90d']).optional(),
    }),
    handler: async (input) => {
      const range = input.range ?? '30d'
      const [stats, series, top] = await Promise.all([
        analytics.overviewStats(range),
        analytics.timeseries(range),
        analytics.topCampaigns(5),
      ])
      return { range, stats, series, topCampaigns: top }
    },
  },

  /* ------------------------------------------------------------ templates */
  {
    name: 'list_templates',
    title: 'List templates',
    scope: 'templates:read',
    description:
      'List saved templates with their category, subject line and block document.',
    schema: z.object({
      category: z
        .enum([
          'newsletter',
          'welcome',
          'product_update',
          'transactional',
          'promotion',
          'onboarding',
        ])
        .optional(),
      search: z.string().optional(),
    }),
    handler: async (input) => ({ templates: await templates.listTemplates(input) }),
  },
  {
    name: 'create_template',
    title: 'Create a template',
    scope: 'templates:write',
    description:
      'Create a reusable template. Provide `document` (blocks) and/or `html`. Merge variables use double braces, e.g. {{firstName}}. Set `isTransactional` for templates used by the transactional API.',
    schema: z.object({
      name: z.string().min(1),
      category: z
        .enum([
          'newsletter',
          'welcome',
          'product_update',
          'transactional',
          'promotion',
          'onboarding',
        ])
        .optional(),
      subject: z.string().optional(),
      preheader: z.string().optional(),
      html: z.string().optional(),
      document: z.object({ blocks: z.array(z.any()) }).optional(),
      isTransactional: z.boolean().optional(),
    }),
    handler: async (input) => templates.createTemplate(input as never),
  },
  {
    name: 'update_template',
    title: 'Update a template',
    scope: 'templates:write',
    description: 'Patch a template name, category, subject, preheader or content.',
    schema: z.object({
      id: z.string(),
      name: z.string().optional(),
      category: z
        .enum([
          'newsletter',
          'welcome',
          'product_update',
          'transactional',
          'promotion',
          'onboarding',
        ])
        .optional(),
      subject: z.string().optional(),
      preheader: z.string().nullable().optional(),
      html: z.string().optional(),
      document: z.object({ blocks: z.array(z.any()) }).optional(),
    }),
    handler: async (input) => {
      const { id, ...patch } = input
      return templates.updateTemplate(id, patch as never)
    },
  },

  /* ----------------------------------------------------------- automation */
  {
    name: 'list_workflows',
    title: 'List automations',
    scope: 'workflows:read',
    description:
      'List automations with status, trigger type, run counts and how many contacts are currently enrolled.',
    schema: z.object({}),
    handler: async () => ({ workflows: await workflows.listWorkflows() }),
  },
  {
    name: 'create_workflow',
    title: 'Create an automation',
    scope: 'workflows:write',
    description:
      'Create an automation from a directed acyclic graph of nodes.\n\n`trigger.type` is one of: contact_created, tag_added, segment_added, email_opened, link_clicked, custom_event, webhook.\n\n`definition.nodes` entries look like { id, type, config, position } and `definition.edges` entries like { id, source, target, branch }. Branch labels are used by `condition` ("true"/"false"), `split` ("a"/"b") and `goal` ("reached"/"timeout").\n\nNode types and their configs:\n- wait: { amount, unit: minutes|hours|days|weeks }\n- condition: { field, operator, value } where field is email, tag, status, company, opened, clicked, purchased or a custom field\n- send_email: { templateId } or { subject, document }\n- add_tag / remove_tag: { tagNames: string[] }\n- update_contact: { fields: { firstName, lastName, company, status, customFields } }\n- add_to_segment / remove_from_segment: { segmentId }\n- webhook: { url, method, body }\n- split: { variant: "a" | "b" }\n- goal: { event, timeoutHours }\n\nThe graph is validated on creation: exactly one trigger, no cycles, every node reachable.',
    schema: z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      trigger: z
        .object({
          type: z.enum([
            'contact_created',
            'tag_added',
            'segment_added',
            'email_opened',
            'link_clicked',
            'custom_event',
            'webhook',
          ]),
          tag: z.string().optional(),
          eventName: z.string().optional(),
        })
        .describe('The event that starts the automation.'),
      definition: z
        .object({
          nodes: z.array(
            z.object({
              id: z.string(),
              type: z.enum([
                'trigger',
                'wait',
                'condition',
                'send_email',
                'add_tag',
                'remove_tag',
                'update_contact',
                'add_to_segment',
                'remove_from_segment',
                'webhook',
                'goal',
                'split',
              ]),
              config: z.record(z.string(), z.any()).optional(),
              position: z
                .object({ x: z.number(), y: z.number() })
                .optional()
                .describe('Canvas position, x right and y down.'),
            }),
          ),
          edges: z.array(
            z.object({
              id: z.string(),
              source: z.string(),
              target: z.string(),
              branch: z.string().optional(),
            }),
          ),
        }),
    }),
    handler: async (input) =>
      workflows.createWorkflow({
        name: input.name,
        description: input.description,
        trigger: input.trigger,
        definition: input.definition as unknown as WorkflowDefinition,
      }),
  },
  {
    name: 'update_workflow',
    title: 'Update an automation',
    scope: 'workflows:write',
    description:
      'Patch an automation. Set status to "active" to start enrolling contacts, "paused" to stop it, "archived" to retire it. Definition changes are validated before being saved.',
    schema: z.object({
      id: z.string(),
      name: z.string().optional(),
      description: z.string().nullable().optional(),
      trigger: z.record(z.string(), z.any()).optional(),
      definition: z
        .object({ nodes: z.array(z.any()), edges: z.array(z.any()) })
        .optional(),
      status: z.enum(['draft', 'active', 'paused', 'archived']).optional(),
    }),
    handler: async (input) => {
      const { id, ...patch } = input
      return workflows.updateWorkflow(id, patch as never)
    },
  },
  {
    name: 'activate_workflow',
    title: 'Activate an automation',
    scope: 'workflows:write',
    description:
      'Set an automation to active so its trigger starts enrolling contacts.',
    schema: z.object({ id: z.string() }),
    handler: async (input) => workflows.setWorkflowStatus(input.id, 'active'),
  },
  {
    name: 'pause_workflow',
    title: 'Pause an automation',
    scope: 'workflows:write',
    description:
      'Pause an automation. Enrollments already in progress are suspended; resumes where they left off when reactivated.',
    schema: z.object({ id: z.string() }),
    handler: async (input) => workflows.setWorkflowStatus(input.id, 'paused'),
  },
  {
    name: 'enroll_contact_in_workflow',
    title: 'Enroll a contact',
    scope: 'workflows:write',
    description:
      'Manually start an automation for one contact, bypassing the trigger. Returns whether a run was created (false if the contact is already enrolled).',
    schema: z.object({ workflowId: z.string(), contactId: z.string() }),
    handler: async (input) => {
      const { workspaceId } = await requireWorkspaceMember()
      const started = await startRun(input.workflowId, {
        type: 'manual',
        workspaceId,
        contactId: input.contactId,
      })
      return { started }
    },
  },
  {
    name: 'list_workflow_runs',
    title: 'Automation runs',
    scope: 'workflows:read',
    description:
      'Recent automation executions with their status, the node they are waiting on, and any error.',
    schema: z.object({
      workflowId: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    handler: async (input) => ({
      runs: await workflows.listWorkflowRuns(input.workflowId, input.limit),
    }),
  },
  {
    name: 'trigger_event',
    title: 'Fire a custom event',
    scope: 'workflows:write',
    description:
      'Emit a custom event for a contact, which starts every active automation whose trigger is custom_event with a matching `eventName`. This is how external systems start a journey.',
    schema: z.object({
      contactId: z.string(),
      eventName: z.string().describe('e.g. "trial_expired", "invoice_paid".'),
      data: z.record(z.string(), z.any()).optional(),
    }),
    handler: async (input) => {
      const { workspaceId } = await requireWorkspaceMember()
      const started = await handleTrigger({
        type: 'custom_event',
        workspaceId,
        contactId: input.contactId,
        data: { eventName: input.eventName, ...(input.data ?? {}) },
      })
      return { automationsStarted: started }
    },
  },

  /* --------------------------------------------------------- transactional */
  {
    name: 'send_email',
    title: 'Send a transactional email',
    scope: 'emails:send',
    description:
      'Send a single transactional email. Either reference a saved template by id or name, or pass raw `html`. Merge variables are substituted before sending. Returns the message id and provider status — this is the same pipeline used by the POST /api/v1/emails endpoint.',
    schema: z.object({
      to: z.string().email(),
      subject: z.string().min(1),
      templateId: z.string().optional(),
      templateName: z.string().optional(),
      html: z.string().optional(),
      variables: z
        .record(z.string(), z.string())
        .optional()
        .describe('Values for {{variable}} placeholders, e.g. { "firstName": "Emilio" }.'),
    }),
    handler: async (input) => sendTransactional(input),
  },
  {
    name: 'list_email_messages',
    title: 'List sent messages',
    scope: 'analytics:read',
    description:
      'Query the outbound message ledger by kind (campaign, workflow, transactional), status, campaign or search text.',
    schema: z.object({
      kind: z.enum(['campaign', 'workflow', 'transactional']).optional(),
      status: z.string().optional(),
      campaignId: z.string().optional(),
      search: z.string().optional(),
      limit: z.number().int().min(1).max(500).optional(),
    }),
    handler: async (input) => {
      const { workspaceId } = await requireWorkspaceMember()
      const messages = await listMessages({
        workspaceId,
        kind: input.kind ?? null,
        status: input.status ?? null,
        campaignId: input.campaignId ?? null,
        search: input.search ?? null,
        limit: input.limit ?? 100,
      })
      return { messages }
    },
  },
  {
    name: 'describe_capabilities',
    title: 'Describe the workspace capabilities',
    scope: 'analytics:read',
    description:
      'Return the reference data needed to compose valid calls: merge variables, segment fields and operators, node types, trigger types and template categories. Call this once at the start if you are unsure of the exact vocabulary.',
    schema: z.object({}),
    handler: async () => ({
      variables: EMAIL_VARIABLES.map((variable) => ({
        key: variable.key,
        description: variable.description,
      })),
      segmentFields: SEGMENT_FIELDS,
      segmentOperators: SEGMENT_OPERATORS,
      triggers: [
        'contact_created',
        'tag_added',
        'segment_added',
        'email_opened',
        'link_clicked',
        'custom_event',
        'webhook',
      ],
      nodeTypes: [
        'trigger',
        'wait',
        'condition',
        'send_email',
        'add_tag',
        'remove_tag',
        'update_contact',
        'add_to_segment',
        'remove_from_segment',
        'webhook',
        'goal',
        'split',
      ],
      templateCategories: [
        'newsletter',
        'welcome',
        'product_update',
        'transactional',
        'promotion',
        'onboarding',
      ],
      statuses: {
        campaign: ['draft', 'scheduled', 'sending', 'sent', 'paused', 'cancelled'],
        workflow: ['draft', 'active', 'paused', 'archived'],
        message: [
          'queued',
          'sent',
          'delivered',
          'opened',
          'clicked',
          'bounced',
          'complained',
          'unsubscribed',
          'failed',
        ],
      },
    }),
  },
]

export const toolsByName = new Map(tools.map((tool) => [tool.name, tool]))

/**
 * Serialisable tool metadata for the browser. Deliberately excludes handlers and
 * schemas so the dashboard can list capabilities without pulling server code
 * into the client bundle.
 */
export type ToolSummary = {
  name: string
  title: string
  scope: string
  description: string
}

export function toolSummaries(): ToolSummary[] {
  return tools.map((tool) => ({
    name: tool.name,
    title: tool.title,
    scope: tool.scope,
    description: tool.description,
  }))
}

/** JSON Schema conversion for the MCP wire format. */
export function toJsonSchema(tool: ToolDefinition): Record<string, unknown> {
  return zodToJsonSchema(tool.schema)
}

export { zodToJsonSchema }

/**
 * Minimal Zod v4 → JSON Schema conversion. Zod already exposes a JSON Schema
 * description on its v4 builds; when it is unavailable we fall back to an
 * object schema so the tool still remains callable.
 */
function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const candidate = schema as unknown as {
    toJSONSchema?: () => Record<string, unknown>
    _zod?: { toJSONSchema?: () => Record<string, unknown> }
  }
  try {
    if (typeof candidate.toJSONSchema === 'function') {
      return candidate.toJSONSchema()
    }
    if (typeof candidate._zod?.toJSONSchema === 'function') {
      return candidate._zod.toJSONSchema()
    }
  } catch {
    /* fall through */
  }
  return { type: 'object', properties: {}, additionalProperties: true }
}

async function tagIdsFor(tagNames?: string[]): Promise<string[] | undefined> {
  if (!tagNames?.length) return undefined
  const tags = await contacts.listTags()
  const wanted = new Set(tagNames.map((name) => name.toLowerCase()))
  return tags.filter((tag) => wanted.has(tag.name.toLowerCase())).map((tag) => tag.id)
}