import type { SegmentCondition } from './types'

/**
 * Compiles a segment definition into a parameterised SQL predicate over the
 * contact alias `c`. Nothing is ever interpolated from user input except field
 * names, which are resolved through a fixed lookup table — values always travel
 * as bind parameters.
 *
 * The same compiler powers the dashboard segment builder, `POST /api/v1/segments`,
 * the `create_segment` MCP tool and the AI assistant, so a segment created by an
 * agent is byte-for-byte the same definition a human would have built.
 */

type ColumnRef = { kind: 'column'; sql: string; type: 'text' | 'date' | 'number' }

const CONTACT_COLUMNS: Record<string, ColumnRef> = {
  email: { kind: 'column', sql: 'c.email', type: 'text' },
  first_name: { kind: 'column', sql: 'c.first_name', type: 'text' },
  last_name: { kind: 'column', sql: 'c.last_name', type: 'text' },
  phone: { kind: 'column', sql: 'c.phone', type: 'text' },
  company: { kind: 'column', sql: 'c.company', type: 'text' },
  status: { kind: 'column', sql: 'c.status::text', type: 'text' },
  source: { kind: 'column', sql: 'c.source', type: 'text' },
  created_at: { kind: 'column', sql: 'c.created_at', type: 'date' },
  last_activity_at: { kind: 'column', sql: 'c.last_activity_at', type: 'date' },
}

const ENGAGEMENT_COUNTERS: Record<string, { status: string | null; column: 'total' | 'unique'; type: 'number' }> = {
  sent_count: { status: 'sent', column: 'total', type: 'number' },
  delivered_count: { status: 'delivered', column: 'total', type: 'number' },
  opened_count: { status: 'opened', column: 'unique', type: 'number' },
  clicked_count: { status: 'clicked', column: 'unique', type: 'number' },
  bounced_count: { status: 'bounced', column: 'total', type: 'number' },
}

export const SEGMENT_FIELDS = [
  ...Object.keys(CONTACT_COLUMNS),
  'tag',
  ...Object.keys(ENGAGEMENT_COUNTERS),
  'purchased',
  'campaign_received',
  'campaign_opened',
  'campaign_clicked',
  'event',
] as const

export const SEGMENT_OPERATORS = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'greater_than',
  'less_than',
  'before',
  'after',
  'within_last_days',
  'not_within_last_days',
  'is_empty',
  'is_not_empty',
  'in',
  'not_in',
] as const

export class CompiledSegment {
  constructor(
    readonly clause: string,
    readonly params: unknown[],
  ) {}

  static empty() {
    return new CompiledSegment('true', [])
  }
}

function param(value: unknown): string {
  return `$${value}`
}

class ParamBag {
  readonly values: unknown[] = []

