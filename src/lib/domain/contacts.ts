import type { Tx } from '@/integrations/database/client'
import { many, one, withAdminDb, withAuthenticatedDb } from '@/integrations/database/client'
import { requireWorkspaceMember } from '@/integrations/database/auth-runtime'
import { NotFoundError, ValidationError } from '@/lib/auth/session'
import { parseCsv, toCsv } from '@/lib/utils'
import { recordEvent, listActivity } from './activity'
import { mapActivity, mapContact, mapCustomField, mapMessage, mapTag } from './mappers'
import type {
  ActivityItem,
  Contact,
  ContactRow,
  CustomFieldDefinition,
  EmailMessage,
  Paginated,
  Tag,
} from './types'

export type ContactListQuery = {
  page?: number
  pageSize?: number
  search?: string
  status?: string | null
  tagIds?: string[]
  sort?: 'created_at' | 'email' | 'last_activity_at' | 'first_name'
  direction?: 'asc' | 'desc'
  segmentId?: string | null
}

const SORTABLE = new Set(['created_at', 'email', 'last_activity_at', 'first_name'])

function normaliseEmail(email: string): string {
  const value = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new ValidationError(`"${email}" is not a valid email address`)
  }
  return value
}

export async function listContacts(
  query: ContactListQuery = {},
): Promise<Paginated<Contact>> {
  const { userId, workspaceId } = await requireWorkspaceMember()

  return withAuthenticatedDb({ userId, workspaceId }, (tx) =>
    listContactsInTx(tx, workspaceId, query),
  )
}

/** Reads contacts as the given workspace member. */
export async function listContactsAs(
  context: { userId: string; workspaceId: string },
  query: ContactListQuery = {},
): Promise<Paginated<Contact>> {
  return withAuthenticatedDb(context, (tx) =>
    listContactsInTx(tx, context.workspaceId, query),
  )
}

async function listContactsInTx(
  tx: Tx,
  workspaceId: string,
  query: ContactListQuery,
): Promise<Paginated<Contact>> {
  const page = Math.max(1, query.page ?? 1)
  const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 25))
  const params: unknown[] = [workspaceId]
  const filters = ['c.workspace_id = $1']

  if (query.search?.trim()) {
    params.push(`%${query.search.trim().toLowerCase()}%`)
    const p = `$${params.length}`
    filters.push(
      `(lower(c.email) like ${p} or lower(coalesce(c.first_name,'')) like ${p} or lower(coalesce(c.last_name,'')) like ${p} or lower(coalesce(c.company,'')) like ${p})`,
    )
  }

  if (query.status) {
    params.push(query.status)
    filters.push(`c.status = $${params.length}::public.contact_status`)
  }

  if (query.tagIds?.length) {
    params.push(query.tagIds)
    filters.push(
      `exists (select 1 from public.contact_tags ct where ct.contact_id = c.id and ct.tag_id = any($${params.length}::uuid[]))`,
    )
  }

  if (query.segmentId) {
    const { resolveSegmentContactIds } = await import('./segments')
    const ids = await resolveSegmentContactIds(tx, workspaceId, query.segmentId)
    if (ids.length === 0) {
      return { items: [], total: 0, page, pageSize, pageCount: 0 }
    }
    params.push(ids)
    filters.push(`c.id = any($${params.length}::uuid[])`)
  }

  const sort = query.sort && SORTABLE.has(query.sort) ? query.sort : 'created_at'
  const direction = query.direction === 'asc' ? 'asc' : 'desc'
  const where = `where ${filters.join(' and ')}`

  const totalRow = await one<{ count: number }>(
    tx,
    `select count(*)::int as count from public.contacts c ${where}`,
    params,
  )

  params.push(pageSize)
  const limitIndex = params.length
  params.push((page - 1) * pageSize)
  const offsetIndex = params.length

  const rows = await many<ContactRow>(
    tx,
    `
    select c.* from public.contacts c
    ${where}
    order by c.${sort} ${direction} nulls last, c.id asc
    limit $${limitIndex} offset $${offsetIndex}
    `,
    params,
  )

  const tagsByContact = await tagsForContacts(tx, workspaceId, rows.map((r) => r.id))

  return {
    items: rows.map((row) => mapContact(row, tagsByContact.get(row.id) ?? [])),
    total: totalRow?.count ?? 0,
    page,
    pageSize,
    pageCount: Math.ceil((totalRow?.count ?? 0) / pageSize),
  }
}

