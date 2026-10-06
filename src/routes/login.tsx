import { createFileRoute, redirect } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { authServerFns } from '@/server/auth'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { Spinner } from '@/components/ui/spinner'
import { supabase } from '@/integrations/supabase/client'
import { lovable } from '@/integrations/lovable/index'

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): { mode?: 'login' | 'signup' } => ({
    ...(search['mode'] === 'signup' ? { mode: 'signup' as const } : {}),
  }),
  beforeLoad: async () => {
    const { authenticated } = await authServerFns.whoami()
    if (authenticated) throw redirect({ to: '/app' })
  },
  component: AuthPage,
})

function AuthPage() {
  const { mode } = Route.useSearch()
  const [isSignup, setIsSignup] = useState(mode === 'signup')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { toast } = useToast()

  useEffect(() => {
    setIsSignup(mode === 'signup')
  }, [mode])

  const finish = async (accessToken: string) => {
    await authServerFns.establish({ data: { accessToken } })
    window.location.href = '/app'
  }

  // A session that already exists in this browser (after Google, an email
  // confirmation link, or an expired server cookie) is bound and used directly.
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) void finish(data.session.access_token).catch(() => undefined)
    })
  }, [])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (isSignup) {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/login`,
            data: { full_name: fullName.trim() || undefined },
          },
        })
        if (signUpError) throw signUpError
        if (!data.session) {
          toast({
            title: 'Check your inbox',
            description: 'Confirm your email address, then come back to sign in.',
            tone: 'success',
          })
          setIsSignup(false)
          return
        }
        await finish(data.session.access_token)
      } else {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        })
        if (signInError) throw signInError
        await finish(data.session.access_token)
      }
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const google = async () => {
    setError(null)
    const result = await lovable.auth.signInWithOAuth('google', {
      redirect_uri: `${window.location.origin}/login`,
    })
    if (result.error) {
      setError(result.error.message ?? 'Google sign-in failed')
      return
    }
    if (result.redirected) return
    const { data } = await supabase.auth.getSession()
    if (data.session) await finish(data.session.access_token)
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1fr]">
      {/* form */}
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <Link to="/" className="mb-8 flex items-center gap-2">
            <span className="grid size-5 place-items-center rounded-sm bg-primary">
              <span className="font-mono text-[11px] font-bold text-primary-foreground">
                L
              </span>
            </span>
            <span className="text-[13px] font-semibold tracking-tight">Lumail</span>
          </Link>

          <h1 className="font-display text-[32px] leading-none tracking-tight">
            {isSignup ? 'Start sending' : 'Welcome back'}
          </h1>
          <p className="mt-2 text-[13px] text-muted-foreground">
            {isSignup
              ? 'Create your account and your first workspace.'
              : 'Sign in to your workspace.'}
          </p>

          <form onSubmit={submit} className="mt-7 space-y-3">
            {isSignup ? (
              <Field label="Name">
                <Input
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="Ada Lovelace"
                  autoComplete="name"
                />
              </Field>
            ) : null}

            <Field label="Email">
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
                autoFocus
              />
            </Field>

            <Field
              label="Password"
              hint={isSignup ? 'At least 8 characters' : undefined}
            >
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                autoComplete={isSignup ? 'new-password' : 'current-password'}
                required
                minLength={isSignup ? 8 : 1}
              />
            </Field>

            {error ? (
              <p className="rounded-md border border-destructive/30 bg-destructive-muted px-2.5 py-2 text-[12px] text-destructive">
                {error}
              </p>
            ) : null}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full justify-center"
              loading={busy}
            >
              {isSignup ? 'Create workspace' : 'Sign in'}
            </Button>
          </form>

          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="mt-3 w-full justify-center"
            onClick={() => void google()}
          >
            Continue with Google
          </Button>

          <button
            type="button"
            onClick={() => {
              setIsSignup((value) => !value)
              setError(null)
            }}
            className="mt-4 text-[13px] text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            {isSignup
              ? 'Already have an account? Sign in'
              : 'No account yet? Create one'}
          </button>

        </div>
      </div>

      {/* editorial panel */}
      <div className="dot-field relative hidden flex-col justify-between border-l border-border bg-console p-10 text-console-foreground lg:flex">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-console-subtle">
            Email operating system
          </p>
        </div>

        <div className="max-w-md">
          <p className="font-display text-[40px] leading-[1.1] tracking-tight">
            Every dashboard action is also an API call an agent can make.
          </p>
          <p className="mt-5 text-[14px] leading-relaxed text-console-foreground/70">
            Contacts, segments, campaigns, automations and transactional sends
            are the same primitives behind the UI, the REST API and the MCP
            server. Ask for a cohort, get a segment. Ask for a journey, get a
            running automation.
          </p>
        </div>

        <div className="space-y-2 font-mono text-[11px] text-console-subtle">
          {[
            'POST /api/v1/contacts',
            'POST /api/v1/segments',
            'POST /api/v1/campaigns/{id}/send',
            'mcp · search_contacts',
          ].map((line) => (
            <div key={line} className="flex items-center gap-2">
              <span className="text-console-accent">›</span>
              {line}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

void Spinner