import { useMemo, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Copy, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/app/shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, ConfirmDialog } from '@/components/ui/dialog'
import { Field, Input, Select } from '@/components/ui/input'
import { Tabs } from '@/components/ui/tabs'
import { DataTable, type Column } from '@/components/app/data-table'
import { useToast } from '@/components/ui/toast'
import { campaignServerFns } from '@/rpc/campaigns'
import { segmentServerFns } from '@/rpc/contacts'
import { useServerQuery, useInvalidateServer } from '@/lib/use-server-query'
import { formatNumber, formatPercent, formatRelative } from '@/lib/utils'
import type { Campaign, CampaignStats, CampaignStatus } from '@/lib/domain/types'

export const Route = createFileRoute('/app/campaigns')({
  component: CampaignsPage,
})

const STATUS_TONES: Record<CampaignStatus, 'neutral' | 'info' | 'primary' | 'success' | 'warning' | 'destructive'> = {
  draft: 'neutral',
  scheduled: 'info',
  sending: 'primary',
  sent: 'success',
  paused: 'warning',
  cancelled: 'destructive',
}

type Row = Campaign & { stats?: CampaignStats }

function CampaignsPage() {
  const [status, setStatus] = useState<'all' | CampaignStatus>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Campaign | null>(null)
  const { toast } = useToast()

  const { data, isPending } = useServerQuery(campaignServerFns.list, {
    status: status === 'all' ? null : status,
    search: search || null,
  })
  const refetch = useInvalidateServer()
  const { data: segments } = useServerQuery(segmentServerFns.list, undefined as never)

  const rows = data ?? []

  const columns: Column<Row>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Campaign',
        width: '2.4fr',
        cell: (row) => (
          <Link
            to="/app/campaigns/$campaignId"
            params={{ campaignId: row.id }}
            className="min-w-0"
          >
            <div className="truncate text-[13px] font-medium hover:underline">
              {row.name}
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              {row.subject || 'No subject line'}
            </div>
          </Link>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        width: '0.8fr',
        cell: (row) => (
          <Badge tone={STATUS_TONES[row.status]} dot>
            {row.status}
          </Badge>
        ),
      },
      {
        key: 'segment',
        header: 'Audience',
        width: '1.2fr',
        cell: (row) => (
          <span className="truncate text-[12px] text-muted-foreground">
            {row.segmentName ?? 'All subscribed'}
          </span>
        ),
      },
      {
        key: 'recipients',
        header: 'Recipients',
        width: '0.8fr',
        align: 'right',
        cell: (row) => (
          <span data-numeric className="font-mono text-[11px]">
            {formatNumber(row.recipientsCount)}
          </span>
        ),
      },
      {
        key: 'sent',
        header: 'Sent',
        width: '0.9fr',
        align: 'right',
        cell: (row) => (
          <span className="font-mono text-[11px] text-muted-foreground">
            {row.sentAt ? formatRelative(row.sentAt) : '—'}
          </span>
        ),
      },
      {
        key: 'actions',
        header: '',
        width: '0.7fr',
        align: 'right',
        cell: (row) => (
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Duplicate campaign"
              onClick={async () => {
                await campaignServerFns.duplicate({ data: { id: row.id } })
                toast({ title: 'Campaign duplicated', tone: 'success' })
                await refetch()
              }}
            >
              <Copy />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Delete campaign"
              onClick={() => setDeleting(row)}
            >
              <Trash2 />
            </Button>
          </div>
        ),
      },
    ],
    [toast],
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="Campaigns"
        description="Draft, review, schedule and send. The audience is frozen at launch."
        actions={
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus />
            New campaign
          </Button>
        }
      />

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        loading={isPending && !data}
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value)
          setPage(1)
        }}
        searchPlaceholder="Search campaigns…"
        page={page}
        pageSize={Math.max(1, rows.length)}
        total={rows.length}
        onPageChange={setPage}
        toolbar={
          <Tabs
            value={status}
            onChange={(value) => {
              setStatus(value)
              setPage(1)
            }}
            tabs={[
              { value: 'all', label: 'All' },
              { value: 'draft', label: 'Draft' },
              { value: 'scheduled', label: 'Scheduled' },
              { value: 'sending', label: 'Sending' },
              { value: 'sent', label: 'Sent' },
            ]}
          />
        }
        emptyTitle="No campaigns yet"
        emptyDescription="Create a campaign, choose an audience and send it to your contacts."
        emptyAction={
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            Create your first campaign
          </Button>
        }
      />

      <CreateCampaignDialog
        open={creating}
        onOpenChange={setCreating}
        segments={segments ?? []}
        onCreated={async (campaignId) => {
          setCreating(false)
          await refetch()
          window.location.href = `/app/campaigns/${campaignId}`
        }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete campaign"
        message={
          <>
            <strong>{deleting?.name}</strong> and its per-recipient messages and
            analytics will be deleted. This cannot be undone.
          </>
        }
        confirmLabel="Delete campaign"
        destructive
        onConfirm={async () => {
          if (!deleting) return
          await campaignServerFns.remove({ data: { id: deleting.id } })
          toast({ title: 'Campaign deleted', tone: 'success' })
          await refetch()
        }}
      />
    </div>
  )
}

function CreateCampaignDialog({
  open,
  onOpenChange,
  segments,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  segments: { id: string; name: string }[]
  onCreated: (campaignId: string) => Promise<void>
}) {
  const [form, setForm] = useState({
    name: '',
    subject: '',
    segmentId: '',
  })
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()

  const { data: audience } = useServerQuery(
    campaignServerFns.previewAudience,
    { segmentId: form.segmentId || null },
    { enabled: open },
  )

  const submit = async () => {
    setBusy(true)
    try {
      const campaign = await campaignServerFns.create({
        data: {
          name: form.name.trim(),
          subject: form.subject.trim(),
          segmentId: form.segmentId || null,
        },
      })
      toast({ title: 'Campaign created', tone: 'success' })
      await onCreated(campaign.id)
    } catch (error) {
      toast({
        title: 'Could not create campaign',
        description: (error as Error).message,
        tone: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New campaign"
      description="You will land in the editor to write the content."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            disabled={!form.name.trim()}
            onClick={submit}
          >
            Create and edit
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Campaign name" hint="Internal only — recipients never see this">
          <Input
            value={form.name}
            onChange={(event) =>
              setForm((current) => ({ ...current, name: event.target.value }))
            }
            placeholder="March product update"
            autoFocus
          />
        </Field>

        <Field label="Subject line" hint="You can change this later">
          <Input
            value={form.subject}
            onChange={(event) =>
              setForm((current) => ({ ...current, subject: event.target.value }))
            }
            placeholder="What's new in March"
          />
        </Field>

        <Field
          label="Audience"
          hint={
            audience
              ? `${formatNumber(audience.total)} contact${audience.total === 1 ? '' : 's'} will receive this campaign`
              : 'Leave empty to target every subscribed contact'
          }
        >
          <Select
            value={form.segmentId}
            onChange={(event) =>
              setForm((current) => ({ ...current, segmentId: event.target.value }))
            }
          >
            <option value="">All subscribed contacts</option>
            {segments.map((segment) => (
              <option key={segment.id} value={segment.id}>
                {segment.name}
              </option>
            ))}
          </Select>
        </Field>

        {audience && audience.sample.length > 0 ? (
          <div className="rounded-md border border-border bg-subtle p-3">
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
              Sample recipients
            </p>
            <ul className="space-y-0.5">
              {audience.sample.map((contact) => (
                <li
                  key={contact.email}
                  className="truncate font-mono text-[11px] text-muted-foreground"
                >
                  {contact.email}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}
