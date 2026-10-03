import { many, one, withAuthenticatedDb, withAdminDb } from '@/integrations/database/client'
import type { Tx } from '@/integrations/database/client'
import { requireWorkspaceMember } from '@/integrations/database/auth-runtime'
import { NotFoundError, ValidationError } from '@/lib/auth/session'
import { withJobBatch } from '@/lib/jobs/queue'
import { deliverToContact } from '@/lib/email/send'
import { resolveSender } from './workspace'
import { resolveSegmentContactIds } from './segments'
import { queueEventWebhooks } from '@/lib/webhooks/dispatch'
import { mapCampaign, mapCampaignStats } from './mappers'
import type {
  Campaign,
  CampaignStats,
  CampaignStatus,
  ContactRow,
  EmailDocument,
} from './types'

/** Hard ceiling on a single send so a mis-click cannot flood a real inbox. */
const MAX_RECIPIENTS = 20_000
const DELIVERY_CONCURRENCY = 10

export async function listCampaigns(
  query: { status?: string | null; search?: string | null; limit?: number } = {},
): Promise<Campaign[]> {
  const { userId, workspaceId } = await requireWorkspaceMember()

  return withAuthenticatedDb({ userId, workspaceId }, async (tx) => {
    const params: unknown[] = [workspaceId]
    const filters = ['c.workspace_id = $1']

    if (query.status) {
      params.push(query.status)
      filters.push(`c.status = $${params.length}::public.campaign_status`)
    }
    if (query.search) {
      params.push(`%${query.search.toLowerCase()}%`)
      const p = `$${params.length}`
      filters.push(`(lower(c.name) like ${p} or lower(c.subject) like ${p})`)
    }

    params.push(Math.min(query.limit ?? 100, 500))

    const rows = await many<Record<string, any>>(
      tx,
      `
      select c.*, s.name as segment_name
      from public.campaigns c
      left join public.segments s on s.id = c.segment_id
      where ${filters.join(' and ')}
      order by c.created_at desc
      limit $${params.length}
      `,
      params,
    )
    return rows.map(mapCampaign)
  })
}

export async function getCampaign(id: string): Promise<Campaign & { stats: CampaignStats }> {
  const { userId, workspaceId } = await requireWorkspaceMember()

  return withAuthenticatedDb({ userId, workspaceId }, async (tx) => {
    const row = await one<Record<string, any>>(
      tx,
      `
      select c.*, s.name as segment_name
      from public.campaigns c
      left join public.segments s on s.id = c.segment_id
      where c.id = $1
      `,
      [id],
    )
    if (!row) throw new NotFoundError('Campaign not found')
    return { ...mapCampaign(row), stats: await campaignStatsInTx(tx, workspaceId, id) }
  })
}

export async function createCampaign(input: {
  name: string
  subject?: string
  preheader?: string | null
  fromEmail?: string | null
  fromName?: string | null
  replyTo?: string | null
  templateId?: string | null
  segmentId?: string | null
  html?: string
  document?: EmailDocument
}): Promise<Campaign> {
  const { userId, workspaceId } = await requireWorkspaceMember()

  return withAuthenticatedDb({ userId, workspaceId }, async (tx) => {
    const row = await one<Record<string, any>>(
      tx,
      `
      insert into public.campaigns (
        workspace_id, name, subject, preheader, from_email, from_name, reply_to,
        template_id, segment_id, html, document, status, created_by
      )
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'draft',$12)
      returning *
      `,
      [
        workspaceId,
        input.name,
        input.subject ?? '',
        input.preheader ?? null,
        input.fromEmail ?? null,
        input.fromName ?? null,
        input.replyTo ?? null,
        input.templateId ?? null,
        input.segmentId ?? null,
        input.html ?? '',
        JSON.stringify(input.document ?? { blocks: [] }),
        userId,
      ],
    )
    return mapCampaign(row!)
  })
}