async function tagsForContacts(
  tx: Tx,
  workspaceId: string,
  contactIds: string[],
): Promise<Map<string, Tag[]>> {
  const result = new Map<string, Tag[]>()
  if (contactIds.length === 0) return result

  const rows = await many<Record<string, any>>(
    tx,
    `
    select ct.contact_id, t.id, t.name, t.color, t.created_at
    from public.contact_tags ct
    join public.tags t on t.id = ct.tag_id
    where ct.contact_id = any($1::uuid[])
    order by t.name asc
    `,
    [contactIds],
  )

  for (const row of rows) {
    const list = result.get(row.contact_id) ?? []
    list.push(mapTag(row))
    result.set(row.contact_id, list)
  }
  return result
}

export async function getContact(id: string) {
  const { userId, workspaceId } = await requireWorkspaceMember()

  return withAuthenticatedDb({ userId, workspaceId }, async (tx) => {
    const row = await one<ContactRow>(
      tx,
      'select * from public.contacts where id = $1',
      [id],
    )
    if (!row) throw new NotFoundError('Contact not found')

    const tags = (await tagsForContacts(tx, workspaceId, [id])).get(id) ?? []
    const activity = await listActivity(tx, { contactId: id, limit: 200 })

    const messages = await many<Record<string, any>>(
      tx,
      `
      select m.*, c.name as campaign_name, w.name as workflow_name
      from public.email_messages m
      left join public.campaigns c on c.id = m.campaign_id
      left join public.workflows w on w.id = m.workflow_id
      where m.contact_id = $1
      order by m.created_at desc
      limit 100
      `,
      [id],
    )

    const campaignIds = [
      ...new Set(
        messages
          .filter((m) => m.campaign_id)
          .map((m) => ({ id: m.campaign_id as string, name: m.campaign_name as string })),
      ),
    ]
    const workflowIds = [
      ...new Set(
        messages
          .filter((m) => m.workflow_id)
          .map((m) => ({ id: m.workflow_id as string, name: m.workflow_name as string })),
      ),
    ]

    const customFields = await readCustomFields(tx)
    const counters = await one<Record<string, number>>(
      tx,
      `
      select
        count(*) filter (where sent_at is not null)::int as sent,
        count(*) filter (where status = 'delivered')::int as delivered,
        count(*) filter (where first_opened_at is not null)::int as opened,
        count(*) filter (where first_clicked_at is not null)::int as clicked,
        count(*) filter (where status = 'bounced')::int as bounced,
        count(*) filter (where status = 'unsubscribed')::int as unsubscribed
      from public.email_messages where contact_id = $1
      `,
      [id],
    )

    return {
      contact: mapContact(row, tags),
      activity: activity as ActivityItem[],
      messages: messages.map((m) => ({
        ...mapMessage(m),
        campaignName: m.campaign_name ?? null,
        workflowName: m.workflow_name ?? null,
      })) as (EmailMessage & { campaignName: string | null; workflowName: string | null })[],
      campaigns: campaignIds,
      workflows: workflowIds,
      customFields,
      counters,
    }
  })
}

export type ContactInput = {
  email: string
  firstName?: string | null
  lastName?: string | null
  phone?: string | null
  company?: string | null
  status?: Contact['status']
  source?: string | null
  customFields?: Record<string, unknown>
  tagIds?: string[]
  tagNames?: string[]
}

