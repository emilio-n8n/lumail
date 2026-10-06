import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { Copy, Mail, Send } from 'lucide-react'
import { PageHeader } from '@/components/app/shell'
import { Badge, Card, CardHeader } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { SegmentedControl } from '@/components/ui/tabs'
import { useToast } from '@/components/ui/toast'
import { transactionalServerFns } from '@/rpc/workflows'
import { useServerQuery, useInvalidateServer } from '@/lib/use-server-query'
import { formatNumber, formatRelative } from '@/lib/utils'
import type { EmailMessage, MessageStatus } from '@/lib/domain/types'

export const Route = createFileRoute('/app/transactional')({
  component: TransactionalPage,
})

const STATUS_TONES: Record<MessageStatus, 'neutral' | 'info' | 'success' | 'primary' | 'warning' | 'destructive'> = {
  queued: 'neutral',
  sent: 'neutral',
  delivered: 'info',
  opened: 'primary',
  clicked: 'success',
  bounced: 'destructive',
  complained: 'destructive',
  unsubscribed: 'warning',
  failed: 'destructive',
}

function TransactionalPage() {
  const [filter, setFilter] = useState<'all' | MessageStatus>('all')
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()
  const invalidate = useInvalidateServer()

  const { data: messages } = useServerQuery(transactionalServerFns.logs, {
    search: null,
    status: filter === 'all' ? null : filter,
    limit: 200,
  })

  const rows = messages ?? []
  const sent = rows.length
  const delivered = rows.filter((row) => row.status === 'delivered').length
  const failed = rows.filter((row) => row.status === 'failed').length

  return (
    <div className="space-y-4">
      <PageHeader
        title="Transactional"
        description="Send single messages from your application. Same pipeline, same provider, same analytics as campaigns."
        actions={
          <SegmentedControl
            size="sm"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'delivered', label: 'Delivered' },
              { value: 'opened', label: 'Opened' },
              { value: 'failed', label: 'Failed' },
            ]}
          />
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Send a message" description="Goes to the provider now." />
          <div className="space-y-3 p-4">
            <Field label="To">
              <Input
                type="email"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                placeholder="ada@example.com"
              />
            </Field>
            <Field label="Subject">
              <Input
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="Your receipt"
              />
            </Field>
            <Button
              variant="primary"
              size="sm"
              className="w-full justify-center"
              loading={busy}
              disabled={!to.trim() || !subject.trim()}
              onClick={async () => {
                setBusy(true)
                try {
                  const result = await transactionalServerFns.send({
                    data: {
                      to: to.trim(),
                      subject: subject.trim(),
                      html:
                        '<div style="font-family:sans-serif"><h1 style="font-size:20px">Thanks!</h1><p style="color:#555">This message was sent from your application through the Lumail transactional API.</p></div>',
                      variables: { firstName: 'there' },
                    },
                  })
                  toast({
                    title: result.status === 'sent' ? 'Message sent' : 'Send failed',
                    description: result.error ?? `message ${result.id}`,
                    tone: result.status === 'sent' ? 'success' : 'error',
                  })
                  setTo('')
                  setSubject('')
                  await invalidate()
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
              <Send />
              Send
            </Button>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Message ledger"
            description="Transactional sends recorded in the same ledger as campaigns."
          />
          <div className="divide-y divide-border">
            {rows.map((message: EmailMessage) => (
              <div key={message.id} className="flex items-center gap-3 px-4 py-2.5">
                <Mail className="size-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[12px]">
                    {message.toEmail}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {message.subject}
                  </p>
                </div>
                <Badge tone={STATUS_TONES[message.status]}>{message.status}</Badge>
                <span className="hidden w-32 shrink-0 text-right font-mono text-[10px] text-muted-foreground sm:block">
                  {formatRelative(message.queuedAt)}
                </span>
                <button
                  type="button"
                  aria-label="Copy message id"
                  onClick={() => {
                    void navigator.clipboard?.writeText(message.id)
                  }}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <Copy className="size-3.5" />
                </button>
              </div>
            ))}
            {rows.length === 0 ? (
              <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">
                No transactional messages yet. Send one above, or call
                <code className="mx-1 font-mono text-[11px]">POST /api/v1/emails</code>
                from your app.
              </p>
            ) : null}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          ['Messages', sent],
          ['Delivered', delivered],
          ['Failed', failed],
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

      <Card>
        <CardHeader title="Retries" description="How failures are handled." />
        <div className="space-y-2 p-4 text-[13px] leading-relaxed text-muted-foreground">
          <p>
            A message that fails at the provider is retried by the job queue with
            exponential backoff, up to five attempts, before it is marked
            failed.
          </p>
          <p>
            Delivery status callbacks from the provider are accepted at{' '}
            <code className="font-mono text-[11px]">/api/public/email-events</code>{' '}
            and are signature-verified before they update the ledger.
          </p>
        </div>
      </Card>
    </div>
  )
}
