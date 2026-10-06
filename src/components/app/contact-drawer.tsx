import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  ChevronDown,
  Mail,
  MousePointerClick,
  Pencil,
  Plus,
  Save,
  Sparkles,
  X,
} from 'lucide-react'
import { Drawer } from '@/components/ui/dialog'
import { Badge, Card, CardHeader } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/input'
import { Tabs } from '@/components/ui/tabs'
import { useToast } from '@/components/ui/toast'
import { ActivityTimeline } from '@/components/app/activity'
import { contactServerFns } from '@/rpc/contacts'
import { useServerQuery } from '@/lib/use-server-query'
import {
  cn,
  formatDateTime,
  formatNumber,
  formatRelative,
  initials,
} from '@/lib/utils'

/**
 * Contact profile.
 *
 * The same person seen from every entry point: a row click, a segment member, a
 * campaign recipient or an automation run. Shows identity, engagement counters,
 * tags, custom fields, the full activity timeline, and every message received.
 */
export function ContactDrawer({
  contactId,
  onClose,
  onChanged,
}: {
  contactId: string | null
  onClose: () => void
  onChanged: () => Promise<unknown>
}) {
  const [tab, setTab] = useState<'overview' | 'activity' | 'emails'>('overview')
  const [editing, setEditing] = useState(false)
  const { toast } = useToast()

  const { data, refetch } = useServerQuery(
    contactServerFns.get,
    { id: contactId ?? '00000000-0000-0000-0000-000000000000' },
    { enabled: Boolean(contactId) },
  )
  const isPending = !data && Boolean(contactId)

  const contact = data?.contact
  const counters = data?.counters ?? {}

  const activityCount = data?.activity?.length ?? 0
  const emailCount = data?.messages?.length ?? 0

  return (
    <Drawer open={Boolean(contactId)} onOpenChange={(open) => !open && onClose()}>
      {contact ? (
        <>
          {/* header */}
          <div className="flex items-start gap-3 border-b border-border px-4 py-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted font-mono text-[12px] font-semibold text-muted-foreground">
              {initials(contact.firstName ?? contact.email)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-[14px] font-semibold">
                  {contact.firstName || contact.lastName
                    ? `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim()
                    : contact.email}
                </h2>
                <Badge
                  tone={
                    contact.status === 'subscribed'
                      ? 'success'
                      : contact.status === 'bounced' ||
                          contact.status === 'complained'
                        ? 'destructive'
                        : 'warning'
                  }
                  dot
                >
                  {contact.status}
                </Badge>
              </div>
              <p className="truncate font-mono text-[11px] text-muted-foreground">
                {contact.email}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              {editing ? (
                <Button variant="ghost" size="icon-sm" onClick={() => setEditing(false)}>
                  <X />
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={() => setEditing(true)}
                  aria-label="Edit contact"
                >
                  <Pencil />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onClose}
                aria-label="Close"
              >
                <X />
              </Button>
            </div>
          </div>

          {/* engagement counters */}
          <div className="grid grid-cols-5 divide-x divide-border border-b border-border">
            <Counter label="Sent" value={counters.sent} />
            <Counter label="Opened" value={counters.opened} tone="primary" />
            <Counter label="Clicked" value={counters.clicked} tone="primary" />
            <Counter
              label="Bounced"
              value={counters.bounced}
              tone="destructive"
            />
            <Counter label="Unsub" value={counters.unsubscribed} tone="warning" />
          </div>

          <Tabs
            className="shrink-0 px-4"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'overview', label: 'Overview' },
              { value: 'activity', label: 'Activity', count: activityCount },
              { value: 'emails', label: 'Emails', count: emailCount },
            ]}
          />

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {isPending && !data ? (
              <p className="text-[13px] text-muted-foreground">Loading…</p>
            ) : tab === 'overview' ? (
              <div className="space-y-4">
                <Card>
                  <CardHeader title="Information" />
                  <div className="p-4">
                    {editing ? (
                      <EditContactForm
                        contact={contact}
                        onCancel={() => setEditing(false)}
                        onSaved={async () => {
                          setEditing(false)
                          await refetch()
                          await onChanged()
                        }}
                      />
                    ) : (
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                        <DetailField label="First name" value={contact.firstName} />
                        <DetailField label="Last name" value={contact.lastName} />
                        <DetailField label="Phone" value={contact.phone} />
                        <DetailField label="Company" value={contact.company} />
                        <DetailField label="Source" value={contact.source} />
                        <DetailField label="Added" value={formatDateTime(contact.createdAt)} />
                        <DetailField
                          label="Last activity"
                          value={
                            contact.lastActivityAt
                              ? formatRelative(contact.lastActivityAt)
                              : 'never'
                          }
                        />
                        {contact.unsubscribedAt ? (
                          <DetailField
                            label="Unsubscribed"
                            value={formatDateTime(contact.unsubscribedAt)}
                          />
                        ) : null}
                      </dl>
                    )}
                  </div>
                </Card>

                <Card>
                  <CardHeader
                    title="Tags"
                    action={<AddTagInline contactId={contact.id} onSaved={refetch} />}
                  />
                  <div className="p-4">
                    {contact.tags.length === 0 ? (
                      <p className="text-[13px] text-muted-foreground">
                        No tags yet.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {contact.tags.map((tag) => (
                          <Badge key={tag.id} tone="neutral" dot>
                            {tag.name}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </Card>

                {data?.customFields?.length ? (
                  <Card>
                    <CardHeader title="Custom fields" />
                    <div className="p-4">
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                        {data.customFields.map((definition) => (
                          <div key={definition.id}>
                            <DetailField
                              label={definition.label}
                              value={
                                contact.customFields[definition.key] !== undefined
                                  ? String(contact.customFields[definition.key])
                                  : null
                              }
                            />
                          </div>
                        ))}
                      </dl>
                    </div>
                  </Card>
                ) : null}

                {data?.campaigns?.length ? (
                  <Card>
                    <CardHeader title="Campaigns" />
                    <div className="divide-y divide-border">
                      {data.campaigns.map((campaign) => (
                        <Link
                          key={campaign.id}
                          to="/app/campaigns/$campaignId"
                          params={{ campaignId: campaign.id }}
                          className="flex items-center justify-between px-4 py-2 text-[13px] hover:bg-muted/60"
                        >
                          <span className="truncate">{campaign.name}</span>
                          <ChevronDown className="size-3.5 -rotate-90 text-muted-foreground" />
                        </Link>
                      ))}
                    </div>
                  </Card>
                ) : null}

                {data?.workflows?.length ? (
                  <Card>
                    <CardHeader title="Automations" />
                    <div className="divide-y divide-border">
                      {data.workflows.map((workflow) => (
                        <Link
                          key={workflow.id}
                          to="/app/automations/$workflowId"
                          params={{ workflowId: workflow.id }}
                          className="flex items-center justify-between px-4 py-2 text-[13px] hover:bg-muted/60"
                        >
                          <span className="truncate">{workflow.name}</span>
                          <ChevronDown className="size-3.5 -rotate-90 text-muted-foreground" />
                        </Link>
                      ))}
                    </div>
                  </Card>
                ) : null}
              </div>
            ) : tab === 'activity' ? (
              <Card className="overflow-hidden">
                <ActivityTimeline
                  items={data?.activity ?? []}
                  showContact={false}
                  emptyTitle="No activity recorded"
                  emptyDescription="Sends, opens, clicks and tag changes will appear here."
                />
              </Card>
            ) : (
              <Card className="overflow-hidden">
                {emailCount === 0 ? (
                  <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">
                    This contact has not received any email yet.
                  </p>
                ) : (
                  <div className="divide-y divide-border">
                    {data?.messages.map((message) => (
                      <div key={message.id} className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <Mail className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                            {message.subject}
                          </span>
                          <Badge
                            tone={
                              message.status === 'clicked'
                                ? 'primary'
                                : message.status === 'opened'
                                  ? 'accent'
                                  : message.status === 'bounced' ||
                                      message.status === 'failed'
                                    ? 'destructive'
                                    : message.status === 'unsubscribed'
                                      ? 'warning'
                                      : 'neutral'
                            }
                          >
                            {message.status}
                          </Badge>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
                          <span>{formatDateTime(message.queuedAt)}</span>
                          {message.campaignName ? (
                            <span className="truncate">· {message.campaignName}</span>
                          ) : null}
                          {message.workflowName ? (
                            <span className="truncate">· {message.workflowName}</span>
                          ) : null}
                          {message.firstOpenedAt ? (
                            <span className="flex items-center gap-1 text-primary-foreground-muted">
                              <Sparkles className="size-2.5" />
                              {formatRelative(message.firstOpenedAt)}
                            </span>
                          ) : null}
                          {message.firstClickedAt ? (
                            <span className="flex items-center gap-1 text-primary-foreground-muted">
                              <MousePointerClick className="size-2.5" />
                              {formatRelative(message.firstClickedAt)}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            )}
          </div>
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center text-[13px] text-muted-foreground">
          {isPending ? 'Loading…' : 'Contact not found'}
        </div>
      )}
    </Drawer>
  )
}

function Counter({
  label,
  value,
  tone,
}: {
  label: string
  value?: number
  tone?: 'primary' | 'destructive' | 'warning'
}) {
  return (
    <div className="px-3 py-2.5 text-center">
      <p
        data-numeric
        className={cn(
          'text-[15px] font-semibold',
          tone === 'primary' && 'text-primary-foreground-muted',
          tone === 'destructive' && 'text-destructive',
          tone === 'warning' && 'text-warning',
        )}
      >
        {formatNumber(value ?? 0)}
      </p>
      <p className="mt-0.5 text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </p>
    </div>
  )
}

function DetailField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-[13px]">{value ?? '—'}</dd>
    </div>
  )
}

function EditContactForm({
  contact,
  onCancel,
  onSaved,
}: {
  contact: import('@/lib/domain/types').Contact
  onCancel: () => void
  onSaved: () => Promise<void>
}) {
  const [form, setForm] = useState({
    firstName: contact.firstName ?? '',
    lastName: contact.lastName ?? '',
    phone: contact.phone ?? '',
    company: contact.company ?? '',
    status: contact.status,
  })
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <LabeledInput
          label="First name"
          value={form.firstName}
          onChange={(value) => setForm((f) => ({ ...f, firstName: value }))}
        />
        <LabeledInput
          label="Last name"
          value={form.lastName}
          onChange={(value) => setForm((f) => ({ ...f, lastName: value }))}
        />
        <LabeledInput
          label="Phone"
          value={form.phone}
          onChange={(value) => setForm((f) => ({ ...f, phone: value }))}
        />
        <LabeledInput
          label="Company"
          value={form.company}
          onChange={(value) => setForm((f) => ({ ...f, company: value }))}
        />
      </div>
      <Field label="Status">
        <Select
          value={form.status}
          onChange={(event) =>
            setForm((f) => ({
              ...f,
              status: event.target.value as typeof f.status,
            }))
          }
        >
          {['subscribed', 'unsubscribed', 'bounced', 'complained', 'archived'].map(
            (status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ),
          )}
        </Select>
      </Field>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          loading={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await contactServerFns.update({
                data: {
                  id: contact.id,
                  firstName: form.firstName || null,
                  lastName: form.lastName || null,
                  phone: form.phone || null,
                  company: form.company || null,
                  status: form.status,
                },
              })
              toast({ title: 'Contact updated', tone: 'success' })
              await onSaved()
            } catch (error) {
              toast({
                title: 'Could not save',
                description: (error as Error).message,
                tone: 'error',
              })
            } finally {
              setBusy(false)
            }
          }}
        >
          <Save />
          Save
        </Button>
      </div>
    </div>
  )
}

function LabeledInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <Field label={label}>
      <Input value={value} onChange={(event) => onChange(event.target.value)} />
    </Field>
  )
}

function AddTagInline({
  contactId,
  onSaved,
}: {
  contactId: string
  onSaved: () => Promise<unknown>
}) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()

  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={async (event) => {
        event.preventDefault()
        if (!value.trim()) return
        setBusy(true)
        try {
          await contactServerFns.addTags({
            data: { contactIds: [contactId], tagNames: [value.trim()] },
          })
          setValue('')
          await onSaved()
        } catch (error) {
          toast({
            title: 'Could not tag contact',
            description: (error as Error).message,
            tone: 'error',
          })
        } finally {
          setBusy(false)
        }
      }}
    >
      <Input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Add tag"
        className="h-7 w-28 text-[11px]"
      />
      <Button type="submit" size="icon-sm" variant="outline" loading={busy} aria-label="Add tag">
        <Plus />
      </Button>
    </form>
  )
}
