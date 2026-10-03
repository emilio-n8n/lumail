import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Pause, Play, Save, UserRound } from 'lucide-react'
import { PageHeader } from '@/components/app/shell'
import { Badge, Card, CardHeader } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/tabs'
import { WorkflowBuilder } from '@/components/workflows/workflow-builder'
import { Dialog } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { workflowServerFns } from '@/server/workflows'
import { contactServerFns } from '@/server/contacts'
import { useServerQuery, useInvalidateServer } from '@/lib/use-server-query'
import { formatNumber, formatRelative } from '@/lib/utils'
import type { WorkflowDefinition } from '@/lib/domain/types'

export const Route = createFileRoute('/app/automations/$workflowId')({
  component: AutomationDetailPage,
})

function AutomationDetailPage() {
  const { workflowId } = Route.useParams()
  const [definition, setDefinition] = useState<WorkflowDefinition>({
    nodes: [],
    edges: [],
  })
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [hydrated, setHydrated] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [enrollDialog, setEnrollDialog] = useState(false)
  const { toast } = useToast()
  const invalidate = useInvalidateServer()

  const { data: workflow, isPending } = useServerQuery(workflowServerFns.get, {
    id: workflowId,
  })
  const { data: runs } = useServerQuery(workflowServerFns.runs, {
    workflowId,
    limit: 20,
  })

  useEffect(() => {
    if (!workflow || hydrated) return
    setDefinition(workflow.definition ?? { nodes: [], edges: [] })
    setName(workflow.name)
    setDescription(workflow.description ?? '')
    setHydrated(true)
  }, [workflow, hydrated])

  const isActive = workflow?.status === 'active'

  const save = async () => {
    setSaving(true)
    try {
      await workflowServerFns.update({
        data: {
          id: workflowId,
          name,
          description: description || null,
          definition,
        },
      })
      setDirty(false)
      toast({ title: 'Automation saved', tone: 'success' })
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

  const toggleStatus = async () => {
    const next = isActive ? 'paused' : 'active'
    try {
      await workflowServerFns.setStatus({ data: { id: workflowId, status: next } })
      toast({
        title: next === 'active' ? 'Automation activated' : 'Automation paused',
        tone: next === 'active' ? 'success' : 'warning',
      })
      await invalidate()
    } catch (error) {
      toast({
        title: 'Could not change status',
        description: (error as Error).message,
        tone: 'error',
      })
    }
  }

  if (isPending || !workflow) {
    return <p className="text-[13px] text-muted-foreground">Loading…</p>
  }

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <PageHeader
        breadcrumb={[
          { label: 'Automations', to: '/app/automations' },
          { label: workflow.name },
        ]}
        title={workflow.name}
        description={workflow.description || 'No description'}
        actions={
          <>
            <Badge
              tone={isActive ? 'success' : 'neutral'}
              dot
              className="mr-1"
            >
              {workflow.status}
            </Badge>
            <Button variant="outline" size="sm" onClick={() => setEnrollDialog(true)}>
              <UserRound />
              Enroll a contact
            </Button>
            <Button
              variant="outline"
              size="sm"
              loading={saving}
              disabled={!dirty}
              onClick={save}
            >
              <Save />
              {dirty ? 'Save' : 'Saved'}
            </Button>
            <Button
              variant={isActive ? 'outline' : 'primary'}
              size="sm"
              onClick={toggleStatus}
            >
              {isActive ? <Pause /> : <Play />}
              {isActive ? 'Pause' : 'Activate'}
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Graph"
            description={
              isActive
                ? 'Live — changes take effect on the next step of a run.'
                : 'Draft — edit freely, nothing is running yet.'
            }
          />
          <div className="overflow-hidden rounded-b-lg">
            <WorkflowBuilder
              definition={definition}
              triggerType={String(workflow.trigger.type)}
              onChange={(next) => {
                setDefinition(next)
                setDirty(true)
              }}
              readOnly={isActive}
            />
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Settings" />
            <div className="space-y-3 p-4">
              <Field label="Name">
                <Input
                  value={name}
                  disabled={isActive}
                  onChange={(event) => {
                    setName(event.target.value)
                    setDirty(true)
                  }}
                />
              </Field>
              <Field label="Description">
                <Input
                  value={description}
                  disabled={isActive}
                  onChange={(event) => {
                    setDescription(event.target.value)
                    setDirty(true)
                  }}
                />
              </Field>
              <dl className="space-y-2 border-t border-border pt-3 text-[12px]">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Nodes</dt>
                  <dd data-numeric>{definition.nodes.length}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Connections</dt>
                  <dd data-numeric>{definition.edges.length}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Total runs</dt>
                  <dd data-numeric>{formatNumber(workflow.runsCount)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Last run</dt>
                  <dd data-numeric>
                    {workflow.lastRunAt
                      ? formatRelative(workflow.lastRunAt)
                      : '—'}
                  </dd>
                </div>
              </dl>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Recent runs"
              description="Latest executions and where they are."
            />
            {runs && runs.length > 0 ? (
              <div className="divide-y divide-border">
                {runs.map((run) => (
                  <div key={run.id} className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                        {run.contactEmail}
                      </span>
                      <Badge
                        tone={
                          run.status === 'completed'
                            ? 'success'
                            : run.status === 'failed'
                              ? 'destructive'
                              : 'info'
                        }
                      >
                        {run.status}
                      </Badge>
                    </div>
                    <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                      {formatRelative(run.startedAt)}
                      {run.currentNodeId ? ` · at ${run.currentNodeId}` : ''}
                    </p>
                    {run.error ? (
                      <p className="mt-1 text-[11px] text-destructive">
                        {run.error}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                compact
                title="No runs yet"
                description="Activate the automation, then enroll a contact to watch it execute."
              />
            )}
          </Card>
        </div>
      </div>

      <EnrollDialog
        open={enrollDialog}
        onOpenChange={setEnrollDialog}
        workflowId={workflowId}
        onDone={invalidate}
      />
    </div>
  )
}

function EnrollDialog({
  open,
  onOpenChange,
  workflowId,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workflowId: string
  onDone: () => Promise<unknown>
}) {
  const [contactId, setContactId] = useState('')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()

  const { data: contacts } = useServerQuery(contactServerFns.list, {
    page: 1,
    pageSize: 25,
    search: search || undefined,
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Enroll a contact"
      description="Bypasses the trigger and starts the journey immediately."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            disabled={!contactId}
            onClick={async () => {
              setBusy(true)
              try {
                const result = await workflowServerFns.enroll({
                  data: { workflowId, contactId },
                })
                toast({
                  title: result.started
                    ? 'Contact enrolled'
                    : 'Already enrolled',
                  description: result.started
                    ? 'The run has started.'
                    : 'This contact already has an open run.',
                  tone: result.started ? 'success' : 'warning',
                })
                setContactId('')
                onOpenChange(false)
                await onDone()
              } catch (error) {
                toast({
                  title: 'Could not enroll',
                  description: (error as Error).message,
                  tone: 'error',
                })
              } finally {
                setBusy(false)
              }
            }}
          >
            Enroll
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search contacts…"
        />
        <div className="max-h-64 overflow-y-auto rounded-md border border-border">
          {contacts?.items.map((contact) => (
            <button
              key={contact.id}
              type="button"
              onClick={() => setContactId(contact.id)}
              className={`flex w-full items-center gap-2 border-b border-border px-3 py-1.5 text-left text-[12px] last:border-b-0 ${
                contactId === contact.id ? 'bg-accent' : 'hover:bg-muted'
              }`}
            >
              {contact.email}
              {contactId === contact.id ? (
                <span className="ml-auto font-mono text-[10px] text-primary-foreground-muted">
                  selected
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  )
}
