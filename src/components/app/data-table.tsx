import * as React from 'react'
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
import { cn, formatNumber } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Checkbox, Input, Select } from '@/components/ui/input'
import { EmptyState, ErrorState } from '@/components/ui/tabs'
import { SkeletonRows } from '@/components/ui/spinner'

/**
 * The dense data table used across the product.
 *
 * Every list in the dashboard shares this one component so pagination, search,
 * sorting, selection, loading and empty states behave identically — and so a new
 * resource does not have to re-implement them.
 */

export type Column<T> = {
  key: string
  header: React.ReactNode
  /** Cell renderer. */
  cell: (row: T) => React.ReactNode
  sortValue?: (row: T) => string | number
  className?: string
  headerClassName?: string
  align?: 'left' | 'right' | 'center'
  width?: string
}

export type DataTableProps<T> = {
  columns: Column<T>[]
  rows: T[] | undefined
  rowKey: (row: T) => string
  loading?: boolean
  error?: string | null
  onRetry?: () => void

  // search
  searchValue?: string
  onSearchChange?: (value: string) => void
  searchPlaceholder?: string

  // sorting
  sort?: string
  onSortChange?: (key: string) => void

  // selection
  selectable?: boolean
  selected?: string[]
  onSelectedChange?: (ids: string[]) => void

  // pagination
  page?: number
  pageSize?: number
  total?: number
  onPageChange?: (page: number) => void
  onPageSizeChange?: (pageSize: number) => void

  // empty / toolbar
  emptyTitle?: string
  emptyDescription?: React.ReactNode
  emptyAction?: React.ReactNode
  toolbar?: React.ReactNode
  bulkActions?: (ids: string[], clear: () => void) => React.ReactNode
  onRowClick?: (row: T) => void
  className?: string
  rowHeight?: 'sm' | 'md'
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  error = null,
  onRetry,
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search…',
  sort,
  onSortChange,
  selectable = false,
  selected = [],
  onSelectedChange,
  page = 1,
  pageSize = 25,
  total,
  onPageChange,
  onPageSizeChange,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  emptyAction,
  toolbar,
  bulkActions,
  onRowClick,
  className,
  rowHeight = 'md',
}: DataTableProps<T>) {
  const allIds = rows?.map(rowKey) ?? []
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.includes(id))
  const someSelected = selected.length > 0 && !allSelected

  const toggleAll = () => {
    if (!onSelectedChange) return
    onSelectedChange(allSelected ? [] : allIds)
  }

  const toggleOne = (id: string) => {
    if (!onSelectedChange) return
    onSelectedChange(
      selected.includes(id)
        ? selected.filter((value) => value !== id)
        : [...selected, id],
    )
  }

  const count = total ?? rows?.length ?? 0
  const pageCount = Math.max(1, Math.ceil(count / pageSize))

  return (
    <div
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card',
        className,
      )}
    >
      {/* toolbar ------------------------------------------------------- */}
      {toolbar || onSearchChange || bulkActions ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          {onSearchChange ? (
            <div className="relative min-w-48 flex-1 sm:max-w-72">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchValue ?? ''}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder={searchPlaceholder}
                className="pl-7 pr-7"
              />
              {searchValue ? (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => onSearchChange('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </div>
          ) : null}
          {selected.length > 0 && bulkActions
            ? bulkActions(selected, () => onSelectedChange?.([]))
            : null}
          <div className="ml-auto flex items-center gap-2">{toolbar}</div>
        </div>
      ) : null}

      {/* header ------------------------------------------------------- */}
      {!loading && !error && rows && rows.length > 0 ? (
        <div className="flex items-center gap-3 border-b border-border bg-subtle px-3 py-1.5">
          {selectable ? (
            <Checkbox
              checked={allSelected}
              ref={undefined}
              aria-label="Select all rows"
              onChange={toggleAll}
              className={cn(someSelected && 'opacity-60')}
            />
          ) : null}
          <div className="flex min-w-0 flex-1 items-center">
            {columns.map((column) => {
              const sortable = Boolean(column.sortValue && onSortChange)
              const active = sort === column.key
              return (
                <div
                  key={column.key}
                  className={cn(
                    'min-w-0 truncate px-2 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground',
                    column.align === 'right' && 'text-right',
                    column.align === 'center' && 'text-center',
                    column.headerClassName,
                    column.width,
                    sortable && 'cursor-pointer select-none hover:text-foreground',
                  )}
                  style={column.width ? undefined : { flex: 1 }}
                  onClick={
                    sortable
                      ? () => onSortChange?.(column.key)
                      : undefined
                  }
                >
                  <span className="inline-flex items-center gap-1">
                    {column.header}
                    {sortable ? (
                      <span
                        className={cn(
                          'text-[9px]',
                          active ? 'text-foreground' : 'text-transparent',
                        )}
                      >
                        {active ? '▼' : '▼'}
                      </span>
                    ) : null}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}

      {/* body --------------------------------------------------------- */}
      {loading ? (
        <SkeletonRows rows={8} columns={columns.length} />
      ) : error ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : !rows || rows.length === 0 ? (
        <EmptyState
          title={emptyTitle}
          description={emptyDescription}
          action={emptyAction}
        />
      ) : (
        <div className="min-w-0 flex-1 overflow-x-auto">
          {rows.map((row) => {
            const id = rowKey(row)
            const isSelected = selected.includes(id)
            return (
              <div
                key={id}
                onClick={() => onRowClick?.(row)}
                className={cn(
                  'flex items-center gap-3 border-b border-border px-3 transition-colors duration-100 last:border-b-0',
                  rowHeight === 'md' ? 'py-2' : 'py-1.5',
                  onRowClick && 'cursor-pointer hover:bg-muted/60',
                  isSelected && 'bg-accent/50',
                )}
              >
                {selectable ? (
                  <span onClick={(event) => event.stopPropagation()}>
                    <Checkbox
                      checked={isSelected}
                      aria-label="Select row"
                      onChange={() => toggleOne(id)}
                    />
                  </span>
                ) : null}
                {columns.map((column) => (
                  <div
                    key={column.key}
                    className={cn(
                      'min-w-0 flex-1 truncate text-[13px]',
                      column.align === 'right' && 'text-right',
                      column.align === 'center' && 'text-center',
                      column.className,
                    )}
                  >
                    {column.cell(row)}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}

      {/* footer ------------------------------------------------------- */}
      {rows && rows.length > 0 ? (
        <div className="flex items-center justify-between gap-3 border-t border-border bg-subtle px-3 py-2">
          <p className="text-[11px] text-muted-foreground">
            {formatNumber((page - 1) * pageSize + 1)}–
            {formatNumber(Math.min(page * pageSize, count))} of{' '}
            <span data-numeric className="text-foreground">
              {formatNumber(count)}
            </span>
          </p>

          <div className="flex items-center gap-2">
            {onPageSizeChange ? (
              <Select
                value={String(pageSize)}
                onChange={(event) =>
                  onPageSizeChange(Number(event.target.value))
                }
                className="h-7 w-auto text-[11px]"
                aria-label="Rows per page"
              >
                {[25, 50, 100].map((size) => (
                  <option key={size} value={size}>
                    {size} / page
                  </option>
                ))}
              </Select>
            ) : null}

            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Previous page"
                disabled={page <= 1}
                onClick={() => onPageChange?.(page - 1)}
              >
                <ChevronLeft />
              </Button>
              <span
                data-numeric
                className="min-w-16 text-center text-[11px] text-muted-foreground"
              >
                {page} / {pageCount}
              </span>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Next page"
                disabled={page >= pageCount}
                onClick={() => onPageChange?.(page + 1)}
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}