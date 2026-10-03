import { useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  Ban,
  Calendar,
  Check,
  Clock,
  Mail,
  MousePointerClick,
  Send,
  Users,
} from 'lucide-react'
import { PageHeader } from '@/components/app/shell'
import { Badge, Card, CardHeader } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, ConfirmDialog } from '@/components/ui/dialog'
import { Field, Input, Select } from '@/components/ui/input'
import { Tabs } from '@/components/ui/tabs'
import { StatGrid, StatTile } from '@/components/app/stat-tile'
import { Funnel, ProgressBar } from '@/components/app/charts'
import { ActivityTimeline } from '@/components/app/activity'
import { EmailEditor } from '@/components/editor/email-editor'
import { ContactDrawer } from '@/components/app/contact-drawer'
import { useToast } from '@/components/ui/toast'
import { campaignServerFns } from '@/server/campaigns'
import { segmentServerFns, activityServerFns } from '@/server/contacts'
import {
  useServerQuery,
  useInvalidateServer,
} from '@/lib/use-server-query'
import {
  cn,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatRelative,
} from '@/lib/utils'
import { renderDocument } from '@/lib/email/render-document'
import type { EmailDocument } from '@/lib/domain/types'

export const Route = createFileRoute('/app/campaigns/$campaignId')({
  component: CampaignDetailPage,
})

type Stage = 'content' | 'recipients' | 'preview' | 'send' | 'analytics'

const STAGES: { value: Stage; label: string }[] = [
  { value: 'content', label: 'Content' },
  { value: 'recipients', label: 'Recipients' },
  { value: 'preview', label: 'Preview' },
  { value: 'send', label: 'Send' },
  { value: 'analytics', label: 'Analytics' },
]

