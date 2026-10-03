import * as React from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Check, Info, X, OctagonAlert } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ToastTone = 'default' | 'success' | 'error' | 'warning'

export type ToastInput = {
  title: string
  description?: string
  tone?: ToastTone
  duration?: number
  action?: { label: string; onClick: () => void }
}

type ToastRecord = ToastInput & { id: string }

type ToastContextValue = {
  toast: (input: ToastInput) => string
  dismiss: (id: string) => void
}

const ToastContext = React.createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastRecord[]>([])
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])

  const dismiss = React.useCallback((id: string) => {
    setToasts((current) => current.filter((item) => item.id !== id))
  }, [])

  const toast = React.useCallback(
    (input: ToastInput) => {
      const id = Math.random().toString(36).slice(2)
      setToasts((current) => [...current.slice(-3), { ...input, id }])
      const duration = input.duration ?? (input.tone === 'error' ? 7000 : 4000)
      if (duration > 0) {
        setTimeout(() => dismiss(id), duration)
      }
      return id
    },
    [dismiss],
  )

  const value = React.useMemo(() => ({ toast, dismiss }), [toast, dismiss])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {mounted
        ? createPortal(
            <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2">
              {toasts.map((item) => (
                <div
                  key={item.id}
                  role="status"
                  className={cn(
                    'pointer-events-auto flex items-start gap-2.5 rounded-md border bg-popover p-3',
                    'animate-[slide-up_140ms_ease-out] shadow-[0_8px_24px_-8px_rgb(0_0_0/0.3)]',
                    item.tone === 'success' && 'border-success/40',
                    item.tone === 'error' && 'border-destructive/40',
                    item.tone === 'warning' && 'border-warning/40',
                  )}
                >
                  <span className="mt-0.5 shrink-0">
                    {item.tone === 'success' ? (
                      <Check className="size-4 text-success" />
                    ) : item.tone === 'error' ? (
                      <OctagonAlert className="size-4 text-destructive" />
                    ) : item.tone === 'warning' ? (
                      <AlertTriangle className="size-4 text-warning" />
                    ) : (
                      <Info className="size-4 text-muted-foreground" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium leading-snug">
                      {item.title}
                    </p>
                    {item.description ? (
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                        {item.description}
                      </p>
                    ) : null}
                    {item.action ? (
                      <button
                        type="button"
                        className="mt-1.5 text-xs font-medium underline underline-offset-4 hover:text-foreground"
                        onClick={() => {
                          item.action?.onClick()
                          dismiss(item.id)
                        }}
                      >
                        {item.action.label}
                      </button>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    aria-label="Dismiss"
                    onClick={() => dismiss(item.id)}
                    className="shrink-0 rounded-xs p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const context = React.useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used inside <ToastProvider>')
  }
  return context
}