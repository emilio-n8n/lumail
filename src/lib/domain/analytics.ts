import { many, one, withAuthenticatedDb } from '@/integrations/database/client'
import { requireWorkspaceMember } from '@/integrations/database/auth-runtime'
import { mapActivity, mapCampaignStats } from './mappers'
import type { ActivityItem, CampaignStats, OverviewStats, TimeseriesPoint } from './types'

/**
 * Analytics. Every number here is derived from `contact_events` and
 * `email_messages`, so the funnel shown in the dashboard is the same funnel the
 * MCP `get_campaign_analytics` tool returns and the same one the API serves.
 */

import { RANGE_OPTIONS, type RangeKey } from './ranges'

export { RANGE_OPTIONS, type RangeKey }

/** `date_trunc` units for the time series buckets. */
function truncateUnit(range: RangeKey): 'hour' | 'day' | 'week' {
  switch (range) {
    case '24h':
      return 'hour'
    case '7d':
    case '30d':
      return 'day'
    default:
      return 'week'
  }
}

export async function overviewStats(range: RangeKey = '30d'): Promise<OverviewStats> {
  const { userId, workspaceId } = await requireWorkspaceMember()

  return withAuthenticatedDb({ userId, workspaceId }, async (tx) => {
    const interval = `now() - interval '${daysFor(range)} days'`

    const emailRow = await one<Record<string, number>>(tx, `
      select
        count(*) filter (where status not in ('queued'))::int as sent,
        count(*) filter (where delivered_at is not null)::int as delivered,
        count(*) filter (where first_opened_at is not null)::int as opened,
        count(*) filter (where first_clicked_at is not null)::int as clicked,
        count(*) filter (where status = 'bounced')::int as bounced,
        count(*) filter (where status = 'complained')::int as complained,
        count(*) filter (where status = 'unsubscribed')::int as unsubscribed
      from public.email_messages
      where workspace_id = $1 and created_at >= ${interval}
    `, [workspaceId])

    const contactRow = await one<Record<string, number>>(tx, `
      select
        count(*)::int as total,
        count(*) filter (where status = 'subscribed')::int as subscribed
      from public.contacts where workspace_id = $1
    `, [workspaceId])

    const objectRow = await one<Record<string, number>>(tx, `
      select
        (select count(*)::int from public.campaigns where workspace_id = $1 and status in ('scheduled','sending')) as active_campaigns,
        (select count(*)::int from public.workflows where workspace_id = $1 and status = 'active') as active_workflows
    `, [workspaceId])

    const sent = Number(emailRow?.sent ?? 0)
    const delivered = Number(emailRow?.delivered ?? 0)
    const opened = Number(emailRow?.opened ?? 0)
    const clicked = Number(emailRow?.clicked ?? 0)
    const bounced = Number(emailRow?.bounced ?? 0)
    const complained = Number(emailRow?.complained ?? 0)
    const unsubscribed = Number(emailRow?.unsubscribed ?? 0)

    const rate = (value: number, base: number) =>
      base > 0 ? Math.round((value / base) * 1000) / 1000 : 0

    return {
      emailsSent: sent,
      emailsDelivered: delivered,
      deliveredRate: rate(delivered, sent),
      openRate: rate(opened, delivered),
      clickRate: rate(clicked, delivered),
      clickToOpenRate: rate(clicked, opened),
      bounceRate: rate(bounced, sent),
      unsubscribeRate: rate(unsubscribed, sent),
      complaintRate: rate(complained, sent),
      totalContacts: Number(contactRow?.total ?? 0),
      subscribedContacts: Number(contactRow?.subscribed ?? 0),
      activeCampaigns: Number(objectRow?.active_campaigns ?? 0),
      activeWorkflows: Number(objectRow?.active_workflows ?? 0),
    }
  })
}

function daysFor(range: RangeKey): number {
  return RANGE_OPTIONS.find((option) => option.value === range)?.days ?? 30
}

