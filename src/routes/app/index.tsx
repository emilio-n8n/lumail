import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import {
  Activity,
  ArrowUpRight,
  Ban,
  MousePointerClick,
  Send,
  Sparkles,
  Users,
} from 'lucide-react'
import { PageHeader } from '@/components/app/shell'
import { StatGrid, StatTile } from '@/components/app/stat-tile'
import { AreaChart, Funnel, ProgressBar } from '@/components/app/charts'
import { Card, CardHeader, Badge } from '@/components/ui/badge'
import { SegmentedControl, EmptyState } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { analyticsServerFns } from '@/server/workflows'
import { useServerQuery } from '@/lib/use-server-query'
import { cn, formatCompact, formatNumber, formatPercent, formatRelative } from '@/lib/utils'
import { RANGE_OPTIONS, type RangeKey } from '@/lib/domain/ranges'
import { ActivityTimeline } from '@/components/app/activity'
import { Skeleton } from '@/components/ui/spinner'

export const Route = createFileRoute('/app/')({
  component: OverviewPage,
})

function OverviewPage() {
  const [range, setRange] = useState<RangeKey>('30d')
  const { data, isPending, refetch } = useServerQuery(analyticsServerFns.overview, {
    range,
  })
  const { toast } = useToast()
  const router = useRouter()

  const stats = data?.stats

  return (
    <div className="space-y-5">
      <PageHeader
        title="Overview"
        description="How this workspace is performing right now."
        actions={
          <>
            <SegmentedControl
              options={RANGE_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              value={range}
              onChange={(value) => setRange(value)}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await refetch()
                toast({ title: 'Refreshed', tone: 'default' })
              }}
            >
              Refresh
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => router.navigate({ to: '/app/campaigns' })}
            >
              <Send />
              New campaign
            </Button>
          </>
        }
      />

      {isPending || !stats ? (
        <StatGrid>
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-[86px]" />
          ))}
        </StatGrid>
      ) : (
        <StatGrid>
          <StatTile
            label="Emails sent"
            value={formatNumber(stats.emailsSent)}
            hint={`${formatNumber(stats.emailsDelivered)} delivered`}
            icon={<Send />}
          />
          <StatTile
            label="Open rate"
            value={formatPercent(stats.openRate)}
            hint={`${formatCompact(stats.emailsDelivered)} delivered`}
            tone="primary"
            icon={<Sparkles />}
          >
            <ProgressBar value={stats.openRate} />
          </StatTile>
          <StatTile
            label="Click rate"
            value={formatPercent(stats.clickRate)}
            hint={`click-to-open ${formatPercent(stats.clickToOpenRate)}`}
            tone="info"
            icon={<MousePointerClick />}
          >
            <ProgressBar value={stats.clickRate} tone="info" />
          </StatTile>
          <StatTile
            label="Bounces"
            value={formatPercent(stats.bounceRate)}
            hint={`unsubscribes ${formatPercent(stats.unsubscribeRate)}`}
            tone={stats.bounceRate > 0.05 ? 'destructive' : 'default'}
            icon={<Ban />}
          >
            <ProgressBar value={stats.bounceRate} tone="destructive" />
          </StatTile>
          <StatTile
            label="Contacts"
            value={formatNumber(stats.totalContacts)}
            hint={`${formatNumber(stats.subscribedContacts)} subscribed`}
            icon={<Users />}
          />
          <StatTile
            label="Live"
            value={`${stats.activeCampaigns} / ${stats.activeWorkflows}`}
            hint="campaigns / automations"
            icon={<Activity />}
          />
        </StatGrid>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Delivery volume"
            description={`Sent, delivered, opened and clicked over ${RANGE_OPTIONS.find((option) => option.value === range)?.label}.`}
            action={
              <Link
                to="/app/analytics"
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                Analytics <ArrowUpRight className="size-3" />
              </Link>
            }
          />
          <div className="p-4">
            <AreaChart
              data={data?.series ?? []}
              series={[
                { key: 'sent', label: 'Sent' },
                { key: 'delivered', label: 'Delivered' },
                { key: 'opened', label: 'Opened' },
                { key: 'clicked', label: 'Clicked' },
              ]}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Funnel" description="Unique contacts at each stage." />
          <div className="p-4">
            <Funnel stages={data?.funnel ?? []} />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Recent campaigns"
            description="Performance of the latest sends."
          />
          {data?.campaigns?.length ? (
            <div className="divide-y divide-border">
              {data.campaigns.map((campaign) => (
                <Link
                  key={campaign.campaignId}
                  to="/app/campaigns/$campaignId"
                  params={{ campaignId: campaign.campaignId }}
                  className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/60"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium">
                        {campaign.name}
                      </span>
                      <Badge
                        tone={
                          campaign.status === 'sent'
                            ? 'success'
                            : campaign.status === 'scheduled'
                              ? 'info'
                              : 'neutral'
                        }
                      >
                        {campaign.status}
                      </Badge>
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                      {formatNumber(campaign.recipients)} recipients ·{' '}
                      {campaign.sentAt
                        ? formatRelative(campaign.sentAt)
                        : 'not sent'}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-4 text-right">
                    <Metric label="Open" value={formatPercent(campaign.openRate)} />
                    <Metric
                      label="Click"
                      value={formatPercent(campaign.clickRate)}
                    />
                    <Metric
                      label="Bounce"
                      value={formatPercent(campaign.bounceRate)}
                      tone={
                        campaign.bounceRate > 0.05 ? 'destructive' : undefined
                      }
                    />
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              compact
              title="No campaigns yet"
              description="Create your first campaign to start building a sending history."
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => router.navigate({ to: '/app/campaigns' })}
                >
                  Go to campaigns
                </Button>
              }
            />
          )}
        </Card>

        <Card>
          <CardHeader
            title="Automations"
            description="Active journeys and their throughput."
          />
          {data?.workflows?.length ? (
            <div className="divide-y divide-border">
              {data.workflows.map((workflow) => (
                <Link
                  key={workflow.id}
                  to="/app/automations/$workflowId"
                  params={{ workflowId: workflow.id }}
                  className="block px-4 py-2.5 transition-colors hover:bg-muted/60"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] font-medium">
                      {workflow.name}
                    </span>
                    <Badge
                      tone={
                        workflow.status === 'active' ? 'success' : 'neutral'
                      }
                    >
                      {workflow.status}
                    </Badge>
                  </div>
                  <div className="mt-1 flex items-center gap-3 font-mono text-[10px] text-muted-foreground">
                    <span>{formatNumber(workflow.emails)} emails</span>
                    <span>{formatNumber(workflow.opens)} opens</span>
                    <span>{formatNumber(workflow.enrolled)} enrolled</span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              compact
              title="No automations"
              description="Automate welcome series and lifecycle messages."
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => router.navigate({ to: '/app/automations' })}
                >
                  Build one
                </Button>
              }
            />
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Activity"
            description="The live event stream across the workspace."
          />
          <ActivityTimeline items={data?.activity ?? []} limit={10} />
        </Card>

        <Card>
          <CardHeader title="Top links" description="Most clicked destinations." />
          {data?.links?.length ? (
            <div className="divide-y divide-border">
              {data.links.map((link) => (
                <div key={link.url} className="px-4 py-2.5">
                  <p className="truncate font-mono text-[11px]">{link.url}</p>
                  <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-muted-foreground">
                    <span>{formatNumber(link.clicks)} clicks</span>
                    <span>{formatNumber(link.uniqueContacts)} contacts</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact title="No clicks yet" />
          )}
        </Card>
      </div>
    </div>
  )
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'destructive'
}) {
  return (
    <div className="w-16">
      <p className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </p>
      <p
        data-numeric
        className={cn(
          'text-[13px] font-medium',
          tone === 'destructive' ? 'text-destructive' : undefined,
        )}
      >
        {value}
      </p>
    </div>
  )
}
