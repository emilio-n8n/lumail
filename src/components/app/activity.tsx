import * as React from 'react'
import {
  ArrowRight,
  Ban,
  Check,
  CircleDot,
  Mail,
  MousePointerClick,
  PenLine,
  RefreshCw,
  Sparkles,
  Tag,
  Undo2,
  UserPlus,
  Workflow,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/tabs'
import { cn, formatRelative, truncate } from '@/lib/utils'
import type { ActivityItem, EventType } from '@/lib/domain/types'

/**
 * The activity stream, rendered identically on the overview and on a contact
 * profile. One component so an event always looks the same wherever it appears.
 */

const EVENT_META: Record<
  EventType,
  { icon: React.ComponentType<{ className?: string }>; label: string; tone: string }
> = {
  created: { icon: UserPlus, label: 'was added', tone: 'text-info' },
  updated: { icon: PenLine, label: 'was updated', tone: 'text-muted-foreground' },
  tag_added: { icon: Tag, label: 'was tagged', tone: 'text-muted-foreground' },
  tag_removed: { icon: Tag, label: 'lost a tag', tone: 'text-muted-foreground' },
  segment_added: { icon: CircleDot, label: 'joined a segment', tone: 'text-info' },
  segment_removed: {
    icon: CircleDot,
    label: 'left a segment',
    tone: 'text-muted-foreground',
  },
  queued: { icon: Mail, label: 'was queued', tone: 'text-muted-foreground' },
  sent: { icon: Mail, label: 'was sent', tone: 'text-muted-foreground' },
  delivered: { icon: Check, label: 'was delivered', tone: 'text-success' },
  opened: { icon: Sparkles, label: 'opened', tone: 'text-primary-foreground-muted' },
  clicked: { icon: MousePointerClick, label: 'clicked', tone: 'text-primary-foreground-muted' },
  bounced: { icon: Ban, label: 'bounced', tone: 'text-destructive' },
  complained: { icon: Ban, label: 'complained', tone: 'text-destructive' },
  unsubscribed: { icon: Undo2, label: 'unsubscribed', tone: 'text-warning' },
  purchased: { icon: Sparkles, label: 'purchased', tone: 'text-success' },
  workflow_enrolled: {
    icon: Workflow,
    label: 'entered an automation',
    tone: 'text-info',
  },
  workflow_completed: {
    icon: Workflow,
    label: 'completed an automation',
    tone: 'text-success',
  },
  custom: { icon: RefreshCw, label: 'event', tone: 'text-info' },
}

export function ActivityTimeline({
  items,
  limit,
  showContact = true,
  emptyTitle = 'No activity yet',
  emptyDescription,
  className,
  onOpenContact,
}: {
  items: ActivityItem[]
  limit?: number
  showContact?: boolean
  emptyTitle?: string
  emptyDescription?: string
  className?: string
  onOpenContact?: (contactId: string) => void
}) {
  const visible = limit ? items.slice(0, limit) : items

  if (visible.length === 0) {
    return (
      <EmptyState compact title={emptyTitle} description={emptyDescription} />
    )
  }

  return (
    <div className={cn('divide-y divide-border', className)}>
      {visible.map((item) => {
        const meta = EVENT_META[item.eventType] ?? EVENT_META.custom
        const Icon = meta.icon
        return (
          <div
            key={item.id}
            className="flex items-center gap-2.5 px-4 py-2 transition-colors hover:bg-muted/40"
          >
            <Icon className={cn('size-3.5 shrink-0', meta.tone)} />

            <div className="min-w-0 flex-1 text-[12.5px]">
              {showContact && item.contactEmail ? (
                <>
                  {onOpenContact ? (
                    <button
                      type="button"
                      onClick={() => onOpenContact(item.contactId!)}
                      className="font-medium hover:underline"
                    >
                      {item.contactEmail}
                    </button>
                  ) : (
                    <span className="font-medium">{item.contactEmail}</span>
                  )}
                  <span className="text-muted-foreground"> {meta.label}</span>
                </>
              ) : (
                <span className="text-muted-foreground">{meta.label}</span>
              )}

              {item.campaignName ? (
                <span className="text-muted-foreground">
                  {' '}
                  · {truncate(item.campaignName, 32)}
                </span>
              ) : null}

              {item.url ? (
                <span className="text-muted-foreground"> · {truncate(item.url, 40)}</span>
              ) : null}

              {typeof item.metadata?.tag === 'string' ? (
                <Badge tone="neutral" className="ml-1.5 align-middle">
                  {item.metadata.tag}
                </Badge>
              ) : null}
            </div>

            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              {formatRelative(item.occurredAt)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function EventBadge({ eventType }: { eventType: EventType }) {
  const meta = EVENT_META[eventType] ?? EVENT_META.custom
  const tone =
    meta.tone === 'text-success'
      ? 'success'
      : meta.tone === 'text-destructive'
        ? 'destructive'
        : meta.tone === 'text-warning'
          ? 'warning'
          : meta.tone.includes('primary')
            ? 'primary'
            : meta.tone === 'text-info'
              ? 'info'
              : 'neutral'

  return (
    <Badge tone={tone}>
      <ArrowRight className="size-2.5 rotate-180" />
      {meta.label}
    </Badge>
  )
}
