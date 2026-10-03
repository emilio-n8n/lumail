import type { Tx } from '@/integrations/database/client'
import { many, one, withAuthenticatedDb } from '@/integrations/database/client'
import { requireWorkspaceMember } from '@/integrations/database/auth-runtime'
import { NotFoundError } from '@/lib/auth/session'
import { compileSegment, describeCondition } from './segment-query'
import { recordEvent } from './activity'
import { mapContact, mapSegment } from './mappers'
import type { ContactRow, Segment, SegmentCondition } from './types'

export type SegmentInput = {
  name: string
  description?: string | null
  matchMode?: 'all' | 'any'
  conditions: SegmentCondition[]
  includeManuallyAdded?: boolean
}

export async function listSegments(): Promise<(Segment & { summary: string })[]> {
  const { userId, workspaceId } = await requireWorkspaceMember()
  return withAuthenticatedDb({ userId, workspaceId }, async (tx) => {
    const rows = await many<Record<string, any>>(
      tx,
      'select * from public.segments order by updated_at desc',
    )
    return rows.map((row) => ({
      ...mapSegment(row),
      summary: summarise(row.conditions ?? [], row.match_mode),
    }))
  })
}

export async function getSegment(id: string): Promise<Segment & { summary: string }> {
  const { userId, workspaceId } = await requireWorkspaceMember()
  return withAuthenticatedDb({ userId, workspaceId }, async (tx) => {
    const row = await one<Record<string, any>>(
      tx,
      'select * from public.segments where id = $1',
      [id],
    )
    if (!row) throw new NotFoundError('Segment not found')
    return {
      ...mapSegment(row),
      summary: summarise(row.conditions ?? [], row.match_mode),
    }
  })
}

export async function createSegment(input: SegmentInput): Promise<Segment> {
  const { userId, workspaceId } = await requireWorkspaceMember()
  return withAuthenticatedDb({ userId, workspaceId }, async (tx) => {
    const row = await one<Record<string, any>>(
      tx,
      `
      insert into public.segments (
        workspace_id, name, description, match_mode, conditions, include_manually_added
      )
      values ($1,$2,$3,$4,$5,$6)
      returning *
      `,
      [
        workspaceId,
        input.name,
        input.description ?? null,
        input.matchMode ?? 'all',
        JSON.stringify(normaliseConditions(input.conditions)),
        input.includeManuallyAdded ?? true,
      ],
    )
    return mapSegment(row!)
  })
}

export async function updateSegment(
  id: string,
  patch: Partial<SegmentInput>,
): Promise<Segment> {
  const { userId, workspaceId } = await requireWorkspaceMember()
  return withAuthenticatedDb({ userId, workspaceId }, async (tx) => {
    const current = await one<Record<string, any>>(
      tx,
      'select * from public.segments where id = $1',
      [id],
    )
    if (!current) throw new NotFoundError('Segment not found')

    const row = await one<Record<string, any>>(
      tx,
      `
      update public.segments set
        name = $2,
        description = $3,
        match_mode = $4,
        conditions = $5,
        include_manually_added = $6,
        cached_count = null,
        updated_at = now()
      where id = $1
      returning *
      `,
      [
        id,
        patch.name ?? current.name,
        patch.description !== undefined ? patch.description : current.description,
        patch.matchMode ?? current.match_mode,
        JSON.stringify(
          patch.conditions ? normaliseConditions(patch.conditions) : current.conditions,
        ),
        patch.includeManuallyAdded ?? current.include_manually_added,
      ],
    )
    return mapSegment(row!)
  })
}

export async function deleteSegment(id: string): Promise<void> {
  const { userId, workspaceId } = await requireWorkspaceMember()
  await withAuthenticatedDb({ userId, workspaceId }, (tx) =>
    tx.query('delete from public.segments where id = $1', [id]),
  )
}

