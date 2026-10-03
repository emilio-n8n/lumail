import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

export function getQueryClient() {
  const browserClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  })
  return browserClient
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(getQueryClient)
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}