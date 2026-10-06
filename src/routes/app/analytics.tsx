import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { Ban, Mail, MousePointerClick, Send, Sparkles, Users } from 'lucide-react'
import { PageHeader } from '@/components/app/shell'
import { StatGrid, StatTile } from '@/components/app/stat-tile'
import { AreaChart, BarChart, Funnel, ProgressBar } from '@/components/app/charts'
import { Card, CardHeader } from '@/components/ui/badge'
import { SegmentedControl, EmptyState } from '@/components/ui/tabs'
import { DataTable, type Column } from '@/components/app/data-table'
import { analyticsServerFns } from '@/rpc/workflows'
import { useServerQuery } from '@/lib/use-server-query'
import {
  formatCompact,
  formatNumber,
  formatPercent,
  formatRelative,
} from '@/lib/utils'
import { RANGE_OPTIONS, type RangeKey } from '@/lib/domain/ranges'
import type { CampaignStats } from '@/lib/domain/types'

export const Route = createFileRoute('/app/analytics')({
  component: AnalyticsPage,
})

function AnalyticsPage() {
  const [range, setRange] = useState<RangeKey>('30d')

  const { data } = useServerQuery(analyticsServerFns.overview, { range })
  const stats = data?.stats

  const campaignColumns: Column<CampaignStats>[] = [
    {
      key: 'name',
      header: 'Campaign',
      width: '2fr',
      cell: (row) => (
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium">{row.name}</div>
          <div className="truncate font-mono text-[10px] text-muted-foreground">
            {row.sentAt ? formatRelative(row.sentAt) : 'not sent'}
          </div>
        </div>
      ),
    },
    {
      key: 'recipients',
      header: 'Sent',
      width: '0.7fr',
      align: 'right',
      cell: (row) => (
        <span data-numeric className="font-mono text-[11px]">
          {formatNumber(row.recipients)}
        </span>
      ),
    },
    {
      key: 'openRate',
      header: 'Open',
      width: '0.7fr',
      align: 'right',
      cell: (row) => (
        <span data-numeric className="font-mono text-[11px]">
          {formatPercent(row.openRate)}
        </span>
      ),
    },
    {
      key: 'clickRate',
      header: 'Click',
      width: '0.7fr',
      align: 'right',
      cell: (row) => (
        <span data-numeric className="font-mono text-[11px]">
          {formatPercent(row.clickRate)}
        </span>
      ),
    },
    {
      key: 'cto',
      header: 'CTO',
      width: '0.7fr',
      align: 'right',
      cell: (row) => (
        <span data-numeric className="font-mono text-[11px] text-muted-foreground">
          {formatPercent(row.clickToOpenRate)}
        </span>
      ),
    },
    {
      key: 'bounceRate',
      header: 'Bounce',
      width: '0.7fr',
      align: 'right',
      cell: (row) => (
        <span
          data-numeric
          className={`font-mono text-[11px] ${
            row.bounceRate > 0.05 ? 'text-destructive' : 'text-muted-foreground'
          }`}
        >
          {formatPercent(row.bounceRate)}
        </span>
      ),
    },
    {
      key: 'unsub',
      header: 'Unsub',
      width: '0.7fr',
      align: 'right',
      cell: (row) => (
        <span data-numeric className="font-mono text-[11px] text-muted-foreground">
          {formatNumber(row.unsubscribes)}
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Analytics"
        description="Everything is derived from the event stream — the same numbers the API and the MCP tools return."
        actions={
          <SegmentedControl
            options={RANGE_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            value={range}
            onChange={setRange}
          />
        }
      />

      {stats ? (
        <StatGrid>
          <StatTile
            label="Sent"
            value={formatNumber(stats.emailsSent)}
            hint={`${formatNumber(stats.emailsDelivered)} delivered`}
            icon={<Send />}
          />
          <StatTile
            label="Delivery rate"
            value={formatPercent(stats.deliveredRate)}
            icon={<Mail />}
            tone="success"
          >
            <ProgressBar value={stats.deliveredRate} tone="success" />
          </StatTile>
          <StatTile
            label="Open rate"
            value={formatPercent(stats.openRate)}
            icon={<Sparkles />}
            tone="primary"
          >
            <ProgressBar value={stats.openRate} />
          </StatTile>
          <StatTile
            label="Click rate"
            value={formatPercent(stats.clickRate)}
            icon={<MousePointerClick />}
            tone="info"
          >
            <ProgressBar value={stats.clickRate} tone="info" />
          </StatTile>
          <StatTile
            label="Bounce rate"
            value={formatPercent(stats.bounceRate)}
            hint={`${formatNumber(stats.totalContacts)} contacts`}
            icon={<Ban />}
            tone={stats.bounceRate > 0.05 ? 'destructive' : 'default'}
          >
            <ProgressBar value={stats.bounceRate} tone="destructive" />
          </StatTile>
          <StatTile
            label="Unsubscribed"
            value={formatPercent(stats.unsubscribeRate)}
            hint={`${formatPercent(stats.complaintRate)} complaints`}
            icon={<Users />}
            tone="warning"
          >
            <ProgressBar value={stats.unsubscribeRate} tone="warning" />
          </StatTile>
        </StatGrid>
      ) : null}

      <Card>
        <CardHeader
          title="Volume over time"
          description="Sent, delivered, opened and clicked per interval."
        />
        <div className="p-4">
          <AreaChart
            data={data?.series ?? []}
            series={[
              { key: 'sent', label: 'Sent' },
              { key: 'delivered', label: 'Delivered' },
              { key: 'opened', label: 'Opened' },
              { key: 'clicked', label: 'Clicked' },
              { key: 'bounced', label: 'Bounced', color: 'var(--color-chart-4)' },
              { key: 'unsubscribed', label: 'Unsubscribed', color: 'var(--color-chart-3)' },
            ]}
            height={220}
          />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Engagement funnel" />
          <div className="p-4">
            <Funnel stages={data?.funnel ?? []} />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Contact growth"
            description="New contacts added per interval."
          />
          <div className="p-4">
            <BarChart
              data={data?.growth ?? []}
              valueKey="count"
              labelKey="date"
              height={150}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Top links" description="By click volume." />
          {data?.links?.length ? (
            <div className="divide-y divide-border">
              {data.links.map((link) => (
                <div key={link.url} className="px-4 py-2.5">
                  <p className="truncate font-mono text-[11px]">{link.url}</p>
                  <div className="mt-1 flex items-center gap-3 font-mono text-[10px] text-muted-foreground">
                    <span>{formatNumber(link.clicks)} clicks</span>
                    <span>{formatNumber(link.uniqueContacts)} contacts</span>
                    <span className="ml-auto">
                      {formatCompact(link.clicks)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact title="No clicks recorded yet" />
          )}
        </Card>
      </div>

      <DataTable
        columns={campaignColumns}
        rows={data?.campaigns ?? []}
        rowKey={(row) => row.campaignId}
        emptyTitle="No campaigns to analyse"
        emptyDescription="Send a campaign and its funnel appears here."
      />

      <Card>
        <CardHeader
          title="Automation throughput"
          description="Emails and opens produced by each journey."
        />
        {data?.workflows?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-[13px]">
              <thead>
                <tr className="border-b border-border bg-subtle text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                  <th className="px-4 py-1.5 text-left font-medium">Automation</th>
                  <th className="px-4 py-1.5 text-right font-medium">Emails</th>
                  <th className="px-4 py-1.5 text-right font-medium">Opens</th>
                  <th className="px-4 py-1.5 text-right font-medium">Enrolled</th>
                  <th className="px-4 py-1.5 text-right font-medium">Open rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.workflows.map((workflow) => (
                  <tr key={workflow.id}>
                    <td className="px-4 py-2">
                      <span className="font-medium">{workflow.name}</span>
                      <span className="ml-2 text-[11px] text-muted-foreground">
                        {workflow.status}
                      </span>
                    </td>
                    <td data-numeric className="px-4 py-2 text-right font-mono text-[11px]">
                      {formatNumber(workflow.emails)}
                    </td>
                    <td data-numeric className="px-4 py-2 text-right font-mono text-[11px]">
                      {formatNumber(workflow.opens)}
                    </td>
                    <td data-numeric className="px-4 py-2 text-right font-mono text-[11px]">
                      {formatNumber(workflow.enrolled)}
                    </td>
                    <td
                      data-numeric
                      className="px-4 py-2 text-right font-mono text-[11px]"
                    >
                      {formatPercent(
                        workflow.emails > 0 ? workflow.opens / workflow.emails : 0,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            compact
            title="No automations yet"
            description="Journey throughput appears here once an automation is active."
          />
        )}
      </Card>
    </div>
  )
}