export async function createContact(input: ContactInput): Promise<Contact> {
  const { userId, workspaceId } = await requireWorkspaceMember()
  return withAuthenticatedDb({ userId, workspaceId }, async (tx) => {
    const email = normaliseEmail(input.email)

    const existing = await one<ContactRow>(
      tx,
      'select * from public.contacts where workspace_id = $1 and email = $2',
      [workspaceId, email],
    )

    if (existing) {
      throw new ValidationError('A contact with this email already exists')
    }

    const row = await one<ContactRow>(
      tx,
      `
      insert into public.contacts (
        workspace_id, email, first_name, last_name, phone, company,
        status, source, custom_fields
      )
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      returning *
      `,
      [
        workspaceId,
        email,
        input.firstName ?? null,
        input.lastName ?? null,
        input.phone ?? null,
        input.company ?? null,
        input.status ?? 'subscribed',
        input.source ?? 'manual',
        JSON.stringify(input.customFields ?? {}),
      ],
    )

    await recordEvent(tx, {
      workspaceId,
      contactId: row!.id,
      eventType: 'created',
      metadata: { source: input.source ?? 'manual' },
    })

    if (input.tagIds?.length || input.tagNames?.length) {
      await attachTags(tx, workspaceId, row!.id, {
        tagIds: input.tagIds ?? [],
        tagNames: input.tagNames ?? [],
      })
    }

    return mapContact(row!, await tagsForContacts(tx, workspaceId, [row!.id]).then((m) => m.get(row!.id) ?? []))
  })
}

export async function updateContact(
  id: string,
  patch: Partial<ContactInput>,
): Promise<Contact> {
  const { userId, workspaceId } = await requireWorkspaceMember()
  return withAuthenticatedDb({ userId, workspaceId }, async (tx) => {
    const current = await one<ContactRow>(
      tx,
      'select * from public.contacts where id = $1',
      [id],
    )
    if (!current) throw new NotFoundError('Contact not found')

    const email = patch.email ? normaliseEmail(patch.email) : current.email
    const status =
      patch.status === 'unsubscribed' && current.status !== 'unsubscribed'
        ? 'unsubscribed'
        : (patch.status ?? current.status)

    const row = await one<ContactRow>(
      tx,
      `
      update public.contacts set
        email = $2,
        first_name = $3,
        last_name = $4,
        phone = $5,
        company = $6,
        status = $7::public.contact_status,
        source = $8,
        custom_fields = $9,
        -- $7 drives both the enum column and this comparison, so both uses need
        -- an explicit cast: Postgres refuses to deduce one parameter as both
        -- an enum and text.
        unsubscribed_at = case
          when $7::text = 'unsubscribed' then coalesce(unsubscribed_at, now())
          else null
        end,
        updated_at = now()
      where id = $1
      returning *
      `,
      [
        id,
        email,
        patch.firstName !== undefined ? patch.firstName : current.first_name,
        patch.lastName !== undefined ? patch.lastName : current.last_name,
        patch.phone !== undefined ? patch.phone : current.phone,
        patch.company !== undefined ? patch.company : current.company,
        status,
        patch.source !== undefined ? patch.source : current.source,
        JSON.stringify(
          patch.customFields !== undefined
            ? { ...current.custom_fields, ...patch.customFields }
            : current.custom_fields,
        ),
      ],
    )

    await recordEvent(tx, {
      workspaceId,
      contactId: id,
      eventType: 'updated',
      metadata: { fields: Object.keys(patch) },
    })

    if (patch.tagIds || patch.tagNames) {
      await replaceTags(tx, workspaceId, id, {
        tagIds: patch.tagIds ?? [],
        tagNames: patch.tagNames ?? [],
      })
    }

    return mapContact(row!, await tagsForContacts(tx, workspaceId, [id]).then((m) => m.get(id) ?? []))
  })
}

export async function deleteContacts(ids: string[]): Promise<number> {
  const { userId, workspaceId } = await requireWorkspaceMember()
  return withAuthenticatedDb({ userId, workspaceId }, async (tx) => {
    const result = await tx.query(
      'delete from public.contacts where id = any($1::uuid[])',
      [ids],
    )
    return result.affectedRows ?? 0
  })
}

