import { createFileRoute, Link } from '@tanstack/react-router'
import {
  ArrowRight,
  GitBranch,
  Mail,
  Tags,
  Waypoints,
} from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Public landing surface.
 *
 * Deliberately a different register from the dashboard: editorial serif, a dot
 * field, no product screenshots. The product itself is the proof.
 */

const CAPABILITIES = [
  {
    icon: Tags,
    title: 'Contacts & segments',
    body: 'Dynamic cohorts compiled to SQL and evaluated on read, so a segment is never a stale snapshot.',
  },
  {
    icon: Mail,
    title: 'Campaigns & templates',
    body: 'A block editor that renders identically in the preview, in a test send and in the inbox.',
  },
  {
    icon: Waypoints,
    title: 'Automations',
    body: 'Triggers, waits, conditions, splits and goals persisted as a validated DAG, executed by a durable queue.',
  },
  {
    icon: GitBranch,
    title: 'API & MCP',
    body: 'One set of domain services behind the dashboard, the REST API and the MCP tool surface.',
  },
]

const TOOL_NAMES = [
  'list_contacts',
  'search_contacts',
  'create_contact',
  'create_segment',
  'create_campaign',
  'send_campaign',
  'schedule_campaign',
  'create_workflow',
  'activate_workflow',
  'get_campaign_analytics',
  'get_contact_activity',
  'send_email',
]

const FLOW = [
  { label: 'User', caption: 'Who clicked pricing' },
  { label: 'Dashboard', caption: 'Same primitives' },
  { label: 'API', caption: 'Same primitives' },
  { label: 'MCP', caption: 'Same primitives' },
  { label: 'Agent', caption: 'Autonomous operator' },
]

export const Route = createFileRoute('/')({
  component: LandingPage,
})

function LandingPage() {
  return (
    <div className="min-h-screen">
      {/* nav */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-6">
          <span className="flex items-center gap-2">
            <span className="grid size-5 place-items-center rounded-sm bg-primary">
              <span className="font-mono text-[11px] font-bold text-primary-foreground">
                L
              </span>
            </span>
            <span className="text-[13px] font-semibold tracking-tight">Lumail</span>
          </span>

          <nav className="ml-6 hidden items-center gap-5 md:flex">
            {[
              ['Capabilities', '#capabilities'],
              ['For agents', '#agents'],
              ['Architecture', '#architecture'],
            ].map(([label, href]) => (
              <a
                key={href}
                href={href}
                className="text-[13px] text-muted-foreground transition-colors hover:text-foreground"
              >
                {label}
              </a>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <Link
              to="/login"
              className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
            >
              Sign in
            </Link>
            <Link
              to="/login"
              search={{ mode: 'signup' }}
              className={cn(buttonVariants({ variant: 'primary', size: 'sm' }))}
            >
              Start free
            </Link>
          </div>
        </div>
      </header>

      {/* hero */}
      <section className="dot-field border-b border-border">
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Email operating system
          </p>

          <h1 className="mt-5 max-w-3xl font-display text-[52px] leading-[1.05] tracking-tight md:text-[68px]">
            The whole email stack.
            <br />
            <span className="text-muted-foreground">Driven by humans or agents.</span>
          </h1>

          <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            Contacts, segments, campaigns, templates, automations, transactional
            sends and analytics — a single set of domain services behind the
            dashboard, a versioned REST API and an MCP server. If you can click
            it, an agent can call it.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              to="/login"
              search={{ mode: 'signup' }}
              className={cn(
                buttonVariants({ variant: 'primary', size: 'lg' }),
                'gap-2',
              )}
            >
              Create a workspace
              <ArrowRight />
            </Link>
            <a
              href="#agents"
              className={cn(buttonVariants({ variant: 'outline', size: 'lg' }))}
            >
              See the agent interface
            </a>
          </div>
        </div>
      </section>

      {/* capabilities */}
      <section id="capabilities" className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="font-display text-[32px] tracking-tight">
            Built as one system
          </h2>
          <p className="mt-2 max-w-lg text-[14px] text-muted-foreground">
            Not a dashboard with an API bolted on. The API is the product.
          </p>

          <div className="mt-10 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
            {CAPABILITIES.map((capability) => {
              const Icon = capability.icon
              return (
                <div key={capability.title} className="bg-card p-6">
                  <Icon className="size-4 text-primary-foreground-muted" />
                  <h3 className="mt-3 text-[14px] font-semibold">
                    {capability.title}
                  </h3>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                    {capability.body}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* agents */}
      <section id="agents" className="border-b border-border bg-subtle">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 py-16 lg:grid-cols-2">
          <div>
            <h2 className="font-display text-[32px] tracking-tight">
              Ask for a cohort. Get a segment.
            </h2>
            <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">
              The assistant has no private powers. It is given exactly the tools
              the MCP server exposes, wired to the same domain services. When it
              says it created something, it exists — and it is in the dashboard
              immediately.
            </p>

            <div className="mt-6 rounded-lg border border-border bg-console p-4 font-mono text-[12px] leading-relaxed text-console-foreground">
              <div className="text-console-subtle">you</div>
              <div className="mt-1 text-console-foreground">
                Who clicked Pricing but never bought?
              </div>
              <div className="mt-3 text-console-subtle">assistant</div>
              <div className="mt-1">
                <span className="text-console-accent">search_contacts</span> →{' '}
                342 matches
              </div>
              <div>
                <span className="text-console-accent">create_segment</span> →{' '}
                “Pricing clickers, not converted”
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-[13px] font-semibold">
              Tools exposed over MCP
            </h3>
            <p className="mt-1.5 text-[13px] text-muted-foreground">
              Descriptions written for an LLM: what it does, when to use it, what
              it returns.
            </p>
            <ul className="mt-5 divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
              {TOOL_NAMES.map((name) => (
                <li
                  key={name}
                  className="px-3 py-2 font-mono text-[12px] text-muted-foreground"
                >
                  {name}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* architecture */}
      <section id="architecture">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="font-display text-[32px] tracking-tight">
            One set of primitives
          </h2>

          <div className="mt-10 overflow-x-auto">
            <div className="flex min-w-max items-center gap-2">
              {FLOW.map((step, index) => (
                <div key={step.label} className="flex items-center gap-2">
                  <div className="rounded-lg border border-border bg-card px-4 py-3">
                    <p className="text-[13px] font-semibold">{step.label}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {step.caption}
                    </p>
                  </div>
                  {index < FLOW.length - 1 ? (
                    <span className="text-muted-foreground">→</span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-8 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
            {[
              [
                'Enforced by the database',
                'PostgreSQL row level security isolates every workspace. Reads and writes cross tenants are rejected by Postgres itself, not by application convention.',
              ],
              [
                'Authorised on the server',
                'Roles live in a dedicated membership table, checked in the domain layer on every privileged operation. Nothing is trusted from the browser.',
              ],
              [
                'Audited as it happens',
                'One immutable activity stream feeds analytics, the contact timeline, segment conditions and automation triggers.',
              ],
            ].map(([title, body]) => (
              <div key={title} className="bg-card p-6">
                <h3 className="text-[13px] font-semibold">{title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                  {body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-6 py-8">
          <span className="font-mono text-[11px] text-muted-foreground">
            Lumail
          </span>
          <span className="text-[11px] text-muted-foreground">
            An email operating system for humans and agents.
          </span>
          <Link
            to="/login"
            className="ml-auto text-[12px] underline underline-offset-4 hover:text-foreground"
          >
            Open the dashboard
          </Link>
        </div>
      </footer>
    </div>
  )
}