import * as React from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

type MenuContextValue = {
  open: boolean
  setOpen: (open: boolean) => void
  triggerRef: React.RefObject<HTMLButtonElement | null>
}

const MenuContext = React.createContext<MenuContextValue | null>(null)

export function DropdownMenu({
  trigger,
  children,
  align = 'end',
  className,
}: {
  trigger: React.ReactNode
  children: React.ReactNode | ((props: { close: () => void }) => React.ReactNode)
  align?: 'start' | 'end'
  className?: string
}) {
  const [open, setOpen] = React.useState(false)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])

  React.useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        !triggerRef.current?.contains(target) &&
        !(target as HTMLElement).closest?.('[data-menu-panel]')
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointer)
    }
  }, [open])

  const context = React.useMemo(
    () => ({ open, setOpen, triggerRef }),
    [open],
  )

  return (
    <MenuContext.Provider value={context}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn('inline-flex items-center', className)}
      >
        {trigger}
      </button>
      {mounted && open
        ? createPortal(
            <div
              data-menu-panel
              role="menu"
              className={cn(
                'fixed z-50 min-w-44 animate-[slide-up_100ms_ease-out] rounded-md border border-border bg-popover p-1 shadow-[0_8px_24px_-8px_rgb(0_0_0/0.25)]',
                align === 'end' ? 'right-0' : 'left-0',
              )}
              style={
                triggerRef.current
                  ? {
                      top: triggerRef.current.getBoundingClientRect().bottom + 4,
                      left:
                        align === 'end'
                          ? undefined
                          : triggerRef.current.getBoundingClientRect().left,
                      right:
                        align === 'end'
                          ? window.innerWidth -
                            triggerRef.current.getBoundingClientRect().right
                          : undefined,
                    }
                  : undefined
              }
            >
              {typeof children === 'function'
                ? children({ close: () => setOpen(false) })
                : children}
            </div>,
            document.body,
          )
        : null}
    </MenuContext.Provider>
  )
}

export function MenuItem({
  className,
  destructive,
  onSelect,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  destructive?: boolean
  onSelect?: () => void
}) {
  return (
    <button
      role="menuitem"
      type="button"
      className={cn(
        'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] transition-colors duration-100',
        destructive
          ? 'text-destructive hover:bg-destructive-muted'
          : 'text-foreground hover:bg-muted',
        'disabled:pointer-events-none disabled:opacity-45',
        className,
      )}
      onClick={onSelect}
      {...props}
    >
      {children}
    </button>
  )
}

export function MenuSeparator() {
  return <div className="my-1 h-px bg-border" role="separator" />
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-[0.07em] text-muted-foreground">
      {children}
    </div>
  )
}

export function MenuCheckbox({
  checked,
  children,
  onSelect,
}: {
  checked: boolean
  children: React.ReactNode
  onSelect?: () => void
}) {
  return (
    <button
      role="menuitemcheckbox"
      aria-checked={checked}
      type="button"
      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] transition-colors duration-100 hover:bg-muted"
      onClick={onSelect}
    >
      <span className="size-3.5 shrink-0">
        {checked ? <Check className="size-3.5" /> : null}
      </span>
      {children}
    </button>
  )
}

export function MenuSubmenu({
  label,
  children,
}: {
  label: React.ReactNode
  children: (close: () => void) => React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] hover:bg-muted"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="flex-1">{label}</span>
        <ChevronRight className="size-3.5 text-muted-foreground" />
      </button>
      {open ? (
        <div className="absolute left-full top-0 z-10 ml-1 min-w-40 rounded-md border border-border bg-popover p-1 shadow-[0_8px_24px_-8px_rgb(0_0_0/0.25)]">
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  )
}

export function useMenuContext() {
  return React.useContext(MenuContext)
}