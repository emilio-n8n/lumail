import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-muted text-muted-foreground',
        outline: 'border-border-strong bg-transparent text-foreground',
        primary: 'border-primary/40 bg-primary-muted text-primary-foreground-muted',
        success: 'border-success/30 bg-success-muted text-success',
        warning: 'border-warning/30 bg-warning-muted text-warning',
        destructive: 'border-destructive/30 bg-destructive-muted text-destructive',
        info: 'border-info/30 bg-info-muted text-info',
        accent: 'border-primary/40 bg-accent text-accent-foreground',
      },
      dot: {
        true: '[&::before]:size-1.5 [&::before]:rounded-full [&::before]:bg-current',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants>

export function Badge({ className, tone, dot, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone, dot }), className)} {...props} />
  )
}

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-card text-card-foreground',
        className,
      )}
      {...props}
    />
  )
}

export function CardHeader({
  className,
  title,
  description,
  action,
}: {
  className?: string
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 border-b border-border px-4 py-3',
        className,
      )}
    >
      <div className="min-w-0">
        <h3 className="truncate text-[13px] font-semibold tracking-tight">
          {title}
        </h3>
        {description ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

export function Separator({
  className,
  orientation = 'horizontal',
}: {
  className?: string
  orientation?: 'horizontal' | 'vertical'
}) {
  return (
    <div
      role="separator"
      className={cn(
        'bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
    />
  )
}

export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        'inline-flex h-4 min-w-4 items-center justify-center rounded-xs border border-border bg-muted px-1 font-mono text-[10px] text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}