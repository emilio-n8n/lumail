import { Link, useRouterState } from '@tanstack/react-router'
import {
  Activity,
  Blocks,
  ChevronDown,
  Gauge,
  GitBranch,
  LayoutTemplate,
  Mail,
  Moon,
  Plus,
  Send,
  Server,
  Settings,
  Sun,
  Tags,
  Users,
  Waypoints,
} from 'lucide-react'
import * as React from 'react'
import { cn } from '@/lib/utils'
import { useTheme } from '@/components/theme-provider'
import {
  DropdownMenu,
  MenuItem,
  MenuLabel,
  MenuSeparator,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/badge'
import { authServerFns } from '@/rpc/auth'
import { useToast } from '@/components/ui/toast'
import type { WorkspaceSummary } from '@/lib/domain/workspace'

/**
 * Console chrome.
 *
 * A fixed dark rail rather than a light sidebar: the workspace is the app, the
 * app is the tool, and separating chrome from content lets the data area keep a
 * single calm surface.
 */

const NAV_GROUPS: {
  label: string
  items: {
    to: string
    label: string
    icon: React.ComponentType<{ className?: string }>
    shortcut?: string
  }[]
}[] = [
  {
    label: 'Workspace',
    items: [
      { to: '/app', label: 'Overview', icon: Gauge, shortcut: 'G O' },
      { to: '/app/contacts', label: 'Contacts', icon: Users, shortcut: 'G C' },
      { to: '/app/segments', label: 'Segments', icon: Tags, shortcut: 'G S' },
    ],
  },
  {
    label: 'Messaging',
    items: [
      { to: '/app/campaigns', label: 'Campaigns', icon: Send, shortcut: 'G M' },
      { to: '/app/templates', label: 'Templates', icon: LayoutTemplate, shortcut: 'G T' },
      { to: '/app/transactional', label: 'Transactional', icon: Mail },
      { to: '/app/automations', label: 'Automations', icon: Waypoints, shortcut: 'G A' },
    ],
  },
  {
    label: 'Insight',
    items: [
      { to: '/app/analytics', label: 'Analytics', icon: Activity, shortcut: 'G N' },
      { to: '/app/assistant', label: 'Assistant', icon: Blocks },
    ],
  },
  {
    label: 'Platform',
    items: [
      { to: '/app/domains', label: 'Domains', icon: Server },
      { to: '/app/developers', label: 'Developers', icon: GitBranch },
      { to: '/app/settings', label: 'Settings', icon: Settings, shortcut: 'G ,' },
    ],
  },
]

export function Sidebar({
  workspaces,
  onCreateWorkspace,
  collapsed = false,
}: {
  workspaces: WorkspaceSummary[]
  onCreateWorkspace: () => void
  collapsed?: boolean
}) {
  const routerState = useRouterState()
  const pathname = routerState.location.pathname

  const current = workspaces.find((workspace) => workspace.isCurrent) ?? workspaces[0]

  return (
    <aside
      className={cn(
        'flex h-full flex-col border-r border-console-border bg-console text-console-foreground',
        collapsed ? 'w-12' : 'w-[212px]',
      )}
    >
      {/* brand */}
      <div
        className={cn(
          'flex h-12 shrink-0 items-center border-b border-console-border',
          collapsed ? 'justify-center px-0' : 'gap-2 px-3',
        )}
      >
        <span className="grid size-5 shrink-0 place-items-center rounded-sm bg-console-accent">
          <span className="font-mono text-[11px] font-bold text-console">
            L
          </span>
        </span>
        {!collapsed ? (
          <>
            <span className="truncate text-[13px] font-semibold tracking-tight">
              Lumail
            </span>
            <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.12em] text-console-subtle">
              beta
            </span>
          </>
        ) : null}
      </div>

      {/* workspace switcher */}
      {!collapsed && current ? (
        <div className="border-b border-console-border p-2">
          <DropdownMenu
            align="start"
            className="w-full"
            trigger={
              <div className="flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left transition-colors hover:bg-console-muted">
              <span className="grid size-5 shrink-0 place-items-center rounded-xs bg-console-muted font-mono text-[10px] font-semibold text-console-accent">
                {current.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
                {current.name}
              </span>
                <ChevronDown className="size-3 shrink-0 text-console-subtle" />
              </div>
            }
          >
            <div className="w-56">
              <MenuLabel>Workspaces</MenuLabel>
              {workspaces.map((workspace) => (
                <MenuItem
                  key={workspace.id}
                  onSelect={async () => {
                    if (workspace.isCurrent) return
                    await authServerFns.switchWorkspace({ data: { workspaceId: workspace.id } })
                    window.location.href = '/app'
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                  <span className="font-mono text-[10px] uppercase text-console-subtle">
                    {workspace.role}
                  </span>
                </MenuItem>
              ))}
              <MenuSeparator />
              <MenuItem onSelect={onCreateWorkspace}>
                <Plus className="size-3.5" />
                New workspace
              </MenuItem>
            </div>
          </DropdownMenu>
        </div>
      ) : null}

      {/* nav */}
      <nav className="min-h-0 flex-1 overflow-y-auto py-2">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-1 px-2">
            {!collapsed ? (
              <div className="px-1.5 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.1em] text-console-subtle">
                {group.label}
              </div>
            ) : (
              <div className="mx-1.5 my-2 h-px bg-console-border" />
            )}
            {group.items.map((item) => {
              const active =
                item.to === '/app'
                  ? pathname === '/app'
                  : pathname.startsWith(item.to)
              const Icon = item.icon
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    'group flex items-center gap-2 rounded-sm px-1.5 py-1.5 text-[12.5px] transition-colors duration-100',
                    active
                      ? 'bg-console-muted font-medium text-console-accent'
                      : 'text-console-foreground/80 hover:bg-console-muted hover:text-console-foreground',
                    collapsed && 'justify-center px-0',
                  )}
                  title={collapsed ? item.label : undefined}
                >
                  <Icon className="size-3.5 shrink-0" />
                  {!collapsed ? <span className="truncate">{item.label}</span> : null}
                  {!collapsed && item.shortcut && !active ? (
                    <Kbd className="ml-auto border-console-border bg-console-muted text-console-subtle opacity-0 transition-opacity group-hover:opacity-100">
                      {item.shortcut}
                    </Kbd>
                  ) : null}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      {/* footer */}
      <div className="shrink-0 border-t border-console-border p-2">
        <ThemeToggle collapsed={collapsed} />
      </div>
    </aside>
  )
}

function ThemeToggle({ collapsed }: { collapsed: boolean }) {
  const { resolved, setTheme } = useTheme()

  return (
    <button
      type="button"
      onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')}
      className={cn(
        'flex w-full items-center gap-2 rounded-sm px-1.5 py-1.5 text-[12px] text-console-foreground/80 transition-colors hover:bg-console-muted',
        collapsed && 'justify-center px-0',
      )}
    >
      {resolved === 'dark' ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
      {!collapsed ? (
        <span>{resolved === 'dark' ? 'Dark' : 'Light'}</span>
      ) : null}
    </button>
  )
}

export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: string
  description?: React.ReactNode
  actions?: React.ReactNode
  breadcrumb?: { label: string; to?: string }[]
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
      <div className="min-w-0">
        {breadcrumb?.length ? (
          <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {breadcrumb.map((crumb, index) => (
              <span key={crumb.label} className="flex items-center gap-1.5">
                {index > 0 ? <span className="text-border-strong">/</span> : null}
                {crumb.to ? (
                  <Link to={crumb.to} className="hover:text-foreground">
                    {crumb.label}
                  </Link>
                ) : (
                  <span>{crumb.label}</span>
                )}
              </span>
            ))}
          </div>
        ) : null}
        <h1 className="truncate text-[19px] font-semibold tracking-tight">
          {title}
        </h1>
        {description ? (
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function Topbar({
  user,
  onSearch,
}: {
  user: { email: string; fullName: string | null } | null
  onSearch?: () => void
}) {
  const { toast } = useToast()
  const router = useRouterState()

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-card px-4">
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-[11px] text-muted-foreground">
          {router.location.pathname}
        </p>
      </div>

      <Button variant="outline" size="sm" onClick={onSearch} className="gap-2">
        <span className="text-muted-foreground">Jump to…</span>
        <Kbd>⌘K</Kbd>
      </Button>

      <DropdownMenu
        align="end"
        trigger={
          <span className="flex items-center gap-2">
            <span className="grid size-6 place-items-center rounded-full bg-primary font-mono text-[10px] font-semibold text-primary-foreground">
              {(user?.fullName ?? user?.email ?? '··').slice(0, 2).toUpperCase()}
            </span>
          </span>
        }
      >
        <div className="w-56">
          <MenuLabel>{user?.email ?? 'Signed out'}</MenuLabel>
          <MenuSeparator />
          <MenuItem
            onSelect={async () => {
              try {
                await authServerFns.logout()
                await (await import('@/integrations/supabase/client')).supabase.auth.signOut()
                window.location.href = '/login'
              } catch (error) {
                toast({
                  title: 'Could not sign out',
                  description: (error as Error).message,
                  tone: 'error',
                })
              }
            }}
          >
            Sign out
          </MenuItem>
        </div>
      </DropdownMenu>
    </header>
  )
}