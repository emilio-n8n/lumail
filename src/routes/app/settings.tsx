import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import {
  Building2,
  Globe,
  Mail,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react'
import { PageHeader } from '@/components/app/shell'
import { Badge, Card, CardHeader } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog, Dialog } from '@/components/ui/dialog'
import { Field, Input, Select } from '@/components/ui/input'
import { Tabs } from '@/components/ui/tabs'
import { useToast } from '@/components/ui/toast'
import { settingsServerFns } from '@/rpc/workflows'
import { useServerQuery, useInvalidateServer } from '@/lib/use-server-query'
import { formatNumber, formatRelative } from '@/lib/utils'
import type { AppRole } from '@/lib/auth/session'
import type { InviteRow, MemberRow } from '@/lib/domain/types'

export const Route = createFileRoute('/app/settings')({
  component: SettingsPage,
})

function SettingsPage() {
  const [tab, setTab] = useState<'workspace' | 'team' | 'email' | 'security'>(
    'workspace',
  )
  const { toast } = useToast()
  const invalidate = useInvalidateServer()

  const { data: context } = useServerQuery(
    settingsServerFns.context,
    undefined as never,
  )
  const { data: members } = useServerQuery(
    settingsServerFns.members,
    undefined as never,
  )
  const { data: invites } = useServerQuery(
    settingsServerFns.invites,
    undefined as never,
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="Settings"
        description="Workspace, team, sending identity and access."
      />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'workspace', label: 'Workspace' },
          { value: 'team', label: 'Team', count: members?.length },
          { value: 'email', label: 'Email' },
          { value: 'security', label: 'Security' },
        ]}
      />

      {tab === 'workspace' ? <WorkspaceTab context={context} onDone={invalidate} /> : null}
      {tab === 'team' ? (
        <TeamTab
          members={members ?? []}
          invites={invites ?? []}
          isOwner={context?.role === 'owner'}
          onDone={invalidate}
        />
      ) : null}
      {tab === 'email' ? <EmailTab onDone={invalidate} /> : null}
      {tab === 'security' ? <SecurityTab /> : null}

    </div>
  )
}