/** Adds or removes explicit membership (independent of the dynamic rules). */
export async function setSegmentMembers(
  segmentId: string,
  contactIds: string[],
  mode: 'add' | 'remove',
): Promise<number> {
  const { userId, workspaceId } = await requireWorkspaceMember()
  return withAuthenticatedDb({ userId, workspaceId }, async (tx) => {
    const segment = await one<Record<string, any>>(
      tx,
      'select * from public.segments where id = $1',
      [segmentId],
    )
    if (!segment) throw new NotFoundError('Segment not found')

    if (mode === 'add') {
      for (const contactId of contactIds) {
        await tx.query(
          `insert into public.segment_memberships (workspace_id, segment_id, contact_id)
           values ($1,$2,$3) on conflict (segment_id, contact_id) do nothing`,
          [workspaceId, segmentId, contactId],
        )
        await recordEvent(tx, {
          workspaceId,
          contactId,
          eventType: 'segment_added',
          metadata: { segmentId, segmentName: segment.name },
        })
      }
    } else {
      await tx.query(
        'delete from public.segment_memberships where segment_id = $1 and contact_id = any($2::uuid[])',
        [segmentId, contactIds],
      )
      for (const contactId of contactIds) {
        await recordEvent(tx, {
          workspaceId,
          contactId,
          eventType: 'segment_removed',
          metadata: { segmentId, segmentName: segment.name },
        })
      }
    }

    await tx.query(
      'update public.segments set cached_count = null, updated_at = now() where id = $1',
      [segmentId],
    )

    return contactIds.length
  })
}

/**
 * Evaluates a segment. Contacts are derived from the compiled predicate plus
 * explicit memberships — always current, never a stale snapshot.
 */
export async function resolveSegmentContactIds(
  tx: Tx,
  workspaceId: string,
  segmentId: string,
): Promise<string[]> {
  const segment = await one<Record<string, any>>(
    tx,
    'select * from public.segments where id = $1',
    [segmentId],
  )
  if (!segment) throw new NotFoundError('Segment not found')

  const manual = await many<{ contact_id: string }>(
    tx,
    'select contact_id from public.segment_memberships where segment_id = $1',
    [segmentId],
  )

  const compiled = compileSegment(
    segment.conditions ?? [],
    segment.match_mode,
    segment.include_manually_added,
    manual.map((row) => row.contact_id),
  )

  const rows = await many<{ id: string }>(
    tx,
    `select c.id from public.contacts c where ${compiled.clause} order by c.created_at desc limit 100000`,
    compiled.params,
  )

  return rows.map((row) => row.id)
}

export async function getSegmentMembers(
  segmentId: string,
  page = 1,
  pageSize = 25,
) {
  const { userId, workspaceId } = await requireWorkspaceMember()
  return withAuthenticatedDb({ userId, workspaceId }, async (tx) => {
    const ids = await resolveSegmentContactIds(tx, workspaceId, segmentId)
    if (ids.length === 0) {
      return { items: [], total: 0, page, pageSize, pageCount: 0 }
    }

    const total = ids.length
    const pageCount = Math.ceil(total / pageSize)
    const slice = ids.slice((page - 1) * pageSize, page * pageSize)

    const rows = await many<ContactRow & { opens: number; clicks: number }>(
      tx,
      `
      select c.*,
        (select count(*)::int from public.contact_events e where e.contact_id = c.id and e.event_type = 'opened') as opens,
        (select count(*)::int from public.contact_events e where e.contact_id = c.id and e.event_type = 'clicked') as clicks
      from public.contacts c
      where c.id = any($1::uuid[])
      order by c.created_at desc
      `,
      [slice],
    )

    const byId = new Map(rows.map((row) => [row.id, row]))
    return {
      items: slice.map((id) => {
        const row = byId.get(id)
        return row
          ? { ...mapContact(row), opens: Number(row.opens), clicks: Number(row.clicks) }
          : null
      }).filter(Boolean),
      total,
      page,
      pageSize,
      pageCount,
    }
  })
}

export async function previewSegment(conditions: SegmentCondition[], matchMode: 'all' | 'any' = 'all') {
  const { userId, workspaceId } = await requireWorkspaceMember()
  return withAuthenticatedDb({ userId, workspaceId }, async (tx) => {
    const compiled = compileSegment(normaliseConditions(conditions), matchMode, false)
    const row = await one<{ count: number }>(
      tx,
      `select count(*)::int as count from public.contacts c where ${compiled.clause}`,
      compiled.params,
    )
    return { count: row?.count ?? 0 }
  })
}

function summarise(conditions: SegmentCondition[], matchMode: 'all' | 'any') {
  if (!conditions?.length) return 'All contacts'
  const joiner = matchMode === 'any' ? ' OR ' : ' AND '
  return conditions.map(describeCondition).join(joiner)
}

function normaliseConditions(conditions: SegmentCondition[]): SegmentCondition[] {
  return (conditions ?? []).map((condition, index) => ({
    id: condition.id ?? `cond_${index}_${Math.random().toString(36).slice(2, 8)}`,
    field: condition.field,
    operator: condition.operator,
    value: condition.value ?? '',
    campaignId: condition.campaignId ?? null,
    eventName: condition.eventName ?? null,
    customField: condition.customField ?? null,
  }))
}

export { normaliseConditions }