/* ------------------------------------------------------------------ tags */

export async function listTags(): Promise<(Tag & { count: number })[]> {
  const { userId, workspaceId } = await requireWorkspaceMember()
  return withAuthenticatedDb({ userId, workspaceId }, async (tx) => {
    const rows = await many<Record<string, any>>(
      tx,
      `
      select t.*, count(ct.id)::int as count
      from public.tags t
      left join public.contact_tags ct on ct.tag_id = t.id
      group by t.id
      order by count desc, t.name asc
      `,
    )
    return rows.map((row) => ({ ...mapTag(row), count: Number(row.count) }))
  })
}

export async function createTag(name: string, color = 'neutral'): Promise<Tag> {
  const { userId, workspaceId } = await requireWorkspaceMember()
  return withAuthenticatedDb({ userId, workspaceId }, async (tx) => {
    const row = await one<Record<string, any>>(
      tx,
      `
      insert into public.tags (workspace_id, name, color)
      values ($1, $2, $3)
      on conflict (workspace_id, name) do update set color = excluded.color
      returning *
      `,
      [workspaceId, name.trim(), color],
    )
    return mapTag(row!)
  })
}

export async function deleteTag(id: string): Promise<void> {
  const { userId, workspaceId } = await requireWorkspaceMember()
  await withAuthenticatedDb({ userId, workspaceId }, (tx) =>
    tx.query('delete from public.tags where id = $1', [id]),
  )
}

async function attachTags(
  tx: Tx,
  workspaceId: string,
  contactId: string,
  input: { tagIds: string[]; tagNames: string[] },
): Promise<void> {
  for (const tagId of input.tagIds) {
    await tx.query(
      `insert into public.contact_tags (workspace_id, contact_id, tag_id)
       values ($1,$2,$3) on conflict (contact_id, tag_id) do nothing`,
      [workspaceId, contactId, tagId],
    )
  }

  for (const rawName of input.tagNames) {
    const name = rawName.trim()
    if (!name) continue
    const tag = await one<{ id: string }>(
      tx,
      `
      insert into public.tags (workspace_id, name) values ($1,$2)
      on conflict (workspace_id, name) do update set name = excluded.name
      returning id
      `,
      [workspaceId, name],
    )
    await tx.query(
      `insert into public.contact_tags (workspace_id, contact_id, tag_id)
       values ($1,$2,$3) on conflict (contact_id, tag_id) do nothing`,
      [workspaceId, contactId, tag!.id],
    )
  }
}

async function replaceTags(
  tx: Tx,
  workspaceId: string,
  contactId: string,
  input: { tagIds: string[]; tagNames: string[] },
): Promise<void> {
  await tx.query('delete from public.contact_tags where contact_id = $1', [contactId])
  await attachTags(tx, workspaceId, contactId, input)
}

export async function addTagsToContacts(
  contactIds: string[],
  tagNames: string[],
): Promise<number> {
  const { userId, workspaceId } = await requireWorkspaceMember()
  return withAuthenticatedDb({ userId, workspaceId }, async (tx) => {
    for (const contactId of contactIds) {
      await attachTags(tx, workspaceId, contactId, { tagIds: [], tagNames })
      for (const rawName of tagNames) {
        const name = rawName.trim()
        if (!name) continue
        await recordEvent(tx, {
          workspaceId,
          contactId,
          eventType: 'tag_added',
          metadata: { tag: name },
        })
      }
    }
    return contactIds.length
  })
}

export async function removeTagFromContacts(
  contactIds: string[],
  tagId: string,
): Promise<number> {
  const { userId, workspaceId } = await requireWorkspaceMember()
  return withAuthenticatedDb({ userId, workspaceId }, async (tx) => {
    const tag = await one<{ name: string }>(
      tx,
      'select name from public.tags where id = $1',
      [tagId],
    )
    for (const contactId of contactIds) {
      await tx.query(
        'delete from public.contact_tags where contact_id = $1 and tag_id = $2',
        [contactId, tagId],
      )
      await recordEvent(tx, {
        workspaceId,
        contactId,
        eventType: 'tag_removed',
        metadata: { tag: tag?.name ?? tagId },
      })
    }
    return contactIds.length
  })
}