function WorkspaceTab({
  context,
  onDone,
}: {
  context:
    | { workspaces: { id: string; name: string; role: AppRole; memberCount: number; isCurrent: boolean }[]; stats: { members: number; api_keys: number; webhooks: number; domains: number; workflows: number } }
    | undefined
  onDone: () => Promise<unknown>
}) {
  const [name, setName] = useState(context?.workspaces[0]?.name ?? '')
  const [fromName, setFromName] = useState('')
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="Workspace" description="Name and default sender." />
        <div className="space-y-3 p-4">
          <Field label="Workspace name">
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field
            label="Default from name"
            hint="Used when a campaign does not set its own sender"
          >
            <Input
              value={fromName}
              onChange={(event) => setFromName(event.target.value)}
              placeholder="Acme"
            />
          </Field>
          <div className="flex justify-end">
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              disabled={!name.trim()}
              onClick={async () => {
                setBusy(true)
                try {
                  await settingsServerFns.updateWorkspace({
                    data: {
                      name: name.trim(),
                      fromName: fromName.trim() || null,
                    },
                  })
                  toast({ title: 'Workspace updated', tone: 'success' })
                  await onDone()
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
              Save
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="At a glance" />
        <dl className="divide-y divide-border">
          {[
            ['Members', context?.stats.members],
            ['API keys', context?.stats.api_keys],
            ['Webhooks', context?.stats.webhooks],
            ['Domains', context?.stats.domains],
            ['Automations', context?.stats.workflows],
          ].map(([label, value]) => (
            <div key={String(label)} className="flex items-center justify-between px-4 py-2">
              <dt className="text-[13px] text-muted-foreground">{label}</dt>
              <dd data-numeric className="text-[13px] font-medium">
                {formatNumber(Number(value ?? 0))}
              </dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  )
}

function TeamTab({
  members,
  invites,
  isOwner,
  onDone,
}: {
  members: MemberRow[]
  invites: InviteRow[]
  isOwner: boolean
  onDone: () => Promise<unknown>
}) {
  const [inviting, setInviting] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const { toast } = useToast()

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Members"
          description="Roles are enforced server-side on every privileged operation."
          action={
            <Button variant="primary" size="sm" onClick={() => setInviting(true)}>
              <UserPlus />
              Invite
            </Button>
          }
        />
        <div className="divide-y divide-border">
          {members.map((member) => (
            <div key={member.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted font-mono text-[10px] font-semibold text-muted-foreground">
                {(member.fullName ?? member.email).slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">
                  {member.fullName ?? member.email}
                </p>
                <p className="truncate font-mono text-[10px] text-muted-foreground">
                  {member.email}
                </p>
              </div>
              <Select
                value={member.role}
                disabled={!isOwner}
                onChange={async (event) => {
                  await settingsServerFns.updateMemberRole({
                    data: {
                      memberId: member.id,
                      role: event.target.value as AppRole,
                    },
                  })
                  toast({ title: 'Role updated', tone: 'success' })
                  await onDone()
                }}
                className="h-7 w-28 text-[11px]"
              >
                <option value="owner">Owner</option>
                <option value="admin">Admin</option>
                <option value="member">Member</option>
              </Select>
              {isOwner ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove member"
                  onClick={() => setRemoving(member.id)}
                >
                  <Trash2 />
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      </Card>

      {invites.length > 0 ? (
        <Card>
          <CardHeader title="Pending invitations" />
          <div className="divide-y divide-border">
            {invites.map((invite) => (
              <div key={invite.id} className="flex items-center gap-3 px-4 py-2.5">
                <Mail className="size-3.5 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
                  {invite.email}
                </span>
                <Badge tone="outline">{invite.role}</Badge>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {formatRelative(invite.createdAt)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <InviteDialog
        open={inviting}
        onOpenChange={setInviting}
        onDone={onDone}
      />

      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remove member"
        message="They lose access to this workspace immediately. Their API keys stop working."
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          if (!removing) return
          await settingsServerFns.removeMember({ data: { memberId: removing } })
          toast({ title: 'Member removed', tone: 'success' })
          await onDone()
        }}
      />
    </div>
  )
}

function InviteDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => Promise<unknown>
}) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<AppRole>('member')
  const [busy, setBusy] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const { toast } = useToast()

  return (
    <Dialog
      open={open && !token}
      onOpenChange={onOpenChange}
      title="Invite a teammate"
      description="They join with the role you choose."
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
            disabled={!email.trim()}
            onClick={async () => {
              setBusy(true)
              try {
                const result = await settingsServerFns.invite({
                  data: { email: email.trim(), role },
                })
                setToken(result.token)
                await onDone()
              } catch (error) {
                toast({
                  title: 'Could not invite',
                  description: (error as Error).message,
                  tone: 'error',
                })
              } finally {
                setBusy(false)
              }
            }}
          >
            Send invite
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Email">
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="teammate@acme.com"
            autoFocus
          />
        </Field>
        <Field label="Role">
          <Select
            value={role}
            onChange={(event) => setRole(event.target.value as AppRole)}
          >
            <option value="member">Member — can send and edit</option>
            <option value="admin">Admin — can manage the workspace</option>
            <option value="owner">Owner — full control</option>
          </Select>
        </Field>
      </div>
    </Dialog>
  )
}

function EmailTab({ onDone }: { onDone: () => Promise<unknown> }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader
          title="Sending identity"
          description="Where replies go and how recipients are addressed."
        />
        <div className="space-y-3 p-4 text-[13px]">
          <div className="flex items-start gap-2">
            <Mail className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <p className="leading-relaxed text-muted-foreground">
              Each campaign can override its own From name, From address and
              Reply-To. Anything left empty falls back to the workspace default
              and then to your verified sending domain.
            </p>
          </div>
          <div className="flex items-start gap-2">
            <Globe className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <p className="leading-relaxed text-muted-foreground">
              Unsubscribe links are signed and one-click compliant. Every message
              includes a List-Unsubscribe header target.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void onDone()}>
            Manage domains
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader title="Merge variables" description="Available everywhere." />
        <div className="divide-y divide-border">
          {[
            ['{{firstName}}', 'First name, or the part before @ as a fallback'],
            ['{{lastName}}', 'Last name'],
            ['{{company}}', 'Company'],
            ['{{unsubscribeUrl}}', 'Signed one-click unsubscribe link'],
            ['{{currentYear}}', 'Year the message is sent'],
          ].map(([token, description]) => (
            <div key={token} className="px-4 py-2">
              <code className="font-mono text-[11px] text-primary-foreground-muted">
                {token}
              </code>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {description}
              </p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

function SecurityTab() {
  const items = [
    {
      icon: Users,
      title: 'Row level security',
      body: 'Every workspace-scoped table has RLS enabled with explicit grants. Reads and writes across tenants are rejected by PostgreSQL itself.',
    },
    {
      icon: Building2,
      title: 'Server-side authorisation',
      body: 'Roles live in a dedicated membership table and are re-read from the database on each privileged request. Nothing is trusted from localStorage or the client.',
    },
    {
      icon: Globe,
      title: 'Signed public endpoints',
      body: 'Unsubscribe and click-tracking links are HMAC-signed. Webhook callbacks are verified against a shared secret or the provider signature.',
    },
  ]

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {items.map((item) => {
        const Icon = item.icon
        return (
          <Card key={item.title} className="p-4">
            <Icon className="size-4 text-primary-foreground-muted" />
            <p className="mt-3 text-[13px] font-semibold">{item.title}</p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              {item.body}
            </p>
          </Card>
        )
      })}
    </div>
  )
}

