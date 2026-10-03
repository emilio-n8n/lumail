import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { Copy, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/app/shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, ConfirmDialog } from '@/components/ui/dialog'
import { Field, Input, Select } from '@/components/ui/input'
import { SegmentedControl } from '@/components/ui/tabs'
import { DataTable, type Column } from '@/components/app/data-table'
import { useToast } from '@/components/ui/toast'
import { templateServerFns } from '@/server/campaigns'
import { useServerQuery, useInvalidateServer } from '@/lib/use-server-query'
import { formatRelative } from '@/lib/utils'
import { EmailEditor } from '@/components/editor/email-editor'
import type {
  EmailDocument,
  EmailTemplate,
  TemplateCategory,
} from '@/lib/domain/types'

export const Route = createFileRoute('/app/templates')({
  component: TemplatesPage,
})

const STARTER_DOCUMENT: EmailDocument = {
  blocks: [
    {
      id: 'b1',
      type: 'heading',
      props: { level: 1, text: 'Your headline goes here', align: 'left' },
    },
    {
      id: 'b2',
      type: 'text',
      props: {
        text: 'Hi {{firstName}},<br><br>Open with the single most useful thing you want them to read.',
        align: 'left',
        size: 'md',
      },
    },
    {
      id: 'b3',
      type: 'button',
      props: {
        label: 'Get started',
        href: 'https://example.com',
        align: 'left',
        variant: 'primary',
      },
    },
  ],
}

const CATEGORY_TONES: Record<TemplateCategory, 'primary' | 'info' | 'accent' | 'success' | 'warning' | 'outline'> = {
  newsletter: 'primary',
  welcome: 'success',
  product_update: 'info',
  transactional: 'accent',
  promotion: 'warning',
  onboarding: 'outline',
}

type Filter = TemplateCategory | 'all'

function TemplatesPage() {
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<EmailTemplate | 'new' | null>(null)
  const [deleting, setDeleting] = useState<EmailTemplate | null>(null)
  const { toast } = useToast()

  const { data, isPending } = useServerQuery(templateServerFns.list, {
    category: filter === 'all' ? null : filter,
    search: search || null,
  })
  const refetch = useInvalidateServer()

  const columns: Column<EmailTemplate>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Template',
        width: '2fr',
        cell: (row) => (
          <button
            type="button"
            onClick={() => setEditing(row)}
            className="min-w-0 text-left"
          >
            <div className="truncate text-[13px] font-medium hover:underline">
              {row.name}
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              {row.subject || 'No subject line'}
            </div>
          </button>
        ),
      },
      {
        key: 'category',
        header: 'Category',
        width: '1fr',
        cell: (row) => (
          <Badge tone={CATEGORY_TONES[row.category]}>{row.category}</Badge>
        ),
      },
      {
        key: 'blocks',
        header: 'Blocks',
        width: '0.6fr',
        align: 'right',
        cell: (row) => (
          <span data-numeric className="font-mono text-[11px] text-muted-foreground">
            {row.document.blocks.length}
          </span>
        ),
      },
      {
        key: 'updated',
        header: 'Updated',
        width: '0.9fr',
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
        width: '0.8fr',
        align: 'right',
        cell: (row) => (
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Create campaign from template"
              title="Create campaign from template"
              onClick={async () => {
                try {
                  const campaign = await templateServerFns.createCampaign({
                    data: { templateId: row.id },
                  })
                  toast({ title: 'Campaign created', tone: 'success' })
                  window.location.href = `/app/campaigns/${campaign.id}`
                } catch (error) {
                  toast({
                    title: 'Could not create campaign',
                    description: (error as Error).message,
                    tone: 'error',
                  })
                }
              }}
            >
              <Plus />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Duplicate template"
              onClick={async () => {
                await templateServerFns.duplicate({ data: { id: row.id } })
                toast({ title: 'Template duplicated', tone: 'success' })
                await refetch()
              }}
            >
              <Copy />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Delete template"
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
        title="Templates"
        description="Reusable designs. Turn any template into a campaign without leaving the editor."
        actions={
          <Button variant="primary" size="sm" onClick={() => setEditing('new')}>
            <Plus />
            New template
          </Button>
        }
      />

      <DataTable
        columns={columns}
        rows={data}
        rowKey={(row) => row.id}
        loading={isPending && !data}
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value)
          setPage(1)
        }}
        searchPlaceholder="Search templates…"
        page={page}
        pageSize={Math.max(1, data?.length ?? 1)}
        total={data?.length ?? 0}
        onPageChange={setPage}
        toolbar={
          <SegmentedControl
            size="sm"
            value={filter}
            onChange={(value) => {
              setFilter(value)
              setPage(1)
            }}
            options={[
              { value: 'all', label: 'All' },
              ...(
                [
                  'newsletter',
                  'welcome',
                  'product_update',
                  'transactional',
                  'promotion',
                  'onboarding',
                ] as TemplateCategory[]
              ).map((category) => ({ value: category, label: category.replace('_', ' ') })),
            ]}
          />
        }
        emptyTitle="No templates yet"
        emptyDescription="Save a design once and reuse it across campaigns and automations."
        emptyAction={
          <Button variant="primary" size="sm" onClick={() => setEditing('new')}>
            Create a template
          </Button>
        }
      />

      <TemplateEditorDialog
        template={editing}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null)
          await refetch()
        }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete template"
        message={
          <>
            <strong>{deleting?.name}</strong> will be removed. Campaigns already
            created from it keep their own copy of the content.
          </>
        }
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleting) return
          await templateServerFns.remove({ data: { id: deleting.id } })
          toast({ title: 'Template deleted', tone: 'success' })
          await refetch()
        }}
      />
    </div>
  )
}