  bind(value: unknown): string {
    this.values.push(value)
    return `$${this.values.length}`
  }
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function compareString(bag: ParamBag, column: string, condition: SegmentCondition): string {
  const value = condition.value ?? ''
  const op = condition.operator

  switch (op) {
    case 'equals':
      return `lower(${column}) = lower(${bag.bind(value)})`
    case 'not_equals':
      return `(${column} is null or lower(${column}) <> lower(${bag.bind(value)}))`
    case 'contains':
      return `lower(coalesce(${column}, '')) like ${bag.bind(`%${value.toLowerCase()}%`)}`
    case 'not_contains':
      return `lower(coalesce(${column}, '')) not like ${bag.bind(`%${value.toLowerCase()}%`)}`
    case 'starts_with':
      return `lower(coalesce(${column}, '')) like ${bag.bind(`${value.toLowerCase()}%`)}`
    case 'ends_with':
      return `lower(coalesce(${column}, '')) like ${bag.bind(`%${value.toLowerCase()}`)}`
    case 'in':
      return `${column} = any(${bag.bind(splitList(value))}::text[])`
    case 'not_in':
      return `(${column} is null or not (${column} = any(${bag.bind(splitList(value))}::text[])))`
    case 'is_empty':
      return `(${column} is null or ${column} = '')`
    case 'is_not_empty':
      return `(${column} is not null and ${column} <> '')`
    case 'greater_than':
      return `(${column} is not null and ${column} > ${bag.bind(value)})`
    case 'less_than':
      return `(${column} is not null and ${column} < ${bag.bind(value)})`
    default:
      return 'false'
  }
}

function compareDate(bag: ParamBag, column: string, condition: SegmentCondition): string {
  const value = condition.value ?? ''
  const op = condition.operator

  const isoValue = normaliseDate(value)

  switch (op) {
    case 'before':
      return `(${column} is not null and ${column} < ${bag.bind(isoValue)})`
    case 'after':
      return `(${column} is not null and ${column} > ${bag.bind(isoValue)})`
    case 'equals':
      return `${column} >= ${bag.bind(isoValue)} and ${column} < ${bag.bind(nextDay(isoValue))}`
    case 'not_equals':
      return `(${column} is null or not (${column} >= ${bag.bind(isoValue)} and ${column} < ${bag.bind(nextDay(isoValue))}))`
    case 'within_last_days':
      return `(${column} is not null and ${column} >= now() - (${bag.bind(Math.abs(Number(value) || 0))} || ' days')::interval)`
    case 'not_within_last_days':
      return `(${column} is null or ${column} < now() - (${bag.bind(Math.abs(Number(value) || 0))} || ' days')::interval)`
    case 'is_empty':
      return `${column} is null`
    case 'is_not_empty':
      return `${column} is not null`
    case 'greater_than':
      return `(${column} is not null and ${column} > ${bag.bind(isoValue)})`
    case 'less_than':
      return `(${column} is not null and ${column} < ${bag.bind(isoValue)})`
    default:
      return 'false'
  }
}

function compareNumber(bag: ParamBag, expression: string, condition: SegmentCondition): string {
  const value = Number(condition.value)
  if (Number.isNaN(value)) return 'false'

  switch (condition.operator) {
    case 'greater_than':
      return `(${expression}) > ${bag.bind(value)}`
    case 'less_than':
      return `(${expression}) < ${bag.bind(value)}`
    case 'equals':
      return `(${expression}) = ${bag.bind(value)}`
    case 'not_equals':
      return `(${expression}) <> ${bag.bind(value)}`
    case 'is_empty':
      return `coalesce(${expression}, 0) = 0`
    case 'is_not_empty':
      return `coalesce(${expression}, 0) > 0`
    default:
      return 'false'
  }
}

function normaliseDate(value: string): string {
  const parsed = new Date(value)
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  // Fall back to a date-only interpretation, e.g. "2025-03-01".
  const dateOnly = new Date(`${value}T00:00:00.000Z`)
  if (!Number.isNaN(dateOnly.getTime())) return dateOnly.toISOString()
  return new Date(0).toISOString()
}

function nextDay(iso: string): string {
  const date = new Date(iso)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString()
}

function compileCondition(
  bag: ParamBag,
  condition: SegmentCondition,
): string {
  const field = condition.field
  const op = condition.operator

  if (op === 'is_empty' || op === 'is_not_empty') {
    if (field === 'tag') {
      return op === 'is_empty'
        ? `not exists (select 1 from public.contact_tags ct0 join public.tags t0 on t0.id = ct0.tag_id where ct0.contact_id = c.id)`
        : `exists (select 1 from public.contact_tags ct0 join public.tags t0 on t0.id = ct0.tag_id where ct0.contact_id = c.id)`
    }
  }

  const column = CONTACT_COLUMNS[field]
  if (column) {
    return column.type === 'date'
      ? compareDate(bag, column.sql, condition)
      : compareString(bag, column.sql, condition)
  }

  switch (field) {
    case 'tag': {
      const tagName = bag.bind(condition.value ?? '')
      const existsClause = `exists (
        select 1 from public.contact_tags ct
        join public.tags t on t.id = ct.tag_id
        where ct.contact_id = c.id and lower(t.name) = lower(${tagName})
      )`
      return op === 'not_equals' || op === 'not_contains' ? `not ${existsClause}` : existsClause
    }

    case 'purchased': {
      const existsClause = `exists (
        select 1 from public.contact_events pe
        where pe.contact_id = c.id and pe.event_type = 'purchased'
      ) or lower(coalesce(c.custom_fields ->> 'purchased', 'false')) = 'true'`
      return op === 'not_equals' || op === 'not_contains' || op === 'is_empty'
        ? `not (${existsClause})`
        : existsClause
    }

    case 'event': {
      const eventName = bag.bind(condition.eventName ?? condition.value ?? '')
      const existsClause = `exists (
        select 1 from public.contact_events ee
        where ee.contact_id = c.id and ee.event_type::text = ${eventName}::text
      )`
      return op === 'not_equals' ? `not ${existsClause}` : existsClause
    }

    case 'campaign_received':
    case 'campaign_opened':
    case 'campaign_clicked': {
      const campaignId = bag.bind(condition.campaignId ?? condition.value ?? '')
      const extra =
        field === 'campaign_opened'
          ? 'and m.first_opened_at is not null'
          : field === 'campaign_clicked'
            ? 'and m.first_clicked_at is not null'
            : "and m.status not in ('bounced', 'failed', 'complained')"
      const existsClause = `exists (
        select 1 from public.email_messages m
        where m.contact_id = c.id and m.campaign_id = ${campaignId}::uuid ${extra}
      )`
      return op === 'not_equals' || op === 'not_contains' ? `not ${existsClause}` : existsClause
    }

    default: {
      const counter = ENGAGEMENT_COUNTERS[field]
      if (counter) {
        const expression = `(
          select count(*)::int from public.email_messages em
          where em.contact_id = c.id
            and em.status::text = ${bag.bind(counter.status)}::text
        )`
        return compareNumber(bag, expression, condition)
      }
      return 'false'
    }
  }
}

/**
 * @param manualContactIds contacts explicitly added to the segment
 */
export function compileSegment(
  conditions: SegmentCondition[],
  matchMode: 'all' | 'any',
  includeManuallyAdded: boolean,
  manualContactIds: string[] = [],
): CompiledSegment {
  const bag = new ParamBag()

  const compiled = conditions
    .filter((condition) => condition.field && condition.operator)
    .map((condition) => compileCondition(bag, condition))

  const parts: string[] = [...compiled]

  if (includeManuallyAdded && manualContactIds.length > 0) {
    parts.push(`c.id = any(${bag.bind(manualContactIds)}::uuid[])`)
  }

  let clause: string
  if (parts.length === 0) {
    clause = includeManuallyAdded ? 'false' : 'true'
  } else if (matchMode === 'any') {
    clause = `(${parts.join(' or ')})`
  } else {
    clause = `(${parts.join(' and ')})`
  }

  return new CompiledSegment(clause, bag.values)
}

/** Human-readable summary used in list rows and by the AI assistant. */
export function describeCondition(condition: SegmentCondition): string {
  const value = condition.value === '' ? '—' : condition.value
  const labels: Record<string, string> = {
    equals: 'is',
    not_equals: 'is not',
    contains: 'contains',
    not_contains: 'does not contain',
    starts_with: 'starts with',
    ends_with: 'ends with',
    greater_than: '>',
    less_than: '<',
    before: 'before',
    after: 'after',
    within_last_days: 'within last (days)',
    not_within_last_days: 'not within last (days)',
    is_empty: 'is empty',
    is_not_empty: 'is not empty',
    in: 'is one of',
    not_in: 'is not one of',
  }
  return `${condition.field.replace(/_/g, ' ')} ${labels[condition.operator] ?? condition.operator} ${value}`
}

export { param }