export async function updateCampaign(
  id: string,
  patch: Partial<{
    name: string
    subject: string
    preheader: string | null
    fromEmail: string | null
    fromName: string | null
    replyTo: string | null
    templateId: string | null
    segmentId: string | null
    html: string
    document: EmailDocument
    scheduledAt: string | null
    status: CampaignStatus
  }>,
): Promise<Campaign> {
  const { userId, workspaceId } = await requireWorkspaceMember()

  return withAuthenticatedDb({ userId, workspaceId }, async (tx) => {
    const current = await one<Record<string, any>>(
      tx,
      'select * from public.campaigns where id = $1',
      [id],
    )
    if (!current) throw new NotFoundError('Campaign not found')

    if (current.status === 'sent' && patch.status !== undefined) {
      throw new ValidationError('A sent campaign cannot change status')
    }

    const row = await one<Record<string, any>>(
      tx,
      `
      update public.campaigns set
        name = coalesce($2, name),
        subject = coalesce($3, subject),
        preheader = coalesce($4, preheader),
        from_email = coalesce($5, from_email),
        from_name = coalesce($6, from_name),
        reply_to = coalesce($7, reply_to),
        template_id = coalesce($8, template_id),
        segment_id = coalesce($9, segment_id),
        html = coalesce($10, html),
        document = coalesce($11, document),
        scheduled_at = coalesce($12, scheduled_at),
        status = coalesce($13, status),
        updated_at = now()
      where id = $1
      returning *
      `,
      [
        id,
        patch.name ?? null,
        patch.subject ?? null,
        patch.preheader ?? null,
        patch.fromEmail ?? null,
        patch.fromName ?? null,
        patch.replyTo ?? null,
        patch.templateId ?? null,
        patch.segmentId ?? null,
        patch.html ?? null,
        patch.document ? JSON.stringify(patch.document) : null,
        patch.scheduledAt ?? null,
        patch.status ?? null,
      ],
    )
    return mapCampaign(row!)
  })
}

export async function deleteCampaign(id: string): Promise<void> {
  const { userId, workspaceId } = await requireWorkspaceMember()
  await withAuthenticatedDb({ userId, workspaceId }, (tx) =>
    tx.query('delete from public.campaigns where id = $1', [id]),
  )
}

/** Resolves the audience without sending anything — used by the review step. */
export async function previewAudience(
  segmentId: string | null,
): Promise<{ total: number; sample: { email: string; firstName: string | null }[] }> {
  const { userId, workspaceId } = await requireWorkspaceMember()

  return withAuthenticatedDb({ userId, workspaceId }, async (tx) => {
    let ids: string[]

    if (segmentId) {
      ids = await resolveSegmentContactIds(tx, workspaceId, segmentId)
    } else {
      const rows = await many<{ id: string }>(
        tx,
        `select id from public.contacts where status = 'subscribed'`,
      )
      ids = rows.map((row) => row.id)
    }

    const sample = await many<{ email: string; first_name: string | null }>(
      tx,
      `select email, first_name from public.contacts
       where id = any($1::uuid[]) and status = 'subscribed'
       order by created_at desc limit 5`,
      [ids],
    )

    return {
      total: ids.length,
      sample: sample.map((row) => ({ email: row.email, firstName: row.first_name })),
    }
  })
}

export async function scheduleCampaign(id: string, at: Date): Promise<Campaign> {
  const campaign = await updateCampaign(id, {
    scheduledAt: at.toISOString(),
    status: 'scheduled',
  })
  await queueEventWebhooks(
    (await requireWorkspaceMember()).workspaceId,
    'campaign.scheduled',
    { campaignId: id, scheduledAt: at.toISOString() },
  )
  return campaign
}

export async function cancelCampaign(id: string): Promise<Campaign> {
  return updateCampaign(id, { status: 'cancelled' })
}

/**
 * Freezes the audience into `campaign_recipients` + queued messages, then hands
 * the actual delivery to the job runner. Freezing matters: a campaign must send
 * to exactly the people who were in the segment when it was launched, even if
 * the segment changes mid-flight.
 */
