import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { Outlet } from '@tanstack/react-router'
import { useState } from 'react'
import * as React from 'react'
import { PageHeader, Sidebar, Topbar } from '@/components/app/shell'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { settingsServerFns } from '@/server/workflows'
import { authServerFns } from '@/server/auth'
import { CommandPalette } from '@/components/app/command-palette'
import { useServerQuery } from '@/lib/use-server-query'
import { Skeleton } from '@/components/ui/spinner'

/**
 * Dashboard shell.
 *
 * `beforeLoad` runs on both the server and the client, so an unauthenticated
 * request never renders application data — it redirects before any loader runs.
 */

export const Route = createFileRoute('/app')({
  beforeLoad: async () => {
    const { authenticated } = await authServerFns.whoami()
    if (!authenticated) throw redirect({ to: '/login' })
  },
  component: DashboardLayout,
})

function DashboardLayout() {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const { toast } = useToast()
  const navigate = useNavigate()

  // Boot the durable job worker once per browser session. It then runs for the
  // lifetime of the server process.
  React.useEffect(() => {
    const ping = () => void fetch('/api/internal/jobs').catch(() => undefined)
    ping()
    const timer = window.setInterval(ping, 15_000)
    return () => window.clearInterval(timer)
  }, [])

  const { data: context, error, refetch, isFetching } = useServerQuery(
    settingsServerFns.context,
    undefined as never,
  )

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Everything below needs the workspace context, and every hook above runs
  // unconditionally so the order stays stable across renders.
  if (error && !context) return <ShellError error={error} onRetry={() => void refetch()} />
  if (!context) return <ShellSkeleton />

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar
        workspaces={context.workspaces}
        onCreateWorkspace={() => setCreating(true)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          user={context.user}
          onSearch={() => setPaletteOpen(true)}
        />

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1440px] px-6 py-5">
            <Outlet />
          </div>
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
      />

      <CreateWorkspaceDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={async (workspaceId) => {
          await authServerFns.switchWorkspace({ data: { workspaceId } })
          toast({ title: 'Workspace created', tone: 'success' })
          navigate({ to: '/app' })
          window.location.reload()
        }}
      />
    </div>
  )
}

/**
 * A failed context query used to leave the dashboard on its skeleton forever,
 * silently: React Query keeps the error, so nothing reached the console. This
 * is what the operator sees instead.
 */
function ShellError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <div className="flex h-screen items-center justify-center bg-background px-6">
      <div className="max-w-md border border-border bg-card p-6">
        <h1 className="text-sm font-medium text-foreground">
          Could not load the workspace
        </h1>
        <p className="mt-2 text-[13px] text-muted-foreground">
          The dashboard needs its workspace context before it can render
          anything. The request failed:
        </p>
        <p className="mt-3 border-l-2 border-border bg-subtle px-3 py-2 font-mono text-[12px] text-muted-foreground">
          {error.message}
        </p>
        <Button variant="primary" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </div>
  )
}

function ShellSkeleton() {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <div className="w-[212px] border-r border-console-border bg-console" />
      <div className="flex-1 p-6">
        <Skeleton className="h-8 w-52" />
        <div className="mt-6 grid grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-[86px]" />
          ))}
        </div>
      </div>
    </div>
  )
}

export { PageHeader }

function CreateWorkspaceDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (workspaceId: string) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New workspace"
      description="Workspaces isolate every contact, campaign and automation."
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
                const workspace = await settingsServerFns.createWorkspace({
                  data: { name: name.trim() },
                })
                await onCreated(workspace.id)
                setName('')
                onOpenChange(false)
              } catch (error) {
                toast({
                  title: 'Could not create workspace',
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
      <Field label="Name" htmlFor="workspace-name">
        <Input
          id="workspace-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Acme Marketing"
          autoFocus
        />
      </Field>
    </Dialog>
  )
}