import { Boxes, GitBranch, Plug, Webhook } from 'lucide-react'
import { PageHeader } from '@/components/app/shell'
import { Card, CardHeader, Badge } from '@/components/ui/badge'
import { createFileRoute, Link } from '@tanstack/react-router'
import { WORKFLOW_TRIGGERS } from '@/lib/domain/workflow-types'
import { WEBHOOK_EVENTS } from '@/lib/webhooks/events'
import { EMAIL_VARIABLES } from '@/lib/email/variables'
import { SEGMENT_FIELDS, SEGMENT_OPERATORS } from '@/lib/domain/segment-query'
import { metadataServerFns } from '@/rpc/contacts'
import { useServerQuery } from '@/lib/use-server-query'

export const Route = createFileRoute('/app/integrations')({
  component: IntegrationsPage,
})

/**
 * Integrations — the reference surface an engineer or agent needs in one place.
 */

function IntegrationsPage() {
  const { data: toolData } = useServerQuery(
    metadataServerFns.toolSummaries,
    undefined as never,
  )
  const tools = toolData?.tools ?? []

  return (
    <div className="space-y-4">
      <PageHeader
        title="Integrations"
        description="Everything an agent or an external system can reach, in one reference."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="MCP tools"
            description="Exposed by the MCP server and used by the in-product assistant."
          />
          <div className="divide-y divide-border">
            {tools.map((tool) => (
              <div key={tool.name} className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <code className="font-mono text-[12px] font-medium">
                    {tool.name}
                  </code>
                  <Badge tone="outline">{tool.scope}</Badge>
                </div>
                <p className="mt-1 whitespace-pre-line text-[12px] leading-relaxed text-muted-foreground">
                  {tool.description}
                </p>
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Automation triggers"
              description="What can start a journey."
            />
            <div className="divide-y divide-border">
              {WORKFLOW_TRIGGERS.map((trigger) => (
                <div key={trigger} className="flex items-center gap-2 px-4 py-2">
                  <GitBranch className="size-3.5 text-muted-foreground" />
                  <code className="font-mono text-[12px]">{trigger}</code>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Webhook events"
              description="Delivered to your endpoints, signed."
            />
            <div className="max-h-64 divide-y divide-border overflow-y-auto">
              {WEBHOOK_EVENTS.map((event) => (
                <div key={event} className="px-4 py-1.5">
                  <code className="font-mono text-[11px]">{event}</code>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Merge variables"
              description="Available in templates, campaigns and automations."
            />
            <div className="divide-y divide-border">
              {EMAIL_VARIABLES.map((variable) => (
                <div key={variable.key} className="px-4 py-2">
                  <code className="font-mono text-[11px] text-primary-foreground-muted">
                    {`{{${variable.key}}}`}
                  </code>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    {variable.description}
                  </p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          {
            icon: Plug,
            title: 'Public REST API',
            body: 'Versioned under /api/v1, authenticated with a workspace API key, authorised by scope.',
            to: '/app/developers',
            cta: 'Open API reference',
          },
          {
            icon: Webhook,
            title: 'Inbound events',
            body: 'POST /api/public/events lets your backend start automations from your own domain logic.',
            to: '/app/automations',
            cta: 'Build automations',
          },
          {
            icon: Boxes,
            title: 'In-product assistant',
            body: 'The same tool surface, driven conversationally inside the dashboard.',
            to: '/app/assistant',
            cta: 'Open assistant',
          },
        ].map((card) => {
          const Icon = card.icon
          return (
            <Card key={card.title} className="flex flex-col p-4">
              <Icon className="size-4 text-primary-foreground-muted" />
              <p className="mt-3 text-[13px] font-semibold">{card.title}</p>
              <p className="mt-1 flex-1 text-[12px] leading-relaxed text-muted-foreground">
                {card.body}
              </p>
              <Link
                to={card.to}
                className="mt-3 text-[12px] underline underline-offset-4 hover:text-foreground"
              >
                {card.cta}
              </Link>
            </Card>
          )
        })}
      </div>

      <Card>
        <CardHeader
          title="Segment vocabulary"
          description="Fields and operators accepted by the segment compiler — the same ones the API and MCP tools validate against."
        />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
              Fields
            </p>
            <div className="flex flex-wrap gap-1">
              {SEGMENT_FIELDS.map((field) => (
                <code
                  key={field}
                  className="rounded-xs border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]"
                >
                  {field}
                </code>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
              Operators
            </p>
            <div className="flex flex-wrap gap-1">
              {SEGMENT_OPERATORS.map((operator) => (
                <code
                  key={operator}
                  className="rounded-xs border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]"
                >
                  {operator}
                </code>
              ))}
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}
