import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { Plus, Trash2, Users } from 'lucide-react'
import { PageHeader } from '@/components/app/shell'
import { Card, CardHeader, Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, ConfirmDialog } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/tabs'
import { DataTable, type Column } from '@/components/app/data-table'
import { ContactDrawer } from '@/components/app/contact-drawer'
import { SegmentBuilder } from '@/components/app/segment-builder'
import { useToast } from '@/components/ui/toast'
import { segmentServerFns } from '@/rpc/contacts'
import { useServerQuery, useInvalidateServer } from '@/lib/use-server-query'
import { formatNumber, formatRelative } from '@/lib/utils'
import type { Segment } from '@/lib/domain/types'

export const Route = createFileRoute('/app/segments')({
  component: SegmentsPage,
})

type Row = Segment & { summary: string }

function SegmentsPage() {
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Row | null>(null)
  const [deleting, setDeleting] = useState<Row | null>(null)
  const [membersOf, setMembersOf] = useState<Row | null>(null)
  const [openContactId, setOpenContactId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const { toast } = useToast()

  const { data, isPending } = useServerQuery(segmentServerFns.list, undefined as never)
  const refetch = useInvalidateServer()

  const rows = (data ?? []).filter((segment) =>
    search
      ? segment.name.toLowerCase().includes(search.toLowerCase()) ||
        segment.summary.toLowerCase().includes(search.toLowerCase())
      : true,
  )

  const columns: Column<Row>[] = [
    {
      key: 'name',
      header: 'Segment',
      width: '2fr',
      cell: (row) => (
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium">{row.name}</div>
          {row.description ? (
            <div className="truncate text-[11px] text-muted-foreground">
              {row.description}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'rule',
      header: 'Rule',
      width: '3fr',
      cell: (row) => (
        <span className="truncate font-mono text-[11px] text-muted-foreground">
          {row.summary}
        </span>
      ),
    },
    {
      key: 'match',
      header: 'Match',
      width: '0.6fr',
      cell: (row) => (
        <Badge tone="outline">{row.matchMode === 'all' ? 'AND' : 'OR'}</Badge>
      ),
    },
    {
      key: 'updated',
      header: 'Updated',
      width: '0.8fr',
      align: 'right',
      cell: (row) => (
        <span className="font-mono text-[11px] text-muted-foreground">
          {formatRelative(row.updatedAt)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '0.6fr',
      align: 'right',
      cell: (row) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="View members"
            onClick={() => setMembersOf(row)}
          >
            <Users />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Edit segment"
            onClick={() => setEditing(row)}
          >
            <span className="font-mono text-[11px]">✎</span>
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Delete segment"
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
        title="Segments"
        description="Dynamic cohorts. Rules are evaluated live, so members are never stale."
        actions={
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus />
            New segment
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
        searchPlaceholder="Search segments…"
        page={page}
        pageSize={Math.max(1, rows.length)}
        total={rows.length}
        onPageChange={setPage}
        emptyTitle="No segments yet"
        emptyDescription="Build a cohort from contact properties, tags, engagement or campaign activity."
        emptyAction={
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            Create your first segment
          </Button>
        }
      />

      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title="New segment"
        description="Contacts are matched against these rules on every read."
        size="lg"
      >
        <SegmentBuilder
          onSaved={async () => {
            setCreating(false)
            await refetch()
          }}
        />
      </Dialog>

      <Dialog
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
        title="Edit segment"
        description={editing?.name}
        size="lg"
      >
        {editing ? (
          <SegmentBuilder
            segmentId={editing.id}
            initialName={editing.name}
            initialDescription={editing.description ?? ''}
            initialConditions={editing.conditions}
            initialMatchMode={editing.matchMode}
            onSaved={async () => {
              setEditing(null)
              await refetch()
            }}
          />
        ) : null}
      </Dialog>

      <MembersDialog
        segment={membersOf}
        onClose={() => setMembersOf(null)}
        onOpenContact={setOpenContactId}
      />

      <ContactDrawer
        contactId={openContactId}
        onClose={() => setOpenContactId(null)}
        onChanged={refetch}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete segment"
        message={
          <>
            <strong>{deleting?.name}</strong> will be removed. Contacts are not
            deleted — they simply stop belonging to this cohort.
          </>
        }
        confirmLabel="Delete segment"
        destructive
        onConfirm={async () => {
          if (!deleting) return
          await segmentServerFns.remove({ data: { id: deleting.id } })
          toast({ title: 'Segment deleted', tone: 'success' })
          await refetch()
        }}
      />
    </div>
  )
}

function MembersDialog({
  segment,
  onClose,
  onOpenContact,
}: {
  segment: Row | null
  onClose: () => void
  onOpenContact: (id: string) => void
}) {
  const [page, setPage] = useState(1)

  const { data } = useServerQuery(
    segmentServerFns.members,
    { id: segment?.id ?? '00000000-0000-0000-0000-000000000000', page },
    { enabled: Boolean(segment) },
  )
  const isPending = !data && Boolean(segment)

  return (
    <Dialog
      open={Boolean(segment)}
      onOpenChange={(open) => {
        if (!open) {
          setPage(1)
          onClose()
        }
      }}
      title={segment?.name ?? 'Members'}
      description={
        segment
          ? `${formatNumber(data?.total ?? 0)} contacts currently match — ${
              segment.matchMode === 'all' ? 'all' : 'any'
            } rules must hold.`
          : undefined
      }
      size="lg"
    >
      <Card>
        <CardHeader
          title="Matching contacts"
          description={segment?.summary}
          className="border-b"
        />
        {isPending ? (
          <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">
            Evaluating…
          </p>
        ) : data && data.items.length > 0 ? (
          <div className="divide-y divide-border">
            {data.items.map((contact) =>
              contact ? (
                <button
                  key={contact.id}
                  type="button"
                  onClick={() => onOpenContact(contact.id)}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-muted/60"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">
                      {contact.email}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {[contact.firstName, contact.lastName, contact.company]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 font-mono text-[10px] text-muted-foreground">
                    <span>{formatNumber(contact.opens)} opens</span>
                    <span>{formatNumber(contact.clicks)} clicks</span>
                  </div>
                </button>
              ) : null,
            )}
          </div>
        ) : (
          <EmptyState
            compact
            title="No contacts match yet"
            description="Loosen a rule or import more contacts."
          />
        )}
      </Card>

      {data && data.pageCount > 1 ? (
        <div className="mt-3 flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((value) => value - 1)}
          >
            Previous
          </Button>
          <span data-numeric className="text-[11px] text-muted-foreground">
            {page} / {data.pageCount} · {formatNumber(data.total)} contacts
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= data.pageCount}
            onClick={() => setPage((value) => value + 1)}
          >
            Next
          </Button>
        </div>
      ) : null}
    </Dialog>
  )
}