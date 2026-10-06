import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Pause, Play, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/app/shell'
import { Badge, Card } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, ConfirmDialog } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/input'
import { DataTable, type Column } from '@/components/app/data-table'
import { useToast } from '@/components/ui/toast'
import { workflowServerFns } from '@/rpc/workflows'
import { useServerQuery, useInvalidateServer } from '@/lib/use-server-query'
import { formatNumber } from '@/lib/utils'
import type { Workflow, WorkflowStatus } from '@/lib/domain/types'

export const Route = createFileRoute('/app/automations')({
  component: AutomationsPage,
})

type Row = Workflow & { enrolled: number; active: number }

const STATUS_TONES: Record<WorkflowStatus, 'success' | 'neutral' | 'warning'> = {
  active: 'success',
  draft: 'neutral',
  paused: 'warning',
  archived: 'neutral',
}

const TRIGGER_LABELS: Record<string, string> = {
  contact_created: 'Contact created',
  tag_added: 'Tag added',
  segment_added: 'Added to segment',
  email_opened: 'Email opened',
  link_clicked: 'Link clicked',
  custom_event: 'Custom event',
  webhook: 'Webhook',
}

function AutomationsPage() {
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Row | null>(null)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const { toast } = useToast()
  const invalidate = useInvalidateServer()

  const { data, isPending } = useServerQuery(
    workflowServerFns.list,
    undefined as never,
  )
  const { data: stats } = useServerQuery(
    workflowServerFns.stats,
    undefined as never,
  )

  const rows = (data ?? []).filter((workflow) =>
    search
      ? workflow.name.toLowerCase().includes(search.toLowerCase())
      : true,
  )

  const columns: Column<Row>[] = [
    {
      key: 'name',
      header: 'Automation',
      width: '2.2fr',
      cell: (row) => (
        <Link
          to="/app/automations/$workflowId"
          params={{ workflowId: row.id }}
          className="min-w-0"
        >
          <div className="truncate text-[13px] font-medium hover:underline">
            {row.name}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {row.description || (TRIGGER_LABELS[String(row.trigger.type)] ?? 'Trigger')}
          </div>
        </Link>
      ),
    },
    {
      key: 'trigger',
      header: 'Trigger',
      width: '1.2fr',
      cell: (row) => (
        <span className="truncate text-[12px] text-muted-foreground">
          {TRIGGER_LABELS[String(row.trigger.type)] ?? String(row.trigger.type)}
        </span>
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
      key: 'enrolled',
      header: 'Enrolled',
      width: '0.8fr',
      align: 'right',
      cell: (row) => (
        <span data-numeric className="font-mono text-[11px]">
          {formatNumber(row.enrolled)}
        </span>
      ),
    },
    {
      key: 'runs',
      header: 'Runs',
      width: '0.7fr',
      align: 'right',
      cell: (row) => (
        <span data-numeric className="font-mono text-[11px] text-muted-foreground">
          {formatNumber(row.runsCount)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '0.9fr',
      align: 'right',
      cell: (row) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={row.status === 'active' ? 'Pause' : 'Activate'}
            title={row.status === 'active' ? 'Pause' : 'Activate'}
            onClick={async () => {
              const next = row.status === 'active' ? 'paused' : 'active'
              await workflowServerFns.setStatus({ data: { id: row.id, status: next } })
              toast({
                title: next === 'active' ? 'Automation activated' : 'Automation paused',
                tone: next === 'active' ? 'success' : 'warning',
              })
              await invalidate()
            }}
          >
            {row.status === 'active' ? <Pause /> : <Play />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Delete automation"
            onClick={() => setDeleting(row)}
          >
            <Trash2 />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Automations"
        description="Journeys that run themselves. Stored as a validated DAG and executed by the job queue."
        actions={
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus />
            New automation
          </Button>
        }
      />

      {stats ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            ['Active', stats.active],
            ['Paused', stats.paused],
            ['Enrolled', stats.enrolled],
            ['Completed', stats.completed],
            ['Failed', stats.failed],
          ].map(([label, value]) => (
            <Card key={String(label)} className="px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                {label}
              </p>
              <p data-numeric className="mt-0.5 text-[17px] font-semibold">
                {formatNumber(Number(value))}
              </p>
            </Card>
          ))}
        </div>
      ) : null}

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
        searchPlaceholder="Search automations…"
        page={page}
        pageSize={Math.max(1, rows.length)}
        total={rows.length}
        onPageChange={setPage}
        emptyTitle="No automations yet"
        emptyDescription="Build a journey: trigger, wait, condition, act."
        emptyAction={
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            Build your first automation
          </Button>
        }
      />

      <CreateWorkflowDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={async (workflowId) => {
          setCreating(false)
          window.location.href = `/app/automations/${workflowId}`
        }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete automation"
        message={
          <>
            <strong>{deleting?.name}</strong> will be removed along with its runs.
            Contacts are not affected.
          </>
        }
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleting) return
          await workflowServerFns.remove({ data: { id: deleting.id } })
          toast({ title: 'Automation deleted', tone: 'success' })
          await invalidate()
        }}
      />
    </div>
  )
}

function CreateWorkflowDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (workflowId: string) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New automation"
      description="Starts as a draft — you design the graph next."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            disabled={!name.trim()}
            onClick={async () => {
              setBusy(true)
              try {
                const workflow = await workflowServerFns.create({
                  data: {
                    name: name.trim(),
                    description: description.trim() || null,
                    trigger: { type: 'contact_created' },
                    definition: {
                      nodes: [
                        {
                          id: 'trigger',
                          type: 'trigger',
                          config: { type: 'contact_created' },
                          position: { x: 40, y: 24 },
                        },
                      ],
                      edges: [],
                    },
                  },
                })
                toast({ title: 'Automation created', tone: 'success' })
                await onCreated(workflow.id)
              } catch (error) {
                toast({
                  title: 'Could not create automation',
                  description: (error as Error).message,
                  tone: 'error',
                })
              } finally {
                setBusy(false)
              }
            }}
          >
            Create
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Welcome series"
            autoFocus
          />
        </Field>
        <Field label="Description" hint="Optional">
          <Input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Sent to everyone who signs up"
          />
        </Field>
      </div>
    </Dialog>
  )
}
