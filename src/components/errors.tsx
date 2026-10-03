import { Link } from '@tanstack/react-router'
import { buttonVariants } from './ui/button'
import { cn } from '@/lib/utils'

export function NotFound() {
  return (
    <div className="dot-field flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="font-mono text-[11px] tracking-[0.2em] text-muted-foreground">
        404
      </p>
      <h1 className="font-display text-4xl tracking-tight">Page not found</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        That route does not exist. It may have been renamed, or the link is
        incomplete.
      </p>
      <Link to="/app" className={cn(buttonVariants({ variant: 'primary' }))}>
        Back to workspace
      </Link>
    </div>
  )
}

export function RouteError({ error }: { error: Error }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="font-mono text-[11px] tracking-[0.2em] text-destructive">
        ERROR
      </p>
      <h1 className="font-display text-3xl tracking-tight">
        This view could not be loaded
      </h1>
      <pre className="max-w-lg overflow-auto rounded-md border border-border bg-card p-3 text-left font-mono text-xs text-muted-foreground">
        {error.message}
      </pre>
      <Link to="/app" className={cn(buttonVariants({ variant: 'outline' }))}>
        Back to workspace
      </Link>
    </div>
  )
}