/* ------------------------------------------------------------------ CSV */

export async function importContactsCsv(csv: string) {
  const { userId, workspaceId } = await requireWorkspaceMember()

  const rows = parseCsv(csv)
  if (rows.length === 0) throw new ValidationError('The CSV file is empty')

  const header = rows[0]!.map((cell) => cell.trim().toLowerCase())
  const index = (name: string) => header.indexOf(name)

  const emailIndex = index('email')
  if (emailIndex === -1) {
    throw new ValidationError('The CSV must contain an "email" column')
  }

  return withAuthenticatedDb({ userId, workspaceId }, async (tx) => {
    const created: string[] = []
    const updated: string[] = []
    const errors: { row: number; email: string; reason: string }[] = []

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]!
      const rawEmail = row[emailIndex]?.trim() ?? ''
      if (!rawEmail) continue

      try {
        const email = normaliseEmail(rawEmail)
        const cell = (name: string) => {
          const position = index(name)
          return position >= 0 ? (row[position]?.trim() || null) : null
        }

        const existing = await one<ContactRow>(
          tx,
          'select * from public.contacts where workspace_id = $1 and email = $2',
          [workspaceId, email],
        )

        const record = await one<ContactRow>(
          tx,
          `
          insert into public.contacts (
            workspace_id, email, first_name, last_name, phone, company, source, custom_fields
          )
          values ($1,$2,$3,$4,$5,$6,'import',$7)
          on conflict (workspace_id, email) do update set
            first_name = coalesce(excluded.first_name, public.contacts.first_name),
            last_name = coalesce(excluded.last_name, public.contacts.last_name),
            phone = coalesce(excluded.phone, public.contacts.phone),
            company = coalesce(excluded.company, public.contacts.company),
            updated_at = now()
          returning *, (xmax = 0) as inserted
          `,
          [
            workspaceId,
            email,
            cell('first_name') ?? cell('firstname') ?? cell('first name'),
            cell('last_name') ?? cell('lastname') ?? cell('last name'),
            cell('phone'),
            cell('company'),
            JSON.stringify({}),
          ],
        )

        ;(existing ? updated : created).push(record!.id)

        await recordEvent(tx, {
          workspaceId,
          contactId: record!.id,
          eventType: existing ? 'updated' : 'created',
          metadata: { source: 'csv_import' },
        })
      } catch (error) {
        errors.push({
          row: i + 1,
          email: rawEmail,
          reason: (error as Error).message,
        })
      }
    }

    return {
      created: created.length,
      updated: updated.length,
      failed: errors.length,
      errors: errors.slice(0, 20),
    }
  })
}

export async function exportContactsCsv(
  query: ContactListQuery = {},
): Promise<string> {
  const { userId, workspaceId } = await requireWorkspaceMember()
  return withAuthenticatedDb({ userId, workspaceId }, async (tx) => {
    const rows = await many<ContactRow & { tags: string | null }>(
      tx,
      `
      select c.*, (
        select string_agg(t.name, ', ') from public.contact_tags ct
        join public.tags t on t.id = ct.tag_id where ct.contact_id = c.id
      ) as tags
      from public.contacts c
      where c.workspace_id = $1
      order by c.created_at desc
      limit 50000
      `,
      [workspaceId],
    )

    return toCsv(
      [
        'email',
        'first_name',
        'last_name',
        'phone',
        'company',
        'status',
        'source',
        'tags',
        'created_at',
      ],
      rows.map((row) => [
        row.email,
        row.first_name,
        row.last_name,
        row.phone,
        row.company,
        row.status,
        row.source,
        row.tags,
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : row.created_at,
      ]),
    )
  })
}

/* -------------------------------------------------------- custom fields */

