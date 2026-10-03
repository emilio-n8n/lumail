import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { z } from 'zod'
import { guard } from './auth'
import { EMAIL_VARIABLES } from '@/lib/email/variables'
import {
  SEGMENT_FIELDS,
  SEGMENT_OPERATORS,
} from '@/lib/domain/segment-query'

/**
 * Contacts, tags, custom fields and segments.
 *
 * The domain layer reaches the database, so it is loaded lazily: this module is
 * also shipped to the browser as an RPC stub.
 */
const loadDeps = createServerOnlyFn(async () => {
  const [contacts, segments, ticker] = await Promise.all([
    import('@/lib/domain/contacts'),
    import('@/lib/domain/segments'),
    import('@/lib/jobs/ticker'),
  ])
  return { contacts, segments, ensureJobTicker: ticker.ensureJobTicker }
})

function load() {
  return loadDeps()
}

/**
 * Server functions for the people side of the product: contacts, tags, custom
 * fields, segments and the activity stream. The public API and the MCP tools
 * call the exact same domain functions underneath.
 */

const tagSchema = z.array(z.string().uuid())

const contactInput = z.object({
  email: z.string().email('Enter a valid email address'),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  company: z.string().nullable().optional(),
  status: z.enum(['subscribed', 'unsubscribed', 'bounced', 'complained', 'archived']).optional(),
  source: z.string().nullable().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  tagIds: tagSchema.optional(),
  tagNames: z.array(z.string()).optional(),
})

export const contactList = createServerFn({ method: 'GET' })
    .validator(
      z.object({
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(1).max(200).optional(),
        search: z.string().optional(),
        status: z.string().nullable().optional(),
        tagIds: tagSchema.optional(),
        sort: z.enum(['created_at', 'email', 'last_activity_at', 'first_name']).optional(),
        direction: z.enum(['asc', 'desc']).optional(),
        segmentId: z.string().uuid().nullable().optional(),
      }),
    )
    .handler(async ({ data }) =>
      guard(async () => {
        const { contacts, ensureJobTicker } = await load()
        ensureJobTicker()
        return contacts.listContacts(data)
      }),
    )

export const contactGet = createServerFn({ method: 'GET' })
    .validator(z.object({ id: z.string().uuid() }))
    .handler(async ({ data }) =>
      guard(async () => (await load()).contacts.getContact(data.id)),
    )

export const contactCreate = createServerFn({ method: 'POST' })
    .validator(contactInput)
    .handler(async ({ data }) =>
      guard(async () => {
        const { contacts } = await load()
        const { handleTrigger } = await import('@/lib/workflows/engine')
        const contact = await contacts.createContact(data)
        await handleTrigger({
          type: 'contact_created',
          workspaceId: await currentWorkspaceId(),
          contactId: contact.id,
        }).catch(() => 0)
        return contact
      }),
    )

export const contactUpdate = createServerFn({ method: 'POST' })
    .validator(contactInput.partial().extend({ id: z.string().uuid() }))
    .handler(async ({ data }) =>
      guard(async () => {
        const { id, ...patch } = data
        return (await load()).contacts.updateContact(id, patch as never)
      }),
    )

export const contactRemove = createServerFn({ method: 'POST' })
    .validator(z.object({ ids: z.array(z.string().uuid()).min(1) }))
    .handler(async ({ data }) =>
      guard(async () => (await load()).contacts.deleteContacts(data.ids)),
    )

export const contactTags = createServerFn({ method: 'GET' }).handler(() =>
    guard(async () => (await load()).contacts.listTags()),
  )

export const contactCreateTag = createServerFn({ method: 'POST' })
    .validator(
      z.object({
        name: z.string().min(1, 'Give the tag a name'),
        color: z.string().optional(),
      }),
    )
    .handler(async ({ data }) =>
      guard(async () => (await load()).contacts.createTag(data.name, data.color)),
    )

export const contactDeleteTag = createServerFn({ method: 'POST' })
    .validator(z.object({ id: z.string().uuid() }))
    .handler(async ({ data }) =>
      guard(async () => (await load()).contacts.deleteTag(data.id)),
    )

