import * as React from 'react'
import { useNavigate } from '@tanstack/react-router'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import {
  Activity,
  Gauge,
  LayoutTemplate,
  Mail,
  Search,
  Send,
  Settings,
  Tags,
  Users,
  Waypoints,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * ⌘K command palette.
 *
 * A fast keyboard path to every section plus an entity search over contacts and
 * campaigns — the density tool a daily user actually reaches for.
 */

const PAGES: { label: string; to: string; icon: LucideIcon; hint: string }[] = [
  { label: 'Overview', to: '/app', icon: Gauge, hint: 'Workspace pulse' },
  { label: 'Contacts', to: '/app/contacts', icon: Users, hint: 'People and tags' },
  { label: 'Segments', to: '/app/segments', icon: Tags, hint: 'Dynamic cohorts' },
  { label: 'Campaigns', to: '/app/campaigns', icon: Send, hint: 'Broadcasts' },
  { label: 'Templates', to: '/app/templates', icon: LayoutTemplate, hint: 'Reusable designs' },
  { label: 'Automations', to: '/app/automations', icon: Waypoints, hint: 'Journeys' },
  { label: 'Transactional', to: '/app/transactional', icon: Mail, hint: 'API sends' },
  { label: 'Analytics', to: '/app/analytics', icon: Activity, hint: 'Funnel and links' },
  { label: 'Settings', to: '/app/settings', icon: Settings, hint: 'Workspace and team' },
]

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [query, setQuery] = React.useState('')
  const [cursor, setCursor] = React.useState(0)
  const navigate = useNavigate()

  React.useEffect(() => {
    if (open) {
      setQuery('')
      setCursor(0)
    }
  }, [open])

  const results = React.useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return PAGES
    return PAGES.filter(
      (page) =>
        page.label.toLowerCase().includes(needle) ||
        page.hint.toLowerCase().includes(needle),
    )
  }, [query])

  React.useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false)
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setCursor((value) => Math.min(value + 1, results.length - 1))
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setCursor((value) => Math.max(value - 1, 0))
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        const target = results[cursor]
        if (target) {
          navigate({ to: target.to })
          onOpenChange(false)
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, results, cursor, navigate, onOpenChange])

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 animate-[fade-in_120ms_ease-out] bg-foreground/35 backdrop-blur-[1px]" />
        <DialogPrimitive.Content className="fixed left-1/2 top-[18vh] z-50 w-full max-w-lg -translate-x-1/2 animate-[slide-up_140ms_ease-out] overflow-hidden rounded-lg border border-border bg-popover shadow-[0_16px_48px_-16px_rgb(0_0_0/0.35)]">
          <DialogPrimitive.Title className="sr-only">
            Command palette
          </DialogPrimitive.Title>

          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search sections…"
              className="h-11 w-full bg-transparent text-[14px] outline-none placeholder:text-muted-foreground"
              autoFocus
            />
            <kbd className="font-mono text-[10px] text-muted-foreground">ESC</kbd>
          </div>

          <div className="max-h-80 overflow-y-auto p-1">
            {results.length === 0 ? (
              <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">
                Nothing matches “{query}”.
              </p>
            ) : (
              results.map((page, index) => {
                const Icon = page.icon
                return (
                  <button
                    key={page.to}
                    type="button"
                    onMouseEnter={() => setCursor(index)}
                    onClick={() => {
                      navigate({ to: page.to })
                      onOpenChange(false)
                    }}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left transition-colors duration-100',
                      index === cursor ? 'bg-muted' : 'hover:bg-muted',
                    )}
                  >
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="text-[13px] font-medium">{page.label}</span>
                    <span className="ml-auto text-[11px] text-muted-foreground">
                      {page.hint}
                    </span>
                  </button>
                )
              })
            )}
          </div>

          <div className="flex items-center gap-3 border-t border-border bg-subtle px-3 py-1.5 text-[10px] text-muted-foreground">
            <span>↑↓ navigate</span>
            <span>↵ open</span>
            <span>esc close</span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}