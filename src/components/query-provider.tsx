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
  React.useEffect(() => {
    let cancelled = false
    void Promise.all([
      import('@/integrations/supabase/client'),
      import('@/server/auth'),
    ]).then(([{ supabase }, { authServerFns }]) => {
      if (cancelled) return
      const { data } = supabase.auth.onAuthStateChange((event, session) => {
        // Keep the server-side cookie in step with refreshed access tokens so
        // server-rendered pages never see an expired one.
        if ((event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') && session) {
          void authServerFns.establish({ data: { accessToken: session.access_token } }).catch(() => undefined)
        }
      })
      cleanup = () => data.subscription.unsubscribe()
    })
    let cleanup = () => {}
    return () => {
      cancelled = true
      cleanup()
    }
  }, [])
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}