function TemplateEditorDialog({
  template,
  onClose,
  onSaved,
}: {
  template: EmailTemplate | 'new' | null
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const isNew = template === 'new'
  const existing = isNew ? null : template

  const [name, setName] = useState(existing?.name ?? 'Untitled template')
  const [category, setCategory] = useState<TemplateCategory>(
    existing?.category ?? 'newsletter',
  )
  const [subject, setSubject] = useState(existing?.subject ?? '')
  const [preheader, setPreheader] = useState(existing?.preheader ?? '')
  const [document, setDocument] = useState<EmailDocument>(
    existing?.document ?? STARTER_DOCUMENT,
  )
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()
  const [hydratedFor, setHydratedFor] = useState<string | null>(null)

  // Reset the form when a different template is opened.
  const key = existing?.id ?? (isNew ? 'new' : 'none')
  if (key !== hydratedFor) {
    setHydratedFor(key)
    setName(existing?.name ?? 'Untitled template')
    setCategory(existing?.category ?? 'newsletter')
    setSubject(existing?.subject ?? '')
    setPreheader(existing?.preheader ?? '')
    setDocument(existing?.document ?? STARTER_DOCUMENT)
  }

  const save = async () => {
    setBusy(true)
    try {
      if (existing) {
        await templateServerFns.update({
          data: {
            id: existing.id,
            name,
            category,
            subject,
            preheader: preheader || null,
            document,
          },
        })
        toast({ title: 'Template saved', tone: 'success' })
      } else {
        await templateServerFns.create({
          data: { name, category, subject, preheader: preheader || null, document },
        })
        toast({ title: 'Template created', tone: 'success' })
      }
      await onSaved()
    } catch (error) {
      toast({
        title: 'Could not save template',
        description: (error as Error).message,
        tone: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={Boolean(template)}
      onOpenChange={(open) => !open && onClose()}
      title={existing ? 'Edit template' : 'New template'}
      size="xl"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            disabled={!name.trim()}
            onClick={save}
          >
            {existing ? 'Save template' : 'Create template'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Category">
            <Select
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as TemplateCategory)
              }
            >
              {(
                [
                  'newsletter',
                  'welcome',
                  'product_update',
                  'transactional',
                  'promotion',
                  'onboarding',
                ] as TemplateCategory[]
              ).map((value) => (
                <option key={value} value={value}>
                  {value.replace('_', ' ')}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="overflow-hidden rounded-md border border-border">
          <EmailEditor
            document={document}
            subject={subject}
            preheader={preheader}
            onChange={setDocument}
            onSubjectChange={setSubject}
            onPreheaderChange={setPreheader}
          />
        </div>
      </div>
    </Dialog>
  )
}
