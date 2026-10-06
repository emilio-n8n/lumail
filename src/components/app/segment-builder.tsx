import * as React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, Users } from 'lucide-react'
import { Card, CardHeader } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { segmentServerFns, metadataServerFns } from '@/rpc/contacts'
import { useServerQuery } from '@/lib/use-server-query'
import { campaignServerFns } from '@/rpc/campaigns'
import { cn, formatNumber } from '@/lib/utils'
import type {
  SegmentCondition,
  SegmentField,
  SegmentOperator,
} from '@/lib/domain/types'

/**
 * Segment builder.
 *
 * Conditions are compiled server-side into SQL, so the "matches N contacts"
 * counter is the real result of the rule, not an estimate. The same compiler
 * backs the API and the MCP `create_segment` tool.
 */

const FIELD_LABELS: Record<string, string> = {
  email: 'Email',
  first_name: 'First name',
  last_name: 'Last name',
  phone: 'Phone',
  company: 'Company',
  status: 'Status',
  source: 'Source',
  tag: 'Tag',
  created_at: 'Added on',
  last_activity_at: 'Last activity',
  sent_count: 'Emails sent',
  delivered_count: 'Emails delivered',
  opened_count: 'Times opened',
  clicked_count: 'Times clicked',
  bounced_count: 'Bounces',
  purchased: 'Purchased',
  campaign_received: 'Received campaign',
  campaign_opened: 'Opened campaign',
  campaign_clicked: 'Clicked in campaign',
  event: 'Event',
}

const DATE_FIELDS = new Set(['created_at', 'last_activity_at'])

const OPERATORS_BY_KIND: Record<
  'text' | 'date' | 'number' | 'none',
  { value: SegmentOperator; label: string }[]
> = {
  text: [
    { value: 'contains', label: 'contains' },
    { value: 'not_contains', label: 'does not contain' },
    { value: 'equals', label: 'is' },
    { value: 'not_equals', label: 'is not' },
    { value: 'starts_with', label: 'starts with' },
    { value: 'ends_with', label: 'ends with' },
    { value: 'in', label: 'is one of' },
    { value: 'not_in', label: 'is not one of' },
    { value: 'is_empty', label: 'is empty' },
    { value: 'is_not_empty', label: 'is not empty' },
  ],
  number: [
    { value: 'equals', label: 'is' },
    { value: 'greater_than', label: 'is more than' },
    { value: 'less_than', label: 'is less than' },
  ],
  date: [
    { value: 'within_last_days', label: 'in the last (days)' },
    { value: 'not_within_last_days', label: 'not in the last (days)' },
    { value: 'after', label: 'after' },
    { value: 'before', label: 'before' },
    { value: 'is_empty', label: 'is empty' },
    { value: 'is_not_empty', label: 'is set' },
  ],
  none: [
    { value: 'equals', label: 'is' },
    { value: 'not_equals', label: 'is not' },
  ],
}

function kindOf(field: SegmentField): 'text' | 'date' | 'number' | 'none' {
  if (DATE_FIELDS.has(field)) return 'date'
  if (
    ['sent_count', 'delivered_count', 'opened_count', 'clicked_count', 'bounced_count'].includes(
      field,
    )
  )
    return 'number'
  if (
    ['tag', 'purchased', 'campaign_received', 'campaign_opened', 'campaign_clicked', 'event'].includes(
      field,
    )
  )
    return 'none'
  return 'text'
}

