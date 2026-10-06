import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  Download,
  Filter,
  Plus,
  Tag,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { PageHeader } from '@/components/app/shell'
import { DataTable, type Column } from '@/components/app/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import {
  DropdownMenu,
  MenuCheckbox,
  MenuItem,
  MenuSeparator,
} from '@/components/ui/dropdown-menu'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { contactServerFns } from '@/rpc/contacts'
import { useServerQuery, useInvalidateServer } from '@/lib/use-server-query'
import { useQueryClient } from '@tanstack/react-query'
import {
  cn,
  formatNumber,
  formatRelative,
  initials,
  pluralize,
} from '@/lib/utils'
import type { Contact } from '@/lib/domain/types'
import { ContactDrawer } from '@/components/app/contact-drawer'

const STATUS_TONES: Record<string, 'success' | 'warning' | 'destructive' | 'neutral'> = {
  subscribed: 'success',
  unsubscribed: 'warning',
  bounced: 'destructive',
  complained: 'destructive',
  archived: 'neutral',
}

export function ContactsPage() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<string>('')
  const [tagIds, setTagIds] = useState<string[]>([])
  const [sort, setSort] = useState('created_at')
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc')
  const [selected, setSelected] = useState<string[]>([])
  const [openContactId, setOpenContactId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [tagDialog, setTagDialog] = useState(false)

  const query = {
    page,
    pageSize,
    search: search || undefined,
    status: status || null,
    tagIds: tagIds.length ? tagIds : undefined,
    sort: sort as never,
    direction,
  }

  const queryClient = useQueryClient()
  const invalidate = useInvalidateServer()
  const refetch = invalidate

  const { data, isPending } = useServerQuery(
    contactServerFns.list,
    query,
    { placeholderData: (previous) => previous },
  )
  const { data: tags } = useServerQuery(contactServerFns.tags, undefined as never)
  const { data: stats } = useServerQuery(contactServerFns.stats, undefined as never)
  void queryClient
  const { toast } = useToast()

  const columns: Column<Contact>[] = useMemo(
    () => [
      {
        key: 'email',
        header: 'Contact',
        width: '2.2fr',
        cell: (row) => (
          <div className="flex items-center gap-2.5">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted font-mono text-[10px] font-medium text-muted-foreground">
              {initials(row.firstName ?? row.email)}
            </span>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium">
                {row.firstName || row.lastName
                  ? `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim()
                  : row.email}
              </div>
              <div className="truncate font-mono text-[10px] text-muted-foreground">
                {row.email}
              </div>
            </div>
          </div>
        ),
        sortValue: (row) => row.email,
      },
      {
        key: 'company',
        header: 'Company',
        width: '1.2fr',
        cell: (row) => (
          <span className="truncate text-muted-foreground">
            {row.company ?? '—'}
          </span>
        ),
      },
      {
        key: 'tags',
        header: 'Tags',
        width: '1.5fr',
        cell: (row) =>
          row.tags.length === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {row.tags.slice(0, 3).map((tag) => (
                <Badge key={tag.id} tone="neutral">
                  {tag.name}
                </Badge>
              ))}
              {row.tags.length > 3 ? (
                <Badge tone="outline">+{row.tags.length - 3}</Badge>
              ) : null}
            </div>
          ),
      },
      {
        key: 'status',
        header: 'Status',
        width: '0.8fr',
        cell: (row) => (
          <Badge tone={STATUS_TONES[row.status] ?? 'neutral'} dot>
            {row.status}
          </Badge>
        ),
      },
      {
        key: 'activity',
        header: 'Last activity',
        width: '1fr',
        align: 'right',
        cell: (row) => (
          <span className="font-mono text-[11px] text-muted-foreground">
            {row.lastActivityAt ? formatRelative(row.lastActivityAt) : 'never'}
          </span>
        ),
        sortValue: (row) => row.lastActivityAt ?? '',
      },
      {
        key: 'created',
        header: 'Added',
        width: '0.8fr',
        align: 'right',
        cell: (row) => (
          <span className="font-mono text-[11px] text-muted-foreground">
            {formatRelative(row.createdAt)}
          </span>
        ),
        sortValue: (row) => row.createdAt,
      },
    ],
    [],
  )

  const onSort = (key: string) => {
    if (sort === key) {
      setDirection((value) => (value === 'asc' ? 'desc' : 'asc'))
    } else {
      setSort(key)
      setDirection('asc')
    }
    setPage(1)
  }

  const activeFilters =
    (status ? 1 : 0) + tagIds.length + (search ? 1 : 0)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Contacts"
        description={
          stats
            ? `${formatNumber(stats.total)} contacts · ${formatNumber(stats.subscribed)} subscribed · ${formatNumber(stats.new_last_30_days)} added in 30 days`
            : 'Loading…'
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const csv = await contactServerFns.exportCsv()
                const blob = new Blob([csv], { type: 'text/csv' })
                const url = URL.createObjectURL(blob)
                const anchor = document.createElement('a')
                anchor.href = url
                anchor.download = `lumail-contacts-${new Date().toISOString().slice(0, 10)}.csv`
                anchor.click()
                URL.revokeObjectURL(url)
                toast({ title: 'Export downloaded', tone: 'success' })
              }}
            >
              <Download />
              Export
            </Button>
            <Button variant="outline" size="sm" onClick={() => setImporting(true)}>
              <Upload />
              Import CSV
            </Button>
            <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
              <Plus />
              Add contact
            </Button>
          </>
        }
      />

      <DataTable
        columns={columns}
        rows={data?.items}
        rowKey={(row) => row.id}
        loading={isPending && !data}
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value)
          setPage(1)
        }}
        searchPlaceholder="Search email, name or company…"
        sort={sort}
        onSortChange={onSort}
        selectable
        selected={selected}
        onSelectedChange={setSelected}
        page={page}
        pageSize={pageSize}
        total={data?.total}
        onPageChange={setPage}
        onPageSizeChange={(value) => {
          setPageSize(value)
          setPage(1)
        }}
        onRowClick={(row) => setOpenContactId(row.id)}
        emptyTitle="No contacts match"
        emptyDescription={
          activeFilters > 0
            ? 'Try clearing a filter or widening your search.'
            : 'Add contacts manually or import a CSV to get started.'
        }
        emptyAction={
          activeFilters > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setStatus('')
                setTagIds([])
                setSearch('')
              }}
            >
              Clear filters
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
              Add your first contact
            </Button>
          )
        }
        toolbar={
          <>
            <Select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value)
                setPage(1)
              }}
              className="h-8 w-auto text-[12px]"
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              {Object.keys(STATUS_TONES).map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </Select>

            <DropdownTags
              tags={tags ?? []}
              selected={tagIds}
              onChange={(next) => {
                setTagIds(next)
                setPage(1)
              }}
            />
          </>
        }
        bulkActions={(ids, clear) => (
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-medium">
              {pluralize(ids.length, 'contact')} selected
            </span>
            <Button variant="outline" size="sm" onClick={() => setTagDialog(true)}>
              <Tag />
              Add tag
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={async () => {
                try {
                  const count = await contactServerFns.remove({ data: { ids } })
                  toast({
                    title: `Deleted ${count} contact${count === 1 ? '' : 's'}`,
                    tone: 'success',
                  })
                  clear()
                  await refetch()
                } catch (error) {
                  toast({
                    title: 'Delete failed',
                    description: (error as Error).message,
                    tone: 'error',
                  })
                }
              }}
            >
              <Trash2 />
              Delete
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={clear}>
              <X />
            </Button>
          </div>
        )}
      />

      <ContactDrawer
        contactId={openContactId}
        onClose={() => setOpenContactId(null)}
        onChanged={refetch}
      />

      <CreateContactDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={async () => {
          await refetch()
        }}
      />

      <ImportDialog open={importing} onOpenChange={setImporting} onDone={refetch} />

      <AddTagDialog
        open={tagDialog}
        onOpenChange={setTagDialog}
        contactIds={selected}
        onDone={async () => {
          setTagDialog(false)
          setSelected([])
          await refetch()
        }}
      />
    </div>
  )
}

function DropdownTags({
  tags,
  selected,
  onChange,
}: {
  tags: { id: string; name: string; count: number }[]
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  return (
    <DropdownMenu
      align="start"
      trigger={
        <span
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-md border border-border-strong px-2.5 text-[13px] transition-colors hover:bg-muted',
            selected.length > 0 && 'border-primary bg-accent text-accent-foreground',
          )}
        >
          <Filter className="size-3.5" />
          Tags
          {selected.length > 0 ? (
            <span
              data-numeric
              className="rounded-xs bg-primary px-1 text-[10px] font-semibold text-primary-foreground"
            >
              {selected.length}
            </span>
          ) : null}
        </span>
      }
    >
      <div className="max-h-72 w-64 overflow-y-auto">
        {tags.length === 0 ? (
          <p className="px-2 py-3 text-[12px] text-muted-foreground">
            No tags yet.
          </p>
        ) : (
          tags.map((tag) => (
            <MenuCheckbox
              key={tag.id}
              checked={selected.includes(tag.id)}
              onSelect={() =>
                onChange(
                  selected.includes(tag.id)
                    ? selected.filter((id) => id !== tag.id)
                    : [...selected, tag.id],
                )
              }
            >
              <span className="flex flex-1 items-center justify-between gap-2">
                <span className="truncate">{tag.name}</span>
                <span data-numeric className="text-[10px] text-muted-foreground">
                  {formatNumber(tag.count)}
                </span>
              </span>
            </MenuCheckbox>
          ))
        )}
        {selected.length > 0 ? (
          <>
            <MenuSeparator />
            <MenuItem onSelect={() => onChange([])}>Clear filter</MenuItem>
          </>
        ) : null}
      </div>
    </DropdownMenu>
  )
}

function CreateContactDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => Promise<void>
}) {
  const [form, setForm] = useState({
    email: '',
    firstName: '',
    lastName: '',
    company: '',
    tagNames: '',
  })
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()

  const update = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }))

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add a contact"
      description="Email must be unique inside this workspace."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            disabled={!form.email.trim()}
            onClick={async () => {
              setBusy(true)
              try {
                await contactServerFns.create({
                  data: {
                    email: form.email.trim(),
                    firstName: form.firstName.trim() || null,
                    lastName: form.lastName.trim() || null,
                    company: form.company.trim() || null,
                    tagNames: form.tagNames
                      .split(',')
                      .map((tag) => tag.trim())
                      .filter(Boolean),
                  },
                })
                toast({ title: 'Contact added', tone: 'success' })
                setForm({
                  email: '',
                  firstName: '',
                  lastName: '',
                  company: '',
                  tagNames: '',
                })
                onOpenChange(false)
                await onCreated()
              } catch (error) {
                toast({
                  title: 'Could not add contact',
                  description: (error as Error).message,
                  tone: 'error',
                })
              } finally {
                setBusy(false)
              }
            }}
          >
            Add contact
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Email" className="sm:col-span-2" htmlFor="email">
          <Input
            id="email"
            type="email"
            value={form.email}
            onChange={(event) => update('email', event.target.value)}
            placeholder="ada@example.com"
            autoFocus
          />
        </Field>
        <Field label="First name" htmlFor="firstName">
          <Input
            id="firstName"
            value={form.firstName}
            onChange={(event) => update('firstName', event.target.value)}
          />
        </Field>
        <Field label="Last name" htmlFor="lastName">
          <Input
            id="lastName"
            value={form.lastName}
            onChange={(event) => update('lastName', event.target.value)}
          />
        </Field>
        <Field label="Company" htmlFor="company">
          <Input
            id="company"
            value={form.company}
            onChange={(event) => update('company', event.target.value)}
          />
        </Field>
        <Field
          label="Tags"
          hint="Comma separated — created if they don't exist"
          htmlFor="tags"
        >
          <Input
            id="tags"
            value={form.tagNames}
            onChange={(event) => update('tagNames', event.target.value)}
            placeholder="trial, founder"
          />
        </Field>
      </div>
    </Dialog>
  )
}

function ImportDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => Promise<unknown>
}) {
  const [csv, setCsv] = useState('')
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Import contacts"
      description="Paste CSV with an email column. first_name, last_name, phone and company are used when present."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            disabled={!csv.trim()}
            onClick={async () => {
              setBusy(true)
              try {
                const result = await contactServerFns.importCsv({ data: { csv } })
                toast({
                  title: `Imported ${formatNumber(result.created)} new, updated ${formatNumber(result.updated)}`,
                  description:
                    result.failed > 0
                      ? `${result.failed} rows were rejected.`
                      : undefined,
                  tone: result.failed > 0 ? 'warning' : 'success',
                })
                setCsv('')
                onOpenChange(false)
                await onDone()
              } catch (error) {
                toast({
                  title: 'Import failed',
                  description: (error as Error).message,
                  tone: 'error',
                })
              } finally {
                setBusy(false)
              }
            }}
          >
            Import
          </Button>
        </>
      }
    >
      <Textarea
        rows={12}
        value={csv}
        onChange={(event) => setCsv(event.target.value)}
        placeholder={'email,first_name,last_name,company\nada@example.com,Ada,Lovelace,Analytical'}
        className="font-mono text-[11px]"
      />
    </Dialog>
  )
}

function AddTagDialog({
  open,
  onOpenChange,
  contactIds,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  contactIds: string[]
  onDone: () => Promise<void>
}) {
  const [tags, setTags] = useState('')
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add tags"
      description={`Applies to ${pluralize(contactIds.length, 'contact')}.`}
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
            disabled={!tags.trim()}
            onClick={async () => {
              setBusy(true)
              try {
                await contactServerFns.addTags({
                  data: {
                    contactIds,
                    tagNames: tags
                      .split(',')
                      .map((tag) => tag.trim())
                      .filter(Boolean),
                  },
                })
                toast({ title: 'Tags applied', tone: 'success' })
                setTags('')
                await onDone()
              } catch (error) {
                toast({
                  title: 'Could not tag contacts',
                  description: (error as Error).message,
                  tone: 'error',
                })
              } finally {
                setBusy(false)
              }
            }}
          >
            Apply
          </Button>
        </>
      }
    >
      <Field label="Tags" hint="Comma separated">
        <Input
          value={tags}
          onChange={(event) => setTags(event.target.value)}
          placeholder="trial, engaged, q3"
          autoFocus
        />
      </Field>
    </Dialog>
  )
}