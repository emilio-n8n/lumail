import { useMemo, useId, useState } from 'react'
import { cn, formatNumber } from '@/lib/utils'

/**
 * Charts.
 *
 * Hand-drawn SVG rather than a charting library: the visual language (hairline
 * grid, tabular numerals, 120ms transitions) is part of the product's identity,
 * and every value here comes from the design tokens.
 */

const AXIS = 'var(--color-chart-grid)'
const SERIES = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
]

export type SeriesConfig = {
  key: string
  label: string
  color?: string
}

/* ------------------------------------------------------------ area chart */

export function AreaChart({
  data,
  series,
  height = 180,
  className,
  formatValue = formatNumber,
}: {
  data: Record<string, unknown>[]
  series: SeriesConfig[]
  height?: number
  className?: string
  formatValue?: (value: number) => string
}) {
  const gradientId = useId()
  const [hover, setHover] = useState<number | null>(null)

  const { paths, max, labels } = useMemo(() => {
    const values = series.flatMap((item) =>
      data.map((row) => Number(row[item.key] ?? 0)),
    )
    const peak = Math.max(1, ...values)
    const width = 100
    const step = data.length > 1 ? width / (data.length - 1) : width

    const built = series.map((item, seriesIndex) => {
      const points = data.map((row, index) => {
        const value = Number(row[item.key] ?? 0)
        const x = data.length > 1 ? index * step : width / 2
        const y = 100 - (value / peak) * 100
        return { x, y, value }
      })

      const line = points
        .map((point, index) =>
          index === 0
            ? `M ${point.x} ${point.y}`
            : `L ${point.x} ${point.y}`,
        )
        .join(' ')

      const area =
        points.length > 0
          ? `${line} L ${points[points.length - 1]!.x} 100 L ${points[0]!.x} 100 Z`
          : ''

      return {
        line,
        area,
        points,
        color: item.color ?? SERIES[seriesIndex % SERIES.length]!,
      }
    })

    return { paths: built, max: peak, labels: data.map((row) => String(row.date)) }
  }, [data, series])

  if (data.length === 0) {
    return (
      <div
        className={cn(
          'flex items-center justify-center border border-dashed border-border text-xs text-muted-foreground',
          className,
        )}
        style={{ height }}
      >
        No activity in this range yet
      </div>
    )
  }

  return (
    <div className={cn('relative', className)}>
      <div className="pointer-events-auto absolute inset-0 flex">
        {data.map((_, index) => (
          <div
            key={index}
            className="flex-1"
            onMouseEnter={() => setHover(index)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </div>

      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ height }}
        className="w-full"
        role="img"
        aria-label={`${series.map((item) => item.label).join(', ')} over time`}
      >
        <defs>
          {paths.map((path, index) => (
            <linearGradient
              key={index}
              id={`${gradientId}-${index}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor={path.color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={path.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        {[0, 25, 50, 75, 100].map((y) => (
          <line
            key={y}
            x1="0"
            y1={y}
            x2="100"
            y2={y}
            stroke={AXIS}
            strokeWidth="0.4"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {paths.map((path, index) => (
          <g key={index}>
            <path d={path.area} fill={`url(#${gradientId}-${index})`} />
            <path
              d={path.line}
              fill="none"
              stroke={path.color}
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </g>
        ))}

        {hover !== null
          ? paths.map((path, index) => {
              const point = path.points[hover]
              if (!point) return null
              return (
                <circle
                  key={index}
                  cx={point.x}
                  cy={point.y}
                  r="1.6"
                  fill={path.color}
                  vectorEffect="non-scaling-stroke"
                />
              )
            })
          : null}
      </svg>

      {hover !== null ? (
        <div className="pointer-events-none absolute top-0 rounded-md border border-border bg-popover px-2 py-1.5 text-[11px] shadow-[0_8px_24px_-8px_rgb(0_0_0/0.25)]">
          <div className="font-mono text-[10px] text-muted-foreground">
            {labels[hover]}
          </div>
          <div className="mt-1 space-y-0.5">
            {series.map((item, index) => (
              <div key={item.key} className="flex items-center gap-2">
                <span
                  className="size-1.5 rounded-full"
                  style={{
                    backgroundColor:
                      item.color ?? SERIES[index % SERIES.length],
                  }}
                />
                <span className="text-muted-foreground">{item.label}</span>
                <span data-numeric className="ml-auto pl-3 font-medium">
                  {formatValue(Number(data[hover]?.[item.key] ?? 0))}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-2 flex items-center gap-4">
        {series.map((item, index) => (
          <div key={item.key} className="flex items-center gap-1.5 text-[11px]">
            <span
              className="size-1.5 rounded-full"
              style={{ backgroundColor: item.color ?? SERIES[index % SERIES.length] }}
            />
            <span className="text-muted-foreground">{item.label}</span>
          </div>
        ))}
        <span data-numeric className="ml-auto text-[11px] text-muted-foreground">
          peak {formatValue(max)}
        </span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- bar chart */

export function BarChart({
  data,
  valueKey,
  labelKey = 'label',
  color = 'var(--color-chart-1)',
  height = 160,
  className,
  formatValue = formatNumber,
}: {
  data: Record<string, unknown>[]
  valueKey: string
  labelKey?: string
  color?: string
  height?: number
  className?: string
  formatValue?: (value: number) => string
}) {
  const max = Math.max(1, ...data.map((row) => Number(row[valueKey] ?? 0)))

  return (
    <div className={cn('flex items-end gap-1', className)} style={{ height }}>
      {data.map((row, index) => {
        const value = Number(row[valueKey] ?? 0)
        const ratio = value / max
        return (
          <div
            key={index}
            className="group relative flex flex-1 flex-col justify-end"
            style={{ height: '100%' }}
          >
            <div
              className="w-full rounded-t-xs transition-[height] duration-200"
              style={{
                height: `${Math.max(ratio * 100, value > 0 ? 2 : 0)}%`,
                backgroundColor: color,
                opacity: value > 0 ? 1 : 0.15,
              }}
            />
            <div className="pointer-events-none absolute -top-7 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded border border-border bg-popover px-1.5 py-0.5 text-[10px] group-hover:block">
              {String(row[labelKey])} · {formatValue(value)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* --------------------------------------------------------------- funnel */

export function Funnel({
  stages,
  className,
}: {
  stages: { stage: string; value: number }[]
  className?: string
}) {
  const top = Math.max(1, stages[0]?.value ?? 1)

  return (
    <div className={cn('space-y-2', className)}>
      {stages.map((stage, index) => {
        const ratio = stage.value / top
        const conversion = top > 0 ? stage.value / top : 0
        return (
          <div key={stage.stage} className="group">
            <div className="flex items-baseline justify-between text-[11px]">
              <span className="text-muted-foreground">{stage.stage}</span>
              <span className="flex items-baseline gap-2">
                <span data-numeric className="font-medium">
                  {formatNumber(stage.value)}
                </span>
                {index > 0 ? (
                  <span data-numeric className="text-muted-foreground">
                    {(conversion * 100).toFixed(1)}%
                  </span>
                ) : null}
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full transition-[width] duration-300"
                style={{
                  width: `${Math.max(ratio * 100, stage.value > 0 ? 2 : 0)}%`,
                  backgroundColor: SERIES[index % SERIES.length],
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------ sparkline */

export function Sparkline({
  values,
  className,
  color = 'var(--color-chart-1)',
}: {
  values: number[]
  className?: string
  color?: string
}) {
  if (values.length < 2) return null
  const max = Math.max(1, ...values)
  const step = 100 / (values.length - 1)
  const path = values
    .map((value, index) => {
      const x = index * step
      const y = 30 - (value / max) * 30
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`
    })
    .join(' ')

  return (
    <svg
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
      className={cn('h-8 w-full', className)}
      aria-hidden="true"
    >
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

/* --------------------------------------------------------- progress bar */

export function ProgressBar({
  value,
  tone = 'primary',
  className,
}: {
  value: number
  tone?: 'primary' | 'success' | 'warning' | 'destructive' | 'info'
  className?: string
}) {
  const color = {
    primary: 'bg-primary',
    success: 'bg-success',
    warning: 'bg-warning',
    destructive: 'bg-destructive',
    info: 'bg-info',
  }[tone]

  return (
    <div
      className={cn('h-1 w-full overflow-hidden rounded-full bg-muted', className)}
      role="progressbar"
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-300', color)}
        style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }}
      />
    </div>
  )
}