export function SegmentBuilder({
  initialConditions = [],
  initialMatchMode = 'all',
  initialName = '',
  initialDescription = '',
  segmentId,
  onSaved,
}: {
  initialConditions?: SegmentCondition[]
  initialMatchMode?: 'all' | 'any'
  initialName?: string
  initialDescription?: string
  segmentId?: string
  onSaved?: (id: string) => void
}) {
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)
  const [matchMode, setMatchMode] = useState<'all' | 'any'>(initialMatchMode)
  const [conditions, setConditions] = useState<SegmentCondition[]>(
    initialConditions.length > 0
      ? initialConditions
      : [
          {
            id: 'initial',
            field: 'email',
            operator: 'contains',
            value: '',
            campaignId: null,
            eventName: null,
          },
        ],
  )
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()

  const { data: campaigns } = useServerQuery(campaignServerFns.list, {
    limit: 100,
  })
  const { data: metadata } = useServerQuery(
    metadataServerFns.variables,
    undefined as never,
  )

  const fields = metadata?.segmentFields ?? []
  const preview = useSegmentPreview(conditions, matchMode)

  const addCondition = () => {
    setConditions((current) => [
      ...current,
      {
        id: `c_${Date.now()}`,
        field: 'email',
        operator: 'contains',
        value: '',
        campaignId: null,
        eventName: null,
      },
    ])
  }

  const update = (id: string, patch: Partial<SegmentCondition>) => {
    setConditions((current) =>
      current.map((condition) =>
        condition.id === id ? { ...condition, ...patch } : condition,
      ),
    )
  }

  const remove = (id: string) => {
    setConditions((current) => current.filter((condition) => condition.id !== id))
  }

  const save = async () => {
    setBusy(true)
    try {
      if (segmentId) {
        await segmentServerFns.update({
          data: {
            id: segmentId,
            name,
            description: description || null,
            matchMode,
            conditions: conditions.map((condition, index) => ({
              ...condition,
              id: condition.id || `c_${index}`,
            })) as never,
          },
        })
        toast({ title: 'Segment saved', tone: 'success' })
        onSaved?.(segmentId)
      } else {
        const segment = await segmentServerFns.create({
          data: {
            name,
            description: description || null,
            matchMode,
            conditions: conditions as never,
          },
        })
        toast({ title: 'Segment created', tone: 'success' })
        onSaved?.(segment.id)
      }
    } catch (error) {
      toast({
        title: 'Could not save segment',
        description: (error as Error).message,
        tone: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor="segment-name">
          <Input
            id="segment-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Trial users, not yet converted"
          />
        </Field>
        <Field label="Description" htmlFor="segment-description">
          <Input
            id="segment-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Optional context for your team"
          />
        </Field>
      </div>

      <Card>
        <CardHeader
          title="Rules"
          description="Match contacts that satisfy"
          action={
            <Select
              value={matchMode}
              onChange={(event) =>
                setMatchMode(event.target.value as 'all' | 'any')
              }
              className="h-7 w-auto text-[12px]"
            >
              <option value="all">ALL rules</option>
              <option value="any">ANY rule</option>
            </Select>
          }
        />

        <div className="space-y-2 p-4">
          {conditions.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-muted-foreground">
              Add a rule to define this segment.
            </p>
          ) : (
            conditions.map((condition, index) => {
              const kind = kindOf(condition.field)
              const operators = OPERATORS_BY_KIND[kind]
              const needsCampaign = condition.field.startsWith('campaign_')
              const needsValue = !['is_empty', 'is_not_empty'].includes(
                condition.operator,
              )

              return (
                <div key={condition.id} className="space-y-1.5">
                  {index > 0 ? (
                    <div className="flex items-center gap-2 py-0.5">
                      <span className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                        {matchMode === 'all' ? 'and' : 'or'}
                      </span>
                      <div className="h-px flex-1 bg-border" />
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={condition.field}
                      onChange={(event) => {
                        const field = event.target.value as SegmentField
                        const nextKind = kindOf(field)
                        update(condition.id, {
                          field,
                          operator: OPERATORS_BY_KIND[nextKind][0]!.value,
                          value: '',
                        })
                      }}
                      className="h-8 w-44 shrink-0 text-[12px]"
                    >
                      {fields.map((field) => (
                        <option key={field} value={field}>
                          {FIELD_LABELS[field] ?? field}
                        </option>
                      ))}
                    </Select>

                    <Select
                      value={condition.operator}
                      onChange={(event) =>
                        update(condition.id, {
                          operator: event.target.value as SegmentOperator,
                        })
                      }
                      className="h-8 w-40 shrink-0 text-[12px]"
                    >
                      {operators.map((operator) => (
                        <option key={operator.value} value={operator.value}>
                          {operator.label}
                        </option>
                      ))}
                    </Select>

                    {needsValue ? (
                      needsCampaign ? (
                        <Select
                          value={condition.campaignId ?? ''}
                          onChange={(event) =>
                            update(condition.id, {
                              campaignId: event.target.value || null,
                            })
                          }
                          className="h-8 min-w-40 flex-1 text-[12px]"
                        >
                          <option value="">Select a campaign…</option>
                          {campaigns?.map((campaign) => (
                            <option key={campaign.id} value={campaign.id}>
                              {campaign.name}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <Input
                          value={condition.value}
                          onChange={(event) =>
                            update(condition.id, { value: event.target.value })
                          }
                          placeholder={
                            kind === 'date' && condition.operator.endsWith('days')
                              ? '30'
                              : kind === 'number'
                                ? '1'
                                : 'value'
                          }
                          className="h-8 min-w-32 flex-1 text-[12px]"
                        />
                      )
                    ) : null}

                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Remove rule"
                      onClick={() => remove(condition.id)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              )
            })
          )}

          <Button variant="outline" size="sm" onClick={addCondition}>
            <Plus />
            Add rule
          </Button>
        </div>

        <div className="flex items-center gap-2 border-t border-border bg-subtle px-4 py-2.5">
          <Users className="size-3.5 text-muted-foreground" />
          <span className="text-[12px] text-muted-foreground">
            Currently matches
          </span>
          <span data-numeric className="text-[13px] font-semibold">
            {preview === null ? '…' : formatNumber(preview)}
          </span>
          <span className="text-[12px] text-muted-foreground">
            {preview === 1 ? 'contact' : 'contacts'}
          </span>

          <div className="ml-auto">
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              disabled={!name.trim() || conditions.length === 0}
              onClick={save}
            >
              {segmentId ? 'Save changes' : 'Create segment'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}

function useSegmentPreview(
  conditions: SegmentCondition[],
  matchMode: 'all' | 'any',
): number | null {
  const [count, setCount] = useState<number | null>(null)

  const signature = useMemo(
    () => JSON.stringify({ conditions, matchMode }),
    [conditions, matchMode],
  )

  useEffect(() => {
    if (conditions.length === 0) {
      setCount(null)
      return
    }

    const hasIncomplete = conditions.some(
      (condition) =>
        !['is_empty', 'is_not_empty'].includes(condition.operator) &&
        condition.field.startsWith('campaign_') &&
        !condition.campaignId,
    )
    if (hasIncomplete) {
      setCount(null)
      return
    }

    const timer = setTimeout(async () => {
      try {
        const result = await segmentServerFns.preview({
          data: { conditions: conditions as never, matchMode },
        })
        setCount(result.count)
      } catch {
        setCount(null)
      }
    }, 350)

    return () => clearTimeout(timer)
  }, [signature, conditions, matchMode])

  return count
}