function CampaignDetailPage() {
  const { campaignId } = Route.useParams()
  const [stage, setStage] = useState<Stage>('content')
  const [document, setDocument] = useState<EmailDocument>({ blocks: [] })
  const [subject, setSubject] = useState('')
  const [preheader, setPreheader] = useState('')
  const [name, setName] = useState('')
  const [segmentId, setSegmentId] = useState<string>('')
  const [fromEmail, setFromEmail] = useState('')
  const [fromName, setFromName] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [sendDialog, setSendDialog] = useState(false)
  const [scheduleDialog, setScheduleDialog] = useState(false)
  const [cancelDialog, setCancelDialog] = useState(false)
  const [openContactId, setOpenContactId] = useState<string | null>(null)
  const { toast } = useToast()
  const invalidate = useInvalidateServer()

  const { data: campaign, isPending } = useServerQuery(
    campaignServerFns.get,
    { id: campaignId },
  )
  const { data: segments } = useServerQuery(segmentServerFns.list, undefined as never)

  // Hydrate the editor once per campaign.
  useEffect(() => {
    if (!campaign || hydrated) return
    setName(campaign.name)
    setSubject(campaign.subject)
    setPreheader(campaign.preheader ?? '')
    setDocument(campaign.document ?? { blocks: [] })
    setSegmentId(campaign.segmentId ?? '')
    setFromEmail(campaign.fromEmail ?? '')
    setFromName(campaign.fromName ?? '')
    setHydrated(true)
  }, [campaign, hydrated])

  const { data: audience } = useServerQuery(
    campaignServerFns.previewAudience,
    { segmentId: segmentId || null },
    { enabled: stage === 'recipients' || stage === 'send' },
  )

  const stats = campaign?.stats
  const isSent = campaign?.status === 'sent' || campaign?.status === 'sending'

  const save = async () => {
    setSaving(true)
    try {
      await campaignServerFns.update({
        data: {
          id: campaignId,
          name,
          subject,
          preheader: preheader || null,
          segmentId: segmentId || null,
          fromEmail: fromEmail || null,
          fromName: fromName || null,
          document,
        },
      })
      setDirty(false)
      toast({ title: 'Campaign saved', tone: 'success' })
      await invalidate()
    } catch (error) {
      toast({
        title: 'Could not save',
        description: (error as Error).message,
        tone: 'error',
      })
    } finally {
      setSaving(false)
    }
  }

  if (isPending || !campaign) {
    return <p className="text-[13px] text-muted-foreground">Loading…</p>
  }

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={[{ label: 'Campaigns', to: '/app/campaigns' }, { label: campaign.name }]}
        title={campaign.name}
        description={campaign.subject || 'No subject line yet'}
        actions={
          <>
            <Badge
              tone={
                campaign.status === 'sent'
                  ? 'success'
                  : campaign.status === 'sending'
                    ? 'primary'
                    : campaign.status === 'scheduled'
                      ? 'info'
                      : campaign.status === 'paused'
                        ? 'warning'
                        : 'neutral'
              }
              dot
            >
              {campaign.status}
            </Badge>

            {!isSent ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  loading={saving}
                  disabled={!dirty}
                  onClick={save}
                >
                  <Check />
                  {dirty ? 'Save' : 'Saved'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setScheduleDialog(true)}
                >
                  <Calendar />
                  Schedule
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setSendDialog(true)}
                >
                  <Send />
                  Send now
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  await campaignServerFns.cancel({ data: { id: campaignId } })
                  toast({ title: 'Campaign cancelled', tone: 'warning' })
                  await invalidate()
                }}
              >
                <Ban />
                Stop sending
              </Button>
            )}
          </>
        }
      />

      <Tabs value={stage} onChange={setStage} tabs={STAGES} />

      {stage === 'content' ? (
        <div className="overflow-hidden rounded-lg border border-border">
          <EmailEditor
            document={document}
            subject={subject}
            preheader={preheader}
            onChange={(next) => {
              setDocument(next)
              setDirty(true)
            }}
            onSubjectChange={(value) => {
              setSubject(value)
              setDirty(true)
            }}
            onPreheaderChange={(value) => {
              setPreheader(value)
              setDirty(true)
            }}
          />
        </div>
      ) : null}

      {stage === 'recipients' ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader
              title="Audience"
              description="Choose the segment this campaign resolves to at launch."
            />
            <div className="space-y-4 p-4">
              <Field
                label="Segment"
                hint="Leave empty to target every subscribed contact"
              >
                <Select
                  value={segmentId}
                  onChange={(event) => {
                    setSegmentId(event.target.value)
                    setDirty(true)
                  }}
                >
                  <option value="">All subscribed contacts</option>
                  {segments?.map((segment) => (
                    <option key={segment.id} value={segment.id}>
                      {segment.name}
                    </option>
                  ))}
                </Select>
              </Field>

              {audience ? (
                <div className="rounded-md border border-border bg-subtle p-3">
                  <div className="flex items-baseline gap-2">
                    <span data-numeric className="text-[20px] font-semibold">
                      {formatNumber(audience.total)}
                    </span>
                    <span className="text-[12px] text-muted-foreground">
                      contacts will receive this campaign
                    </span>
                  </div>

                  {audience.sample.length > 0 ? (
                    <ul className="mt-3 space-y-0.5">
                      {audience.sample.map((contact) => (
                        <li
                          key={contact.email}
                          className="truncate font-mono text-[11px] text-muted-foreground"
                        >
                          {contact.email}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHeader title="Settings" />
            <div className="space-y-3 p-4">
              <Field label="Internal name">
                <Input
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value)
                    setDirty(true)
                  }}
                />
              </Field>
              <Field
                label="From email"
                hint="Defaults to your verified sending domain"
              >
                <Input
                  type="email"
                  value={fromEmail}
                  onChange={(event) => {
                    setFromEmail(event.target.value)
                    setDirty(true)
                  }}
                  placeholder="hello@yourdomain.com"
                />
              </Field>
              <Field label="From name">
                <Input
                  value={fromName}
                  onChange={(event) => {
                    setFromName(event.target.value)
                    setDirty(true)
                  }}
                  placeholder="Your company"
                />
              </Field>
            </div>
          </Card>
        </div>
      ) : null}

      {stage === 'preview' ? (
        <CampaignPreview campaignId={campaignId} document={document} subject={subject} preheader={preheader} />
      ) : null}

      {stage === 'send' ? (
        <Card>
          <CardHeader
            title="Review and send"
            description="Sending freezes the audience and queues one message per contact."
          />
          <div className="space-y-4 p-4">
            <dl className="grid gap-3 sm:grid-cols-2">
              <ReviewRow label="Subject" value={subject || '— missing'} warn={!subject} />
              <ReviewRow
                label="Audience"
                value={
                  segments?.find((segment) => segment.id === segmentId)?.name ??
                  'All subscribed contacts'
                }
              />
              <ReviewRow
                label="Recipients"
                value={audience ? formatNumber(audience.total) : '—'}
              />
              <ReviewRow
                label="Content"
                value={`${document.blocks.length} block${document.blocks.length === 1 ? '' : 's'}`}
                warn={document.blocks.length === 0}
              />
            </dl>

            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                disabled={!subject || document.blocks.length === 0}
                onClick={() => setSendDialog(true)}
              >
                <Send />
                Send {audience ? formatNumber(audience.total) : ''} emails
              </Button>
              {dirty ? (
                <span className="text-[12px] text-warning">
                  Unsaved changes — save before sending.
                </span>
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}

      {stage === 'analytics' ? (
        <CampaignAnalytics campaignId={campaignId} stats={stats} />
      ) : null}

      <SendDialog
        open={sendDialog}
        onOpenChange={setSendDialog}
        campaignId={campaignId}
        recipients={audience?.total ?? campaign.recipientsCount}
        onSent={async () => {
          setSendDialog(false)
          setStage('analytics')
          await invalidate()
        }}
      />

      <ScheduleDialog
        open={scheduleDialog}
        onOpenChange={setScheduleDialog}
        campaignId={campaignId}
        onScheduled={async () => {
          setScheduleDialog(false)
          await invalidate()
        }}
      />

      <ConfirmDialog
        open={cancelDialog}
        onOpenChange={setCancelDialog}
        title="Stop this campaign"
        message="Remaining queued messages will not be delivered. Contacts who already received it are unaffected."
        confirmLabel="Stop sending"
        destructive
        onConfirm={async () => {
          await campaignServerFns.cancel({ data: { id: campaignId } })
          toast({ title: 'Campaign cancelled', tone: 'warning' })
          await invalidate()
        }}
      />

      <ContactDrawer
        contactId={openContactId}
        onClose={() => setOpenContactId(null)}
        onChanged={invalidate}
      />
    </div>
  )
}

function ReviewRow({
  label,
  value,
  warn,
}: {
  label: string
  value: string
  warn?: boolean
}) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <dt className="text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </dt>
      <dd
        className={cn(
          'mt-0.5 truncate text-[13px]',
          warn && 'text-destructive',
        )}
      >
        {value}
      </dd>
    </div>
  )
}

function CampaignPreview({
  campaignId,
  document,
  subject,
  preheader,
}: {
  campaignId: string
  document: EmailDocument
  subject: string
  preheader: string
}) {
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const { data: campaign } = useServerQuery(campaignServerFns.get, {
    id: campaignId,
  })
  const { data: audience } = useServerQuery(
    campaignServerFns.previewAudience,
    { segmentId: campaign?.segmentId ?? null },
  )

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader
          title="Inbox preview"
          description="Subject and from line as the recipient sees them."
          action={
            <div className="flex items-center gap-1 rounded-md border border-border bg-muted p-0.5">
              <Button
                variant={device === 'desktop' ? 'subtle' : 'ghost'}
                size="sm"
                onClick={() => setDevice('desktop')}
              >
                Desktop
              </Button>
              <Button
                variant={device === 'mobile' ? 'subtle' : 'ghost'}
                size="sm"
                onClick={() => setDevice('mobile')}
              >
                Mobile
              </Button>
            </div>
          }
        />
        <div className="space-y-4 p-4">
          <div className="rounded-md border border-border bg-card">
            <div className="flex items-start gap-2 border-b border-border px-3 py-2">
              <span className="mt-0.5 size-6 shrink-0 rounded-full bg-muted" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-semibold">
                  {campaign?.fromName || 'Your company'}
                </p>
                <p className="truncate font-mono text-[10px] text-muted-foreground">
                  {campaign?.fromEmail ?? 'hello@yourdomain.com'} · to me
                </p>
              </div>
              <span className="font-mono text-[10px] text-muted-foreground">
                now
              </span>
            </div>
            <div className="border-b border-border px-3 py-2">
              <p className="truncate text-[13px] font-medium">
                {subject || 'Subject line missing'}
              </p>
              {preheader ? (
                <p className="truncate text-[11px] text-muted-foreground">
                  {preheader}
                </p>
              ) : null}
            </div>
            <div className={cn('bg-subtle p-4', device === 'mobile' && 'max-w-[320px]')}>
              <iframe
                title="Campaign preview"
                sandbox=""
                srcDoc={renderPreview(document, preheader)}
                className="h-[520px] w-full rounded border-0 bg-white"
              />
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Test send" description="Deliver this to yourself." />
        <div className="space-y-3 p-4">
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            A test send goes through the same pipeline as a real campaign, but
            never touches campaign analytics or the contact's engagement history.
          </p>
          <TestSend campaignId={campaignId} />
          {audience ? (
            <div className="rounded-md border border-border bg-subtle p-3">
              <p className="flex items-center gap-1.5 text-[12px]">
                <Users className="size-3.5 text-muted-foreground" />
                {formatNumber(audience.total)} recipients in this audience
              </p>
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  )
}

function TestSend({ campaignId }: { campaignId: string }) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()

  return (
    <div className="space-y-2">
      <Input
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="you@company.com"
      />
      <Button
        variant="outline"
        size="sm"
        className="w-full justify-center"
        loading={busy}
        disabled={!email.trim()}
        onClick={async () => {
          setBusy(true)
          try {
            const result = await campaignServerFns.sendTest({
              data: { campaignId, to: email.trim() },
            })
            toast({
              title: result.status === 'sent' ? 'Test email sent' : 'Send failed',
              description:
                result.status === 'sent'
                  ? `Check ${email.trim()}`
                  : (result.error ?? undefined),
              tone: result.status === 'sent' ? 'success' : 'error',
            })
          } catch (error) {
            toast({
              title: 'Test send failed',
              description: (error as Error).message,
              tone: 'error',
            })
          } finally {
            setBusy(false)
          }
        }}
      >
        <Mail />
        Send test
      </Button>
    </div>
  )
}

function CampaignAnalytics({
  campaignId,
  stats,
}: {
  campaignId: string
  stats:
    | {
        recipients: number
        delivered: number
        uniqueOpens: number
        opens: number
        uniqueClicks: number
        clicks: number
        bounces: number
        unsubscribes: number
        openRate: number
        clickRate: number
        bounceRate: number
        clickToOpenRate: number
        sentAt: string | null
      }
    | undefined
}) {
  const { data: activity } = useServerQuery(activityServerFns.list, {
    campaignId,
    limit: 60,
  })
  const [openContactId, setOpenContactId] = useState<string | null>(null)
  const invalidateLocal = useInvalidateServer()

  if (!stats) return null

  return (
    <div className="space-y-4">
      <StatGrid>
        <StatTile
          label="Delivered"
          value={formatNumber(stats.delivered)}
          hint={`of ${formatNumber(stats.recipients)} sent`}
          icon={<Send />}
        />
        <StatTile
          label="Open rate"
          value={formatPercent(stats.openRate)}
          hint={`${formatNumber(stats.uniqueOpens)} unique opens`}
          tone="primary"
          icon={<Mail />}
        >
          <ProgressBar value={stats.openRate} />
        </StatTile>
        <StatTile
          label="Click rate"
          value={formatPercent(stats.clickRate)}
          hint={`${formatNumber(stats.uniqueClicks)} unique clicks`}
          tone="info"
          icon={<MousePointerClick />}
        >
          <ProgressBar value={stats.clickRate} tone="info" />
        </StatTile>
        <StatTile
          label="Click-to-open"
          value={formatPercent(stats.clickToOpenRate)}
          hint="of openers clicked"
          icon={<MousePointerClick />}
        />
        <StatTile
          label="Bounces"
          value={formatNumber(stats.bounces)}
          hint={formatPercent(stats.bounceRate)}
          tone={stats.bounceRate > 0.05 ? 'destructive' : 'default'}
          icon={<Ban />}
        />
        <StatTile
          label="Unsubscribed"
          value={formatNumber(stats.unsubscribes)}
          hint="opted out"
          tone="warning"
          icon={<Ban />}
        />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Activity"
            description="Every send, open and click in this campaign."
          />
          <ActivityTimeline
            items={activity ?? []}
            onOpenContact={setOpenContactId}
            emptyTitle="Nothing sent yet"
          />
        </Card>

        <Card>
          <CardHeader title="Summary" />
          <div className="space-y-4 p-4">
            <Funnel
              stages={[
                { stage: 'Sent', value: stats.recipients },
                { stage: 'Delivered', value: stats.delivered },
                { stage: 'Opened', value: stats.uniqueOpens },
                { stage: 'Clicked', value: stats.uniqueClicks },
              ]}
            />
            <dl className="space-y-2 border-t border-border pt-3 text-[12px]">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Total opens</dt>
                <dd data-numeric>{formatNumber(stats.opens)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Total clicks</dt>
                <dd data-numeric>{formatNumber(stats.clicks)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Sent at</dt>
                <dd data-numeric>
                  {stats.sentAt ? formatDateTime(stats.sentAt) : '—'}
                </dd>
              </div>
            </dl>
          </div>
        </Card>
      </div>

      <ContactDrawer
        contactId={openContactId}
        onClose={() => setOpenContactId(null)}
        onChanged={invalidateLocal}
      />
    </div>
  )
}

function SendDialog({
  open,
  onOpenChange,
  campaignId,
  recipients,
  onSent,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  campaignId: string
  recipients: number
  onSent: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Send this campaign now"
      message={
        <>
          This will deliver to <strong>{formatNumber(recipients)}</strong>{' '}
          contacts right now. The audience is frozen at this moment. This cannot
          be undone.
        </>
      }
      confirmLabel="Send now"
      onConfirm={async () => {
        setBusy(true)
        try {
          const result = await campaignServerFns.send({ data: { id: campaignId } })
          toast({
            title: `Sending to ${formatNumber(result.recipients)} contacts`,
            description: 'Watch the numbers update as the provider responds.',
            tone: 'success',
          })
          await onSent()
        } catch (error) {
          toast({
            title: 'Could not send',
            description: (error as Error).message,
            tone: 'error',
          })
          throw error
        } finally {
          setBusy(false)
        }
      }}
    />
  )
}

function ScheduleDialog({
  open,
  onOpenChange,
  campaignId,
  onScheduled,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  campaignId: string
  onScheduled: () => Promise<void>
}) {
  const [mode, setMode] = useState<'tomorrow' | 'custom'>('tomorrow')
  const [custom, setCustom] = useState('')
  const { toast } = useToast()

  const target = useMemo(() => {
    if (mode === 'tomorrow') {
      const date = new Date()
      date.setDate(date.getDate() + 1)
      date.setHours(9, 0, 0, 0)
      return date
    }
    return custom ? new Date(custom) : null
  }, [mode, custom])

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Schedule campaign"
      description="The scheduler launches the campaign when the time arrives."
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!target}
            onClick={async () => {
              if (!target) return
              try {
                await campaignServerFns.schedule({
                  data: { id: campaignId, scheduledAt: target.toISOString() },
                })
                toast({
                  title: 'Campaign scheduled',
                  description: formatDateTime(target),
                  tone: 'success',
                })
                await onScheduled()
              } catch (error) {
                toast({
                  title: 'Could not schedule',
                  description: (error as Error).message,
                  tone: 'error',
                })
              }
            }}
          >
            Schedule
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="When">
          <Select
            value={mode}
            onChange={(event) =>
              setMode(event.target.value as 'tomorrow' | 'custom')
            }
          >
            <option value="tomorrow">Tomorrow at 09:00</option>
            <option value="custom">Pick a date and time</option>
          </Select>
        </Field>

        {mode === 'custom' ? (
          <Field label="Date and time">
            <Input
              type="datetime-local"
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
            />
          </Field>
        ) : null}

        {target ? (
          <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <Clock className="size-3.5" />
            Sends {formatRelative(target)} · {formatDateTime(target)}
          </p>
        ) : null}
      </div>
    </Dialog>
  )
}

/** Preview uses the exact render path used at send time, in preview mode. */
function renderPreview(document: EmailDocument, preheader: string): string {
  return renderDocument(document, {
    baseUrl: 'https://app.lumail.example',
    preview: true,
    preheader,
  })
}