export const contactAddTags = createServerFn({ method: 'POST' })
    .validator(
      z.object({
        contactIds: z.array(z.string().uuid()).min(1),
        tagNames: z.array(z.string()).min(1),
      }),
    )
    .handler(async ({ data }) =>
      guard(async () =>
        (await load()).contacts.addTagsToContacts(data.contactIds, data.tagNames),
      ),
    )

export const contactRemoveTag = createServerFn({ method: 'POST' })
    .validator(
      z.object({
        contactIds: z.array(z.string().uuid()).min(1),
        tagId: z.string().uuid(),
      }),
    )
    .handler(async ({ data }) =>
      guard(async () =>
        (await load()).contacts.removeTagFromContacts(data.contactIds, data.tagId),
      ),
    )

export const contactImportCsv = createServerFn({ method: 'POST' })
    .validator(z.object({ csv: z.string().min(1, 'Paste some CSV first') }))
    .handler(async ({ data }) =>
      guard(async () => (await load()).contacts.importContactsCsv(data.csv)),
    )

export const contactExportCsv = createServerFn({ method: 'GET' }).handler(async () =>
    guard(async () => (await load()).contacts.exportContactsCsv()),
  )

export const contactCustomFields = createServerFn({ method: 'GET' }).handler(async () =>
    guard(async () => (await load()).contacts.listCustomFields()),
  )

export const contactCreateCustomField = createServerFn({ method: 'POST' })
    .validator(
      z.object({
        key: z.string().min(1),
        label: z.string().min(1),
        fieldType: z.enum(['text', 'number', 'date', 'boolean', 'select']).optional(),
        options: z.array(z.string()).optional(),
      }),
    )
    .handler(async ({ data }) =>
      guard(async () => (await load()).contacts.createCustomField(data)),
    )

export const contactDeleteCustomField = createServerFn({ method: 'POST' })
    .validator(z.object({ id: z.string().uuid() }))
    .handler(async ({ data }) =>
      guard(async () => (await load()).contacts.deleteCustomField(data.id)),
    )

export const contactStats = createServerFn({ method: 'GET' }).handler(async () =>
    guard(async () => (await load()).contacts.contactStats()),
  )

export const contactServerFns = {
  list: contactList,
  get: contactGet,
  create: contactCreate,
  update: contactUpdate,
  remove: contactRemove,
  tags: contactTags,
  createTag: contactCreateTag,
  deleteTag: contactDeleteTag,
  addTags: contactAddTags,
  removeTag: contactRemoveTag,
  importCsv: contactImportCsv,
  exportCsv: contactExportCsv,
  customFields: contactCustomFields,
  createCustomField: contactCreateCustomField,
  deleteCustomField: contactDeleteCustomField,
  stats: contactStats,
}


const conditionSchema = z.object({
  id: z.string().optional(),
  field: z.enum(SEGMENT_FIELDS as unknown as [string, ...string[]]),
  operator: z.enum(SEGMENT_OPERATORS as unknown as [string, ...string[]]),
  value: z.string().default(''),
  campaignId: z.string().nullable().optional(),
  eventName: z.string().nullable().optional(),
  customField: z.string().nullable().optional(),
})

export const segmentList = createServerFn({ method: 'GET' }).handler(() =>
    guard(async () => (await load()).segments.listSegments()),
  )

export const segmentGet = createServerFn({ method: 'GET' })
    .validator(z.object({ id: z.string().uuid() }))
    .handler(async ({ data }) =>
      guard(async () => (await load()).segments.getSegment(data.id)),
    )

export const segmentMembers = createServerFn({ method: 'GET' })
    .validator(
      z.object({
        id: z.string().uuid(),
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(1).max(200).optional(),
      }),
    )
    .handler(async ({ data }) =>
      guard(async () =>
        (await load()).segments.getSegmentMembers(
          data.id,
          data.page ?? 1,
          data.pageSize ?? 25,
        ),
      ),
    )

