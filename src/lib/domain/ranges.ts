/** Analytics ranges. Pure data — safe to import from the browser. */

export type RangeKey = '24h' | '7d' | '30d' | '90d'

export const RANGE_OPTIONS: { value: RangeKey; label: string; days: number }[] = [
  { value: '24h', label: '24h', days: 1 },
  { value: '7d', label: '7 days', days: 7 },
  { value: '30d', label: '30 days', days: 30 },
  { value: '90d', label: '90 days', days: 90 },
]