export async function launchCampaign(id: string): Promise<{
  campaign: Campaign
  recipients: number
}> {
  const { userId, workspaceId } = await requireWorkspaceMember()

  // The sender identity must be resolved before the message rows are written:
  // `from_email` is NOT NULL on the ledger.
  const sender = await resolveSender(workspaceId, {
    fromEmail: null,
    fromName: null,
    replyTo: null,
  })

  const { campaign, contactIds } = await withAuthenticatedDb(
    { userId, workspaceId },
    async (tx) => {
      const row = await one<Record<string, any>>(
        tx,
        'select * from public.campaigns where id = $1',
        [id],
      )
      if (!row) throw new NotFoundError('Campaign not found')
      if (row.status === 'sending' || row.status === 'sent') {
        throw new ValidationError('This campaign has already been sent')
      }
      if (!row.subject?.trim()) {
        throw new ValidationError('Add a subject line before sending')
      }
      if (!row.html?.trim() && !(row.document?.blocks?.length > 0)) {
        throw new ValidationError('Add some content before sending')
      }

      let ids: string[]
      if (row.segment_id) {
        ids = await resolveSegmentContactIds(tx, workspaceId, row.segment_id)
      } else {
        const all = await many<{ id: string }>(
          tx,
          `select id from public.contacts where status = 'subscribed'`,
        )
        ids = all.map((contactRow) => contactRow.id)
      }

      const contacts = await many<ContactRow>(
        tx,
        `select * from public.contacts
         where id = any($1::uuid[]) and status = 'subscribed'
         order by created_at asc
         limit ${MAX_RECIPIENTS}`,
        [ids],
      )

      if (contacts.length === 0) {
        throw new ValidationError('No subscribed contacts match this campaign')
      }

      for (const contact of contacts) {
        const message = await one<{ id: string }>(
          tx,
          `
          insert into public.email_messages (
            workspace_id, contact_id, campaign_id, template_id, kind,
            to_email, to_name, from_email, from_name, reply_to, subject, status
          )
          values ($1,$2,$3,$4,'campaign',$5,$6,$7,$8,$9,$10,'queued')
          returning id
          `,
          [
            workspaceId,
            contact.id,
            id,
            row.template_id,
            contact.email,
            [contact.first_name, contact.last_name].filter(Boolean).join(' ') || null,
            row.from_email ?? sender.fromEmail,
            row.from_name ?? sender.fromName,
            row.reply_to ?? sender.replyTo,
            row.subject,
          ],
        )

        await tx.query(
          `
          insert into public.campaign_recipients (
            workspace_id, campaign_id, contact_id, message_id, status
          )
          values ($1,$2,$3,$4,'queued')
          on conflict (campaign_id, contact_id) do update set message_id = excluded.message_id
          `,
          [workspaceId, id, contact.id, message!.id],
        )
      }

      const updated = await one<Record<string, any>>(
        tx,
        `
        update public.campaigns set
          status = 'sending', started_at = now(), recipients_count = $2, updated_at = now()
        where id = $1
        returning *
        `,
        [id, contacts.length],
      )

      return { campaign: mapCampaign(updated!), contactIds: contacts.map((c) => c.id) }
    },
  )

  const { enqueueJob } = await import('@/lib/jobs/queue')
  await enqueueJob({ workspaceId, kind: 'campaign_send', payload: { campaignId: id } })

  return { campaign, recipients: contactIds.length }
}

/**
 * Job handler. Runs outside any long transaction: each message is delivered
 * through the shared pipeline, which owns its own short transactions.
 */
export async function processCampaignSend(input: {
  campaignId: string
}): Promise<void> {
  const campaignRow = await withAdminDb(async (tx) =>
    one<Record<string, any>>(
      tx,
      `
      select c.*, w.name as workspace_name
      from public.campaigns c
      join public.workspaces w on w.id = c.workspace_id
      where c.id = $1
      `,
      [input.campaignId],
    ),
  )
  if (!campaignRow) return

  const workspaceId = campaignRow.workspace_id as string
  const sender = await resolveSender(workspaceId, {
    fromEmail: campaignRow.from_email,
    fromName: campaignRow.from_name,
    replyTo: campaignRow.reply_to,
  })

  let offset = 0
  const chunkSize = 100

  for (;;) {
    const batch = await withAdminDb(async (tx) =>
      many<ContactRow & { message_id: string }>(
        tx,
        `
        select c.*, cr.message_id
        from public.campaign_recipients cr
        join public.contacts c on c.id = cr.contact_id
        join public.email_messages m on m.id = cr.message_id
        where cr.campaign_id = $1
          and cr.status = 'queued'
          and m.status = 'queued'
        order by c.created_at asc
        limit $2 offset $3
        `,
        [input.campaignId, chunkSize, offset],
      ),
    )

    if (batch.length === 0) break

    // Respect a pause requested mid-send.
    const status = await withAdminDb(async (tx) =>
      one<{ status: string }>(
        tx,
        'select status from public.campaigns where id = $1',
        [input.campaignId],
      ),
    )
    if (status?.status === 'paused' || status?.status === 'cancelled') return

    await withJobBatch(async () => {
      for (let i = 0; i < batch.length; i += DELIVERY_CONCURRENCY) {
        const slice = batch.slice(i, i + DELIVERY_CONCURRENCY)
        await Promise.all(
          slice.map(async (contact) => {
            const result = await deliverToContact({
              workspaceId,
              contact,
              subject: campaignRow.subject,
              document: campaignRow.document,
              html: campaignRow.html || undefined,
              preheader: campaignRow.preheader,
              fromEmail: sender.fromEmail,
              fromName: sender.fromName,
              replyTo: sender.replyTo,
              campaignId: input.campaignId,
              templateId: campaignRow.template_id,
              kind: 'campaign',
              messageId: contact.message_id,
            })

            await withAdminDb(async (tx) => {
              await tx.query(
                `update public.campaign_recipients set status = $2
                 where campaign_id = $1 and contact_id = $3`,
                [input.campaignId, result.status === 'failed' ? 'failed' : 'sent', contact.id],
              )
            })
          }),
        )
      }
    })

    offset += batch.length
  }

  await withAdminDb(async (tx) => {
    await tx.query(
      `update public.campaigns set
         status = 'sent', sent_at = coalesce(sent_at, now()), completed_at = now(), updated_at = now()
       where id = $1`,
      [input.campaignId],
    )
  })

  await queueEventWebhooks(workspaceId, 'campaign.sent', {
    campaignId: input.campaignId,
  })
  await queueEventWebhooks(workspaceId, 'campaign.completed', {
    campaignId: input.campaignId,
  })
}