export const segmentCreate = createServerFn({ method: 'POST' })
    .validator(
      z.object({
        name: z.string().min(1, 'Give the segment a name'),
        description: z.string().nullable().optional(),
        matchMode: z.enum(['all', 'any']).optional(),
        conditions: z.array(conditionSchema).min(1, 'Add at least one condition'),
        includeManuallyAdded: z.boolean().optional(),
      }),
    )
    .handler(async ({ data }) =>
      guard(async () => (await load()).segments.createSegment(data as never)),
    )

export const segmentUpdate = createServerFn({ method: 'POST' })
    .validator(
      z.object({
        id: z.string().uuid(),
        name: z.string().optional(),
        description: z.string().nullable().optional(),
        matchMode: z.enum(['all', 'any']).optional(),
        conditions: z.array(conditionSchema).optional(),
        includeManuallyAdded: z.boolean().optional(),
      }),
    )
    .handler(async ({ data }) =>
      guard(async () => {
        const { id, ...patch } = data
        return (await load()).segments.updateSegment(id, patch as never)
      }),
    )

export const segmentRemove = createServerFn({ method: 'POST' })
    .validator(z.object({ id: z.string().uuid() }))
    .handler(async ({ data }) =>
      guard(async () => (await load()).segments.deleteSegment(data.id)),
    )

export const segmentSetMembers = createServerFn({ method: 'POST' })
    .validator(
      z.object({
        segmentId: z.string().uuid(),
        contactIds: z.array(z.string().uuid()).min(1),
        mode: z.enum(['add', 'remove']),
      }),
    )
    .handler(async ({ data }) =>
      guard(async () =>
        (await load()).segments.setSegmentMembers(
          data.segmentId,
          data.contactIds,
          data.mode,
        ),
      ),
    )

export const segmentPreview = createServerFn({ method: 'POST' })
    .validator(
      z.object({
        conditions: z.array(conditionSchema),
        matchMode: z.enum(['all', 'any']).optional(),
      }),
    )
    .handler(async ({ data }) =>
      guard(async () =>
        (await load()).segments.previewSegment(
          data.conditions as never,
          data.matchMode,
        ),
      ),
    )

export const segmentServerFns = {
  list: segmentList,
  get: segmentGet,
  members: segmentMembers,
  create: segmentCreate,
  update: segmentUpdate,
  remove: segmentRemove,
  setMembers: segmentSetMembers,
  preview: segmentPreview,
}


export const activityList = createServerFn({ method: 'GET' })
    .validator(
      z.object({
        contactId: z.string().uuid().optional(),
        campaignId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
    )
    .handler(({ data }) =>
      guard(async () => {
        const { listActivity } = await import('@/lib/domain/activity')
        const { recentActivity } = await import('@/lib/domain/analytics')
        if (data.contactId) {
          const { requireWorkspaceMember } = await import(
            '@/integrations/database/auth-runtime'
          )
          const { withAuthenticatedDb } = await import(
            '@/integrations/database/client'
          )
          const { userId, workspaceId } = await requireWorkspaceMember()
          return withAuthenticatedDb({ userId, workspaceId }, (tx) =>
            listActivity(tx, { contactId: data.contactId, limit: data.limit }),
          )
        }
        return recentActivity(data.limit ?? 60, data.campaignId ?? null)
      }),
    )

export const activityServerFns = {
  list: activityList,
}


export const metadataToolSummaries = createServerFn({ method: 'GET' }).handler(async () =>
    guard(async () => {
      const { toolSummaries } = await import('@/lib/ai/tools')
      return { tools: toolSummaries() }
    }),
  )

export const metadataVariables = createServerFn({ method: 'GET' }).handler(() =>
    guard(async () => ({
      variables: EMAIL_VARIABLES,
      segmentFields: SEGMENT_FIELDS,
      segmentOperators: SEGMENT_OPERATORS,
    })),
  )

export const metadataServerFns = {
  toolSummaries: metadataToolSummaries,
  variables: metadataVariables,
}


async function currentWorkspaceId(): Promise<string> {
  const { resolveSession } = await import('@/lib/auth/session')
  const session = await resolveSession()
  if (!session?.workspaceId) throw new Error('No workspace selected')
  return session.workspaceId
}