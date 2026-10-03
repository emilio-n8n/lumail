import { cn } from '@/lib/utils'

export type StatTileProps = {
  label: string
  value: string
  change?: { value: number; label: string } | null
  hint?: string
  icon?: React.ReactNode
  tone?: 'default' | 'primary' | 'success' | 'warning' | 'destructive' | 'info'
  children?: React.ReactNode
  className?: string
}

/**
 * A single headline number. Dense by design: label, value, and one line of
 * context — no decorative framing, no gradients.
 */
export function StatTile({
  label,
  value,
  change,
  hint,
  icon,
  tone = 'default',
  children,
  className,
}: StatTileProps) {
  return (
    <div
      className={cn(
        'group relative flex flex-col justify-between rounded-lg border border-border bg-card p-3.5 transition-colors duration-100 hover:border-border-strong',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-[0.07em] text-muted-foreground">
          {label}
        </span>
        {icon ? (
          <span
            className={cn(
              'shrink-0 text-muted-foreground [&_svg]:size-3.5',
              tone === 'primary' && 'text-primary-foreground-muted',
              tone === 'success' && 'text-success',
              tone === 'warning' && 'text-warning',
              tone === 'destructive' && 'text-destructive',
            )}
          >
            {icon}
          </span>
        ) : null}
      </div>

      <div className="mt-2.5 flex items-baseline gap-2">
        <span data-numeric className="text-[22px] font-semibold leading-none tracking-tight">
          {value}
        </span>
        {change ? (
          <span
            data-numeric
            className={cn(
              'text-[11px] font-medium',
              change.value > 0
                ? 'text-success'
                : change.value < 0
                  ? 'text-destructive'
                  : 'text-muted-foreground',
            )}
          >
            {change.value > 0 ? '▲' : change.value < 0 ? '▼' : '·'}{' '}
            {Math.abs(change.value * 100).toFixed(1)}%
          </span>
        ) : null}
      </div>

      {change?.label || hint ? (
        <p className="mt-1.5 truncate text-[11px] text-muted-foreground">
          {change?.label ?? hint}
        </p>
      ) : null}

      {children ? <div className="mt-2.5">{children}</div> : null}
    </div>
  )
}

export function StatGrid({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6',
        className,
      )}
    >
      {children}
    </div>
  )
}