/**
 * Reads the custom field definitions.
 *
 * `tx` lets callers that already hold a transaction reuse it. Opening a second
 * one would deadlock: PGlite has a single connection, so a transaction started
 * inside another transaction's body can never be scheduled.
 */
async function readCustomFields(tx: Tx): Promise<CustomFieldDefinition[]> {
  const rows = await many<Record<string, any>>(
    tx,
    'select * from public.custom_field_definitions order by created_at asc',
  )
  return rows.map(mapCustomField)
}

export async function listCustomFields(): Promise<CustomFieldDefinition[]> {
  const { userId, workspaceId } = await requireWorkspaceMember()
  return withAuthenticatedDb({ userId, workspaceId }, (tx) => readCustomFields(tx))
}

export async function createCustomField(input: {
  key: string
  label: string
  fieldType?: CustomFieldDefinition['fieldType']
  options?: string[]
}): Promise<CustomFieldDefinition> {
  const { userId, workspaceId } = await requireWorkspaceMember()
  return withAuthenticatedDb({ userId, workspaceId }, async (tx) => {
    const row = await one<Record<string, any>>(
      tx,
      `
      insert into public.custom_field_definitions (workspace_id, key, label, field_type, options)
      values ($1,$2,$3,$4,$5)
      on conflict (workspace_id, key) do update set label = excluded.label
      returning *
      `,
      [
        workspaceId,
        input.key.trim().toLowerCase().replace(/\s+/g, '_'),
        input.label,
        input.fieldType ?? 'text',
        JSON.stringify(input.options ?? []),
      ],
    )
    return mapCustomField(row!)
  })
}

export async function deleteCustomField(id: string): Promise<void> {
  const { userId, workspaceId } = await requireWorkspaceMember()
  await withAuthenticatedDb({ userId, workspaceId }, (tx) =>
    tx.query('delete from public.custom_field_definitions where id = $1', [id]),
  )
}

/* ------------------------------------------------------------- workspace */

export async function contactStats() {
  const { userId, workspaceId } = await requireWorkspaceMember()
  return withAuthenticatedDb({ userId, workspaceId }, async (tx) =>
    one<Record<string, number>>(tx, `
      select
        count(*)::int as total,
        count(*) filter (where status = 'subscribed')::int as subscribed,
        count(*) filter (where status = 'unsubscribed')::int as unsubscribed,
        count(*) filter (where status = 'bounced')::int as bounced,
        count(*) filter (where created_at > now() - interval '30 days')::int as new_last_30_days
      from public.contacts
    `),
  )
}

export { mapActivity }
/**
 * Unsubscribes a contact. Used by the public unsubscribe page.
 *
 * When `all` is false only the messages still queued from the most recent send
 * are cancelled, which matches what a recipient expects when they unsubscribe
 * "from this email".
 */
export async function unsubscribeAll(
  workspaceId: string,
  contactId: string | null,
  all: boolean,
): Promise<{ remaining: number }> {
  return withAdminDb(async (tx) => {
    if (!contactId) {
      return { remaining: 0 }
    }

    if (all) {
      await tx.query(
        `update public.contacts
         set status = 'unsubscribed', unsubscribed_at = now(), updated_at = now()
         where id = $1`,
        [contactId],
      )
      await tx.query(
        `update public.email_messages
         set status = 'unsubscribed'
         where contact_id = $1 and status in ('queued','sent')`,
        [contactId],
      )
      await recordEvent(tx, {
        workspaceId,
        contactId,
        eventType: 'unsubscribed',
        metadata: { scope: 'all' },
      })
      return { remaining: 0 }
    }

    const result = await tx.query(
      `update public.email_messages
       set status = 'unsubscribed'
       where contact_id = $1 and status in ('queued','sent')
       returning id`,
      [contactId],
    )
    const cancelled = result.affectedRows ?? 0

    await recordEvent(tx, {
      workspaceId,
      contactId,
      eventType: 'unsubscribed',
      metadata: { scope: 'campaign', cancelled },
    })

    return { remaining: cancelled }
  })
}
