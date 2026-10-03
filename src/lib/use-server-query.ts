import * as React from 'react'
import {
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'

/**
 * Query hook for server functions.
 *
 * TanStack Start server functions are plain async RPC endpoints; this wraps them
 * in TanStack Query so every read in the dashboard gets caching, request
 * de-duplication, retries and a stable cache key derived from the server
 * function's own identity.
 */

type ServerFnLike<TInput, TOutput> = ((opts: { data: TInput }) => Promise<TOutput>) & {
  url: string
  method: string
}

export function useServerQuery<TInput, TOutput>(
  fn: ServerFnLike<TInput, TOutput>,
  input: TInput,
  options?: {
    enabled?: boolean
    placeholderData?: (previous: TOutput | undefined) => TOutput | undefined
    staleTime?: number
  },
): UseQueryResult<TOutput, Error> {
  const queryClient = useQueryClient()
  const key = React.useMemo(
    () => ['server-fn', fn.method, fn.url, input] as const,
    [fn.method, fn.url, input],
  )

  return useQuery({
    queryKey: key,
    queryFn: () => fn({ data: input }),
    enabled: options?.enabled ?? true,
    placeholderData: options?.placeholderData as never,
    staleTime: options?.staleTime ?? 10_000,
    retry: 1,
  })
}

/**
 * Mutates through a server function and invalidates the queries it affects.
 * Optimistic UI and rollback are left to the caller, which knows the shape.
 */
export function useServerMutation<TInput, TOutput>(
  fn: ServerFnLike<TInput, TOutput>,
  options?: {
    invalidate?: string[][]
    onSuccess?: (data: TOutput) => void
    onError?: (error: Error) => void
  },
) {
  const queryClient = useQueryClient()
  const [isPending, setPending] = React.useState(false)

  const mutateAsync = React.useCallback(
    async (input: TInput) => {
      setPending(true)
      try {
        const result = await fn({ data: input })
        for (const queryKey of options?.invalidate ?? []) {
          void queryClient.invalidateQueries({ queryKey })
        }
        options?.onSuccess?.(result)
        return result
      } catch (error) {
        options?.onError?.(error as Error)
        throw error
      } finally {
        setPending(false)
      }
    },
    [fn, queryClient, options],
  )

  return { mutateAsync, isPending }
}

/**
 * Invalidates every server-function query in the cache. The dashboard is small
 * and every mutation here changes shared aggregates (counts, segments, analytics),
 * so a blanket refresh is both simpler and more correct than guessing prefixes.
 */
export function useInvalidateServer() {
  const queryClient = useQueryClient()
  return React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['server-fn'] })
  }, [queryClient])
}