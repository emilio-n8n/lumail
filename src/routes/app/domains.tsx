import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { Check, Circle, Copy, Plus, Server, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/app/shell'
import { Badge, Card, CardHeader } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog, Dialog } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/tabs'
import { useToast } from '@/components/ui/toast'
import { platformServerFns } from '@/rpc/workflows'
import { useServerQuery, useInvalidateServer } from '@/lib/use-server-query'
import { cn, formatDateTime } from '@/lib/utils'
import type { DomainRecord } from '@/lib/domain/types'

export const Route = createFileRoute('/app/domains')({
  component: DomainsPage,
})

function DomainsPage() {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<DomainRecord | null>(null)
  const { toast } = useToast()
  const invalidate = useInvalidateServer()

  const { data } = useServerQuery(platformServerFns.domains, undefined as never)
  const domains = data?.domains ?? []

  return (
    <div className="space-y-4">
      <PageHeader
        title="Domains"
        description="Sending domains, SPF, DKIM and DMARC. Until a domain is verified, sends fall back to your configured fallback domain."
        actions={
          <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
            <Plus />
            Add domain
          </Button>
        }
      />

      {data?.health ? (
        <Card
          className={cn(
            data.health.live ? 'border-success/30' : 'border-border',
          )}
        >
          <div className="flex items-center gap-3 p-4">
            <span
              className={cn(
                'grid size-8 shrink-0 place-items-center rounded-md border',
                data.health.live
                  ? 'border-success/30 bg-success-muted text-success'
                  : 'border-border bg-muted text-muted-foreground',
              )}
            >
              <Server className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-[13px] font-medium">
                Email provider
                <Badge tone={data.health.live ? 'success' : 'neutral'} dot>
                  {data.health.live ? 'live' : 'simulation'}
                </Badge>
              </p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {data.health.detail}
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      {domains.length === 0 ? (
        <Card>
          <EmptyState
            title="No sending domains"
            description="Add a domain to control the From address your recipients see. Verification records are shown below."
            action={
              <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
                Add your first domain
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {domains.map((domain) => (
            <Card key={domain.id}>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    {domain.name}
                    {domain.isDefault ? (
                      <Badge tone="primary">default</Badge>
                    ) : null}
                  </span>
                }
                description={
                  domain.verifiedAt
                    ? `Verified ${formatDateTime(domain.verifiedAt)}`
                    : 'Waiting for DNS records'
                }
                action={
                  <div className="flex items-center gap-2">
                    <Badge
                      tone={
                        domain.status === 'verified'
                          ? 'success'
                          : domain.status === 'failed'
                            ? 'destructive'
                            : 'warning'
                      }
                      dot
                    >
                      {domain.status}
                    </Badge>
                    {domain.status !== 'verified' ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          await platformServerFns.verifyDomain({
                            data: { id: domain.id },
                          })
                          toast({
                            title: 'DNS records verified',
                            description: data?.live
                              ? undefined
                              : 'Simulation mode: marked verified locally.',
                            tone: 'success',
                          })
                          await invalidate()
                        }}
                      >
                        Verify
                      </Button>
                    ) : null}
                    {!domain.isDefault ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          await platformServerFns.setDefaultDomain({
                            data: { id: domain.id },
                          })
                          toast({ title: 'Default domain updated', tone: 'success' })
                          await invalidate()
                        }}
                      >
                        Make default
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Remove domain"
                      onClick={() => setRemoving(domain)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                }
              />

              <div className="p-4">
                <p className="mb-3 text-[12px] font-medium">
                  Add these DNS records at your registrar
                </p>
                <div className="overflow-hidden rounded-md border border-border">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="border-b border-border bg-subtle text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                        <th className="px-3 py-1.5 text-left font-medium">Type</th>
                        <th className="px-3 py-1.5 text-left font-medium">Name</th>
                        <th className="px-3 py-1.5 text-left font-medium">Value</th>
                        <th className="px-3 py-1.5 text-right font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      <DnsRow
                        type="TXT"
                        name={`_dmarc.${domain.name}`}
                        value={`v=DMARC1; p=none; rua=mailto:dmarc@${domain.name}`}
                        verified={domain.status === 'verified'}
                      />
                      <DnsRow
                        type="TXT"
                        name={domain.cnameRecordName}
                        value={domain.cnameRecordValue}
                        verified={domain.status === 'verified'}
                      />
                      <DnsRow
                        type="TXT"
                        name={domain.dkimRecordName}
                        value={`v=DKIM1; k=rsa; p=${domain.dkimPublicKey}`}
                        verified={domain.status === 'verified'}
                      />
                      <DnsRow
                        type="CNAME"
                        name="send"
                        value={`send.${domain.name}`}
                        verified={domain.status === 'verified'}
                      />
                    </tbody>
                  </table>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={adding}
        onOpenChange={setAdding}
        title="Add a sending domain"
        description="You will need to add DNS records afterwards."
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
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
                  await platformServerFns.addDomain({
                    data: { name: name.trim() },
                  })
                  toast({ title: 'Domain added', tone: 'success' })
                  setName('')
                  setAdding(false)
                  await invalidate()
                } catch (error) {
                  toast({
                    title: 'Could not add domain',
                    description: (error as Error).message,
                    tone: 'error',
                  })
                } finally {
                  setBusy(false)
                }
              }}
            >
              Add domain
            </Button>
          </>
        }
      >
        <Field label="Domain" hint="For example acme.com">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="acme.com"
            autoFocus
          />
        </Field>
      </Dialog>

      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remove domain"
        message={
          <>
            <strong>{removing?.name}</strong> will be removed. Messages already
            sent are unaffected.
          </>
        }
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          if (!removing) return
          await platformServerFns.deleteDomain({ data: { id: removing.id } })
          toast({ title: 'Domain removed', tone: 'success' })
          await invalidate()
        }}
      />
    </div>
  )
}

function DnsRow({
  type,
  name,
  value,
  verified,
}: {
  type: string
  name: string
  value: string
  verified: boolean
}) {
  const { toast } = useToast()
  return (
    <tr>
      <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
        {type}
      </td>
      <td className="px-3 py-2 font-mono text-[11px]">{name}</td>
      <td className="max-w-md px-3 py-2">
        <code className="block truncate font-mono text-[10px] text-muted-foreground">
          {value}
        </code>
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex items-center justify-end gap-2">
          {verified ? (
            <Check className="size-3.5 text-success" />
          ) : (
            <Circle className="size-3.5 text-muted-foreground" />
          )}
          <button
            type="button"
            aria-label="Copy record"
            onClick={() => {
              void navigator.clipboard?.writeText(value)
              toast({ title: 'Record copied', tone: 'success' })
            }}
            className="text-muted-foreground hover:text-foreground"
          >
            <Copy className="size-3.5" />
          </button>
        </div>
      </td>
    </tr>
  )
}