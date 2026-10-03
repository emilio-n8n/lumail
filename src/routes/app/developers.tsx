import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { Copy, Key, RefreshCw, Send, Terminal, Webhook } from 'lucide-react'
import { PageHeader } from '@/components/app/shell'
import { Badge, Card, CardHeader } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input, Select } from '@/components/ui/input'
import { SegmentedControl } from '@/components/ui/tabs'
import { useToast } from '@/components/ui/toast'
import { platformServerFns, transactionalServerFns } from '@/server/workflows'
import { templateServerFns } from '@/server/campaigns'
import { useServerQuery, useInvalidateServer } from '@/lib/use-server-query'
import { formatDateTime, formatNumber, formatRelative } from '@/lib/utils'
import { EMAIL_VARIABLES } from '@/lib/email/variables'
import { WEBHOOK_EVENTS } from '@/lib/webhooks/events'
import type { EmailMessage } from '@/lib/domain/types'

export const Route = createFileRoute('/app/developers')({
  component: DeveloperPage,
})

function DeveloperPage() {
  const [tab, setTab] = useState<'api' | 'keys' | 'webhooks' | 'jobs'>('api')
  const [creatingKey, setCreatingKey] = useState(false)
  const [createdKey, setCreatedKey] = useState<{
    plaintext: string
  } | null>(null)
  const [creatingWebhook, setCreatingWebhook] = useState(false)
  const [sendDialog, setSendDialog] = useState(false)
  const { toast } = useToast()
  const invalidate = useInvalidateServer()

  const { data: keyData } = useServerQuery(
    platformServerFns.apiKeys,
    undefined as never,
  )
  const { data: webhookData } = useServerQuery(
    platformServerFns.webhooks,
    undefined as never,
  )
  const { data: jobHealth } = useServerQuery(
    platformServerFns.jobs,
    undefined as never,
  )
  const { data: logs } = useServerQuery(transactionalServerFns.logs, {
    search: null,
    status: null,
    limit: 100,
  })

  return (
    <div className="space-y-4">
      <PageHeader
        title="Developers"
        description="One API for the whole platform. The same domain services power the dashboard, the MCP server and these endpoints."
        actions={
          <SegmentedControl
            value={tab}
            onChange={setTab}
            options={[
              { value: 'api', label: 'API reference' },
              { value: 'keys', label: 'API keys' },
              { value: 'webhooks', label: 'Webhooks' },
              { value: 'jobs', label: 'Jobs' },
            ]}
          />
        }
      />

      {tab === 'api' ? (
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Send a transactional email"
              description="POST /api/v1/emails"
            />
            <div className="p-4">
              <pre className="overflow-x-auto rounded-md border border-border bg-console p-3 font-mono text-[11px] leading-relaxed text-console-foreground">
{`curl -X POST ${typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'}/api/v1/emails \\
  -H "Authorization: Bearer $LUMAIL_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": ["ada@example.com"],
    "subject": "Welcome",
    "template": "welcome",
    "variables": { "firstName": "Ada" }
  }'`}
              </pre>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => setSendDialog(true)}
              >
                <Send />
                Try it from the dashboard
              </Button>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Resources"
              description="All versioned under /api/v1, authenticated with an API key."
            />
            <div className="divide-y divide-border">
              {[
                ['/contacts', 'GET POST PATCH DELETE', 'People, tags, custom fields, CSV import/export.'],
                ['/segments', 'GET POST PATCH DELETE', 'Dynamic cohorts; POST /:id/members adds contacts.'],
                ['/campaigns', 'GET POST PATCH DELETE', 'Plus POST /:id/send and POST /:id/schedule.'],
                ['/templates', 'GET POST PATCH DELETE', 'Reusable documents, including transactional ones.'],
                ['/workflows', 'GET POST PATCH DELETE', 'Plus POST /:id/activate and POST /:id/pause.'],
                ['/emails', 'POST', 'Transactional sends.'],
                ['/events', 'POST', 'Custom events that start automations.'],
              ].map(([path, methods, description]) => (
                <div key={path} className="flex items-start gap-3 px-4 py-2.5">
                  <code className="w-32 shrink-0 font-mono text-[12px] font-medium">
                    {path}
                  </code>
                  <code className="w-40 shrink-0 font-mono text-[10px] text-muted-foreground">
                    {methods}
                  </code>
                  <span className="text-[12px] text-muted-foreground">
                    {description}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="Merge variables"
                description="Available in templates, campaigns and automations."
              />
              <div className="divide-y divide-border">
                {EMAIL_VARIABLES.map((variable) => (
                  <div key={variable.key} className="px-4 py-2">
                    <code className="font-mono text-[11px] text-primary-foreground-muted">
                      {`{{${variable.key}}}`}
                    </code>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">
                      {variable.description}
                    </p>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Public endpoints"
                description="Outside the dashboard, so each verifies its caller."
              />
              <div className="space-y-3 p-4 text-[12px] leading-relaxed">
                <div>
                  <code className="font-mono text-[11px]">POST /api/public/events</code>
                  <p className="mt-0.5 text-muted-foreground">
                    Fire a custom event from your backend and start automations.
                    Authenticated with a workspace API key.
                  </p>
                </div>
                <div>
                  <code className="font-mono text-[11px]">
                    POST /api/public/jobs/tick
                  </code>
                  <p className="mt-0.5 text-muted-foreground">
                    Drain the job queue from cron. Authenticated with the
                    JOB_SECRET header.
                  </p>
                </div>
                <div>
                  <code className="font-mono text-[11px]">
                    POST /api/public/email-events
                  </code>
                  <p className="mt-0.5 text-muted-foreground">
                    Delivery-status callbacks from the provider. Authenticated
                    with an HMAC signature over the raw body.
                  </p>
                </div>
              </div>
            </Card>
          </div>
        </div>
      ) : null}

      {tab === 'keys' ? (
        <Card>
          <CardHeader
            title="API keys"
            description="Only a SHA-256 hash is stored. The key is shown once."
            action={
              <Button
                variant="primary"
                size="sm"
                onClick={() => setCreatingKey(true)}
              >
                <Key />
                New key
              </Button>
            }
          />
          <div className="divide-y divide-border">
            {(keyData?.keys ?? []).map((key) => (
              <div key={key.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{key.name}</p>
                  <p className="truncate font-mono text-[10px] text-muted-foreground">
                    {key.prefix}•••••••• •{' '}
                    {key.revokedAt
                      ? 'revoked'
                      : key.lastUsedAt
                        ? `last used ${formatRelative(key.lastUsedAt)}`
                        : 'never used'}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  {key.scopes.map((scope) => (
                    <Badge key={scope} tone="outline">
                      {scope}
                    </Badge>
                  ))}
                  {key.revokedAt ? (
                    <Badge tone="destructive">revoked</Badge>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        await platformServerFns.revokeApiKey({
                          data: { id: key.id },
                        })
                        toast({ title: 'Key revoked', tone: 'warning' })
                        await invalidate()
                      }}
                    >
                      Revoke
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {keyData?.keys.length === 0 ? (
              <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">
                No API keys yet.
              </p>
            ) : null}
          </div>
        </Card>
      ) : null}

      {tab === 'webhooks' ? (
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Webhook endpoints"
              description="Deliveries are signed with HMAC-SHA256 and retried with backoff."
              action={
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setCreatingWebhook(true)}
                >
                  <Webhook />
                  Add endpoint
                </Button>
              }
            />
            <div className="divide-y divide-border">
              {(webhookData?.webhooks ?? []).map((webhook) => (
                <div key={webhook.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-[12px]">{webhook.url}</p>
                    <p className="truncate text-[10px] text-muted-foreground">
                      {webhook.events.join(', ')}
                      {webhook.lastDeliveryAt
                        ? ` · last ${formatRelative(webhook.lastDeliveryAt)} → ${webhook.lastStatus ?? '—'}`
                        : ''}
                    </p>
                  </div>
                  <Badge tone={webhook.isActive ? 'success' : 'neutral'} dot>
                    {webhook.isActive ? 'active' : 'paused'}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Delete webhook"
                    onClick={async () => {
                      await platformServerFns.deleteWebhook({
                        data: { id: webhook.id },
                      })
                      toast({ title: 'Webhook removed', tone: 'success' })
                      await invalidate()
                    }}
                  >
                    <Terminal />
                  </Button>
                </div>
              ))}
              {webhookData?.webhooks.length === 0 ? (
                <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">
                  No endpoints configured.
                </p>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHeader title="Recent deliveries" />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-[13px]">
                <thead>
                  <tr className="border-b border-border bg-subtle text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                    <th className="px-4 py-1.5 text-left font-medium">Event</th>
                    <th className="px-4 py-1.5 text-left font-medium">URL</th>
                    <th className="px-4 py-1.5 text-right font-medium">Code</th>
                    <th className="px-4 py-1.5 text-right font-medium">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(webhookData?.deliveries ?? []).map((delivery) => (
                    <tr key={delivery.id}>
                      <td className="px-4 py-1.5 font-mono text-[11px]">
                        {delivery.event}
                      </td>
                      <td className="max-w-64 truncate px-4 py-1.5 font-mono text-[11px] text-muted-foreground">
                        {String((delivery as { url?: string }).url ?? '')}
                      </td>
                      <td
                        data-numeric
                        className="px-4 py-1.5 text-right font-mono text-[11px]"
                      >
                        {delivery.responseCode ?? '—'}
                      </td>
                      <td
                        data-numeric
                        className="px-4 py-1.5 text-right font-mono text-[11px] text-muted-foreground"
                      >
                        {formatDateTime(delivery.createdAt)}
                      </td>
                    </tr>
                  ))}
                  {webhookData?.deliveries.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-4 py-8 text-center text-muted-foreground"
                      >
                        No deliveries yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : null}

      {tab === 'jobs' ? (
        <Card>
          <CardHeader
            title="Job queue"
            description="Campaign fan-out, automation delays, retries and webhook delivery."
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  const summary = await platformServerFns.runJobs({
                    data: { limit: 50 },
                  })
                  toast({
                    title: `Processed ${summary.completed} job${summary.completed === 1 ? '' : 's'}`,
                    description: `${summary.failed} failed`,
                    tone: summary.failed > 0 ? 'warning' : 'success',
                  })
                  await invalidate()
                }}
              >
                <RefreshCw />
                Run now
              </Button>
            }
          />
          <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
            {Object.entries(jobHealth?.counts ?? {}).map(([status, count]) => (
              <div key={status} className="rounded-md border border-border px-3 py-2">
                <p className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                  {status}
                </p>
                <p data-numeric className="mt-0.5 text-[17px] font-semibold">
                  {formatNumber(count)}
                </p>
              </div>
            ))}
          </div>
          {jobHealth?.lastError ? (
            <p className="border-t border-border px-4 py-2 text-[12px] text-destructive">
              Last error: {jobHealth.lastError}
            </p>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Transactional log"
          description="Messages sent through POST /api/v1/emails."
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="border-b border-border bg-subtle text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                <th className="px-4 py-1.5 text-left font-medium">To</th>
                <th className="px-4 py-1.5 text-left font-medium">Subject</th>
                <th className="px-4 py-1.5 text-left font-medium">Status</th>
                <th className="px-4 py-1.5 text-right font-medium">Queued</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(logs ?? []).map((message: EmailMessage) => (
                <tr key={message.id}>
                  <td className="px-4 py-1.5 font-mono text-[11px]">
                    {message.toEmail}
                  </td>
                  <td className="max-w-64 truncate px-4 py-1.5">
                    {message.subject}
                  </td>
                  <td className="px-4 py-1.5">
                    <Badge
                      tone={
                        message.status === 'failed'
                          ? 'destructive'
                          : message.status === 'delivered'
                            ? 'success'
                            : 'neutral'
                      }
                    >
                      {message.status}
                    </Badge>
                  </td>
                  <td
                    data-numeric
                    className="px-4 py-1.5 text-right font-mono text-[11px] text-muted-foreground"
                  >
                    {formatRelative(message.queuedAt)}
                  </td>
                </tr>
              ))}
              {(logs ?? []).length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-8 text-center text-muted-foreground"
                  >
                    No transactional messages yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      <CreateKeyDialog
        open={creatingKey}
        onOpenChange={setCreatingKey}
        onCreated={(plaintext) => setCreatedKey({ plaintext })}
        onDone={invalidate}
      />

      <Dialog
        open={Boolean(createdKey)}
        onOpenChange={(open) => !open && setCreatedKey(null)}
        title="Copy your API key now"
        description="This is the only time it will be shown."
        size="sm"
        footer={
          <Button
            variant="primary"
            size="sm"
            onClick={() => setCreatedKey(null)}
          >
            Done
          </Button>
        }
      >
        <div className="space-y-3">
          <code className="block overflow-x-auto rounded-md border border-border bg-console p-3 font-mono text-[12px] text-console-foreground">
            {createdKey?.plaintext}
          </code>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-center"
            onClick={() => {
              void navigator.clipboard?.writeText(createdKey?.plaintext ?? '')
              toast({ title: 'Copied to clipboard', tone: 'success' })
            }}
          >
            <Copy />
            Copy
          </Button>
        </div>
      </Dialog>

      <CreateWebhookDialog
        open={creatingWebhook}
        onOpenChange={setCreatingWebhook}
        onDone={invalidate}
      />

      <SendTransactionalDialog
        open={sendDialog}
        onOpenChange={setSendDialog}
        onDone={invalidate}
      />
    </div>
  )
}

function CreateKeyDialog({
  open,
  onOpenChange,
  onCreated,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (plaintext: string) => void
  onDone: () => Promise<unknown>
}) {
  const [name, setName] = useState('')
  const [scope, setScope] = useState('*')
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Create an API key"
      size="sm"
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
                const result = await platformServerFns.createApiKey({
                  data: { name: name.trim(), scopes: [scope] },
                })
                onCreated(result.plaintext)
                setName('')
                onOpenChange(false)
                await onDone()
              } catch (error) {
                toast({
                  title: 'Could not create key',
                  description: (error as Error).message,
                  tone: 'error',
                })
              } finally {
                setBusy(false)
              }
            }}
          >
            Create key
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name" hint="So you can recognise it later">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Production backend"
            autoFocus
          />
        </Field>
        <Field label="Scopes" hint="Least privilege is safer">
          <Select value={scope} onChange={(event) => setScope(event.target.value)}>
            {[
              '*',
              'contacts:read',
              'contacts:write',
              'segments:read',
              'segments:write',
              'campaigns:read',
              'campaigns:write',
              'emails:send',
              'workflows:read',
              'workflows:write',
              'analytics:read',
            ].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Dialog>
  )
}

function CreateWebhookDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => Promise<unknown>
}) {
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<string[]>(['*'])
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add a webhook endpoint"
      description="Lumail POSTs signed JSON to this URL."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            disabled={!url.trim()}
            onClick={async () => {
              setBusy(true)
              try {
                await platformServerFns.createWebhook({
                  data: { url: url.trim(), events },
                })
                toast({ title: 'Webhook added', tone: 'success' })
                setUrl('')
                onOpenChange(false)
                await onDone()
              } catch (error) {
                toast({
                  title: 'Could not add webhook',
                  description: (error as Error).message,
                  tone: 'error',
                })
              } finally {
                setBusy(false)
              }
            }}
          >
            Add endpoint
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="URL">
          <Input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com/hooks/lumail"
            autoFocus
          />
        </Field>
        <Field label="Events" hint="Select all that apply">
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border p-2">
            {WEBHOOK_EVENTS.map((event) => (
              <label key={event} className="flex items-center gap-2 text-[12px]">
                <input
                  type="checkbox"
                  checked={events.includes(event)}
                  onChange={(checked) =>
                    setEvents((current) =>
                      checked
                        ? [...current, event]
                        : current.filter((value) => value !== event),
                    )
                  }
                  className="size-3.5 accent-[var(--color-primary)]"
                />
                <code className="font-mono text-[11px]">{event}</code>
              </label>
            ))}
          </div>
        </Field>
      </div>
    </Dialog>
  )
}

function SendTransactionalDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => Promise<unknown>
}) {
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('A quick note')
  const [templateName, setTemplateName] = useState('')
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()

  const { data: templates } = useServerQuery(templateServerFns.list, {
    category: 'transactional',
    search: null,
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Send a transactional email"
      description="This is exactly what POST /api/v1/emails does."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            disabled={!to.trim() || !subject.trim()}
            onClick={async () => {
              setBusy(true)
              try {
                const result = await transactionalServerFns.send({
                  data: {
                    to: to.trim(),
                    subject: subject.trim(),
                    templateName: templateName || undefined,
                    variables: { firstName: 'there', company: 'your team' },
                  },
                })
                toast({
                  title: result.status === 'sent' ? 'Sent' : 'Send failed',
                  description: result.error ?? `id ${result.id}`,
                  tone: result.status === 'sent' ? 'success' : 'error',
                })
                setTo('')
                onOpenChange(false)
                await onDone()
              } catch (error) {
                toast({
                  title: 'Could not send',
                  description: (error as Error).message,
                  tone: 'error',
                })
              } finally {
                setBusy(false)
              }
            }}
          >
            Send
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="To">
          <Input
            type="email"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            placeholder="ada@example.com"
            autoFocus
          />
        </Field>
        <Field label="Subject">
          <Input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
          />
        </Field>
        <Field
          label="Template"
          hint="Optional — leave empty to send plain HTML"
        >
          <Select
            value={templateName}
            onChange={(event) => setTemplateName(event.target.value)}
          >
            <option value="">No template</option>
            {templates?.map((template) => (
              <option key={template.id} value={template.name}>
                {template.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Dialog>
  )
}