export async function timeseries(range: RangeKey = '30d'): Promise<TimeseriesPoint[]> {
  const { userId, workspaceId } = await requireWorkspaceMember()

  return withAuthenticatedDb({ userId, workspaceId }, async (tx) => {
    const rows = await many<Record<string, any>>(
      tx,
      `
      select
        to_char(date_trunc('${truncateUnit(range)}', m.created_at), 'YYYY-MM-DD') as date,
        count(*)::int as sent,
        count(*) filter (where m.delivered_at is not null)::int as delivered,
        count(*) filter (where m.first_opened_at is not null)::int as opened,
        count(*) filter (where m.first_clicked_at is not null)::int as clicked,
        count(*) filter (where m.status = 'bounced')::int as bounced,
        count(*) filter (where m.status = 'unsubscribed')::int as unsubscribed
      from public.email_messages m
      where m.workspace_id = $1
        and m.created_at >= now() - interval '${daysFor(range)} days'
      group by 1
      order by 1 asc
      `,
      [workspaceId],
    )

    return rows.map((row) => ({
      date: String(row.date),
      sent: Number(row.sent),
      delivered: Number(row.delivered),
      opened: Number(row.opened),
      clicked: Number(row.clicked),
      bounced: Number(row.bounced),
      unsubscribed: Number(row.unsubscribed),
    }))
  })
}

export async function topCampaigns(limit = 6): Promise<CampaignStats[]> {
  const { userId, workspaceId } = await requireWorkspaceMember()

  return withAuthenticatedDb({ userId, workspaceId }, async (tx) => {
    const rows = await many<Record<string, any>>(
      tx,
      `
      select
        c.id, c.name, c.status, c.sent_at,
        (select count(*)::int from public.campaign_recipients cr where cr.campaign_id = c.id) as recipients,
        (select count(*)::int from public.email_messages m where m.campaign_id = c.id and m.delivered_at is not null) as delivered,
        (select count(*)::int from public.contact_events e where e.campaign_id = c.id and e.event_type = 'opened') as opens,
        (select count(distinct e.contact_id)::int from public.contact_events e where e.campaign_id = c.id and e.event_type = 'opened') as unique_opens,
        (select count(*)::int from public.contact_events e where e.campaign_id = c.id and e.event_type = 'clicked') as clicks,
        (select count(distinct e.contact_id)::int from public.contact_events e where e.campaign_id = c.id and e.event_type = 'clicked') as unique_clicks,
        (select count(*)::int from public.email_messages m where m.campaign_id = c.id and m.status = 'bounced') as bounces,
        (select count(*)::int from public.email_messages m where m.campaign_id = c.id and m.status = 'unsubscribed') as unsubscribes
      from public.campaigns c
      where c.workspace_id = $1
      order by c.created_at desc
      limit $2
      `,
      [workspaceId, limit],
    )
    return rows.map(mapCampaignStats)
  })
}

export async function recentActivity(
  limit = 12,
  contactId?: string | null,
): Promise<ActivityItem[]> {
  const { userId, workspaceId } = await requireWorkspaceMember()

  return withAuthenticatedDb({ userId, workspaceId }, async (tx) => {
    const params: unknown[] = [workspaceId]
    let filter = ''
    if (contactId) {
      params.push(contactId)
      filter = ` and e.contact_id = $${params.length}`
    }
    params.push(Math.min(limit, 100))

    const rows = await many<Record<string, any>>(
      tx,
      `
      select e.*, c.email as contact_email, camp.name as campaign_name
      from public.contact_events e
      left join public.contacts c on c.id = e.contact_id
      left join public.campaigns camp on camp.id = e.campaign_id
      where e.workspace_id = $1 ${filter}
      order by e.occurred_at desc
      limit $${params.length}
      `,
      params,
    )
    return rows.map(mapActivity)
  })
}