export async function campaignStats(
  campaignId: string,
): Promise<CampaignStats> {
  const { userId, workspaceId } = await requireWorkspaceMember()
  return withAuthenticatedDb({ userId, workspaceId }, (tx) =>
    campaignStatsInTx(tx, workspaceId, campaignId),
  )
}

export async function campaignStatsInTx(
  tx: Tx,
  workspaceId: string,
  campaignId: string,
): Promise<CampaignStats> {
  const row = await one<Record<string, any>>(
    tx,
    `
    select
      c.id, c.name, c.status, c.sent_at,
      (select count(*)::int from public.campaign_recipients cr where cr.campaign_id = c.id) as recipients,
      (select count(*)::int from public.email_messages m where m.campaign_id = c.id and m.status not in ('queued','failed')) as delivered,
      (select count(*)::int from public.contact_events e where e.campaign_id = c.id and e.event_type = 'opened') as opens,
      (select count(distinct e.contact_id)::int from public.contact_events e where e.campaign_id = c.id and e.event_type = 'opened') as unique_opens,
      (select count(*)::int from public.contact_events e where e.campaign_id = c.id and e.event_type = 'clicked') as clicks,
      (select count(distinct e.contact_id)::int from public.contact_events e where e.campaign_id = c.id and e.event_type = 'clicked') as unique_clicks,
      (select count(*)::int from public.email_messages m where m.campaign_id = c.id and m.status = 'bounced') as bounces,
      (select count(*)::int from public.email_messages m where m.campaign_id = c.id and m.status = 'unsubscribed') as unsubscribes
    from public.campaigns c
    where c.id = $1 and c.workspace_id = $2
    `,
    [campaignId, workspaceId],
  )

  if (!row) throw new NotFoundError('Campaign not found')
  return mapCampaignStats(row)
}

export async function recentCampaignStats(
  limit = 6,
): Promise<CampaignStats[]> {
  const { userId, workspaceId } = await requireWorkspaceMember()
  return withAuthenticatedDb({ userId, workspaceId }, async (tx) => {
    const campaigns = await many<{ id: string }>(
      tx,
      `select id from public.campaigns where workspace_id = $1 order by created_at desc limit $2`,
      [workspaceId, limit],
    )
    const stats: CampaignStats[] = []
    for (const campaign of campaigns) {
      stats.push(await campaignStatsInTx(tx, workspaceId, campaign.id))
    }
    return stats
  })
}

export async function duplicateCampaign(id: string): Promise<Campaign> {
  const source = await getCampaign(id)
  return createCampaign({
    name: `${source.name} (copy)`,
    subject: source.subject,
    preheader: source.preheader,
    fromEmail: source.fromEmail,
    fromName: source.fromName,
    replyTo: source.replyTo,
    templateId: source.templateId,
    segmentId: source.segmentId,
    html: source.html,
    document: source.document,
  })
}