import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import appCss from '../styles.css?url'
import { QueryProvider } from '../components/query-provider'
import { ThemeProvider, themeInitScript } from '../components/theme-provider'
import { ToastProvider } from '../components/ui/toast'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      {
        name: 'description',
        content:
          'Lumail — the email operating system for humans and AI agents.',
      },
      { name: 'color-scheme', content: 'light dark' },
    ],
    links: [
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      { rel: 'stylesheet', href: appCss },
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      {
        rel: 'preconnect',
        href: 'https://fonts.gstatic.com',
        crossOrigin: 'anonymous',
      },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&family=Instrument+Serif:ital@0;1&display=swap',
      },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: ReactNode }) {
  return (
    // The inline theme script below sets `dark` and `color-scheme` on <html>
    // before React hydrates, which is what keeps the first paint from flashing
    // white. The server cannot know the visitor's preference, so the server
    // markup and the client's view of this one element legitimately differ —
    // `suppressHydrationWarning` is exactly the escape hatch for that, and it
    // applies to this element only.
    <html lang="en" className="antialiased" suppressHydrationWarning>
      <head>
        <script
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
        />
        <HeadContent />
      </head>
      <body className="min-h-screen bg-background text-foreground">
        <ThemeProvider>
          <QueryProvider>
            <ToastProvider>{children}</ToastProvider>
          </QueryProvider>
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  )
}

export function RootLayout() {
  return <Outlet />
}