export type LinkPerformance = {
  url: string
  clicks: number
  uniqueContacts: number
}

export async function linkPerformance(limit = 10): Promise<LinkPerformance[]> {
  const { userId, workspaceId } = await requireWorkspaceMember()

  return withAuthenticatedDb({ userId, workspaceId }, async (tx) =>
    many<LinkPerformance>(
      tx,
      `
      select
        e.url,
        count(*)::int as clicks,
        count(distinct e.contact_id)::int as "uniqueContacts"
      from public.contact_events e
      where e.workspace_id = $1 and e.event_type = 'clicked' and e.url is not null
      group by e.url
      order by clicks desc
      limit $2
      `,
      [workspaceId, limit],
    ),
  )
}

export type WorkflowPerformance = {
  id: string
  name: string
  status: string
  runsCount: number
  completed: number
  failed: number
  enrolled: number
  emails: number
  opens: number
}

export async function workflowPerformance(): Promise<WorkflowPerformance[]> {
  const { userId, workspaceId } = await requireWorkspaceMember()

  return withAuthenticatedDb({ userId, workspaceId }, async (tx) =>
    many<WorkflowPerformance>(
      tx,
      `
      select
        w.id,
        w.name,
        w.status,
        w.runs_count as "runsCount",
        (select count(*)::int from public.workflow_runs r where r.workflow_id = w.id and r.status = 'completed') as completed,
        (select count(*)::int from public.workflow_runs r where r.workflow_id = w.id and r.status = 'failed') as failed,
        (select count(*)::int from public.workflow_enrollments e where e.workflow_id = w.id and e.completed_at is null) as enrolled,
        (select count(*)::int from public.email_messages m where m.workflow_id = w.id) as emails,
        (select count(*)::int from public.email_messages m where m.workflow_id = w.id and m.first_opened_at is not null) as opens
      from public.workflows w
      where w.workspace_id = $1
      order by w.updated_at desc
      limit 6
      `,
      [workspaceId],
    ),
  )
}

export type FunnelStage = { stage: string; value: number }

export async function funnelBreakdown(range: RangeKey = '30d'): Promise<FunnelStage[]> {
  const { userId, workspaceId } = await requireWorkspaceMember()

  return withAuthenticatedDb({ userId, workspaceId }, async (tx) => {
    const interval = `now() - interval '${daysFor(range)} days'`
    const rows = await many<{ event_type: string; count: number }>(
      tx,
      `
      select event_type::text, count(*)::int as count
      from public.contact_events
      where workspace_id = $1 and occurred_at >= ${interval}
        and event_type in ('sent','delivered','opened','clicked','bounced','complained','unsubscribed')
      group by event_type
      `,
      [workspaceId],
    )

    const counts = Object.fromEntries(rows.map((row) => [row.event_type, Number(row.count)]))
    return [
      { stage: 'Sent', value: counts.sent ?? 0 },
      { stage: 'Delivered', value: counts.delivered ?? 0 },
      { stage: 'Opened', value: counts.opened ?? 0 },
      { stage: 'Clicked', value: counts.clicked ?? 0 },
    ]
  })
}

export type GrowthPoint = { date: string; count: number }

export async function contactGrowth(range: RangeKey = '30d'): Promise<GrowthPoint[]> {
  const { userId, workspaceId } = await requireWorkspaceMember()

  return withAuthenticatedDb({ userId, workspaceId }, async (tx) => {
    const rows = await many<{ date: string; count: number }>(
      tx,
      `
      select to_char(date_trunc('${truncateUnit(range)}', created_at), 'YYYY-MM-DD') as date,
             count(*)::int as count
      from public.contacts
      where workspace_id = $1 and created_at >= now() - interval '${daysFor(range)} days'
      group by 1 order by 1 asc
      `,
      [workspaceId],
    )
    return rows.map((row) => ({ date: row.date, count: Number(row.count) }))
  })
}