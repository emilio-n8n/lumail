import { useMemo, useRef, useState } from 'react'
import {
  CircleDot,
  Clock,
  GitBranch,
  Globe,
  Pencil,
  Plus,
  Send,
  Split,
  Tag,
  Trash2,
  Users,
  Waypoints,
  X,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { templateServerFns } from '@/server/campaigns'
import { segmentServerFns } from '@/server/contacts'
import { useServerQuery } from '@/lib/use-server-query'
import type {
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeType,
} from '@/lib/domain/types'

/**
 * Workflow builder.
 *
 * A canvas of typed nodes connected by typed edges. The graph is validated
 * server-side on save (exactly one trigger, no cycles, every node reachable), so
 * an automation can never be activated in a state that would fail mid-send.
 */

const NODE_META: Record<
  WorkflowNodeType,
  {
    label: string
    icon: React.ComponentType<{ className?: string }>
    group: 'trigger' | 'logic' | 'action'
    accent: string
  }
> = {
  trigger: { label: 'Trigger', icon: Zap, group: 'trigger', accent: 'primary' },
  wait: { label: 'Wait', icon: Clock, group: 'logic', accent: 'info' },
  condition: { label: 'Condition', icon: GitBranch, group: 'logic', accent: 'info' },
  goal: { label: 'Goal', icon: CircleDot, group: 'logic', accent: 'info' },
  split: { label: 'A/B split', icon: Split, group: 'logic', accent: 'info' },
  send_email: { label: 'Send email', icon: Send, group: 'action', accent: 'default' },
  add_tag: { label: 'Add tag', icon: Tag, group: 'action', accent: 'default' },
  remove_tag: { label: 'Remove tag', icon: Tag, group: 'action', accent: 'default' },
  update_contact: { label: 'Update contact', icon: Pencil, group: 'action', accent: 'default' },
  add_to_segment: { label: 'Add to segment', icon: Users, group: 'action', accent: 'default' },
  remove_from_segment: {
    label: 'Remove from segment',
    icon: Users,
    group: 'action',
    accent: 'default',
  },
  webhook: { label: 'Webhook', icon: Globe, group: 'action', accent: 'default' },
}

const PALETTE: WorkflowNodeType[] = [
  'wait',
  'condition',
  'goal',
  'split',
  'send_email',
  'add_tag',
  'remove_tag',
  'update_contact',
  'add_to_segment',
  'remove_from_segment',
  'webhook',
]

const TRIGGER_LABELS: Record<string, string> = {
  contact_created: 'Contact created',
  tag_added: 'Tag added',
  segment_added: 'Added to segment',
  email_opened: 'Email opened',
  link_clicked: 'Link clicked',
  custom_event: 'Custom event',
  webhook: 'Webhook',
}

const GRID = 26

export function WorkflowBuilder({
  definition,
  triggerType,
  onChange,
  readOnly,
}: {
  definition: WorkflowDefinition
  triggerType: string
  onChange: (next: WorkflowDefinition) => void
  readOnly?: boolean
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [connecting, setConnecting] = useState<string | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)

  const nodes = definition.nodes ?? []
  const edges = definition.edges ?? []

  const triggerNode = nodes.find((node) => node.type === 'trigger')
  const triggerConfig = useMemo(() => {
    void triggerType
    return triggerNode?.config ?? {}
  }, [triggerNode])

  const addNode = (type: WorkflowNodeType) => {
    if (readOnly) return
    const id = `n_${Math.random().toString(36).slice(2, 8)}`
    const node: WorkflowNode = {
      id,
      type,
      config: defaultConfig(type),
      position: {
        x: 200 + Math.random() * 60,
        y: 120 + nodes.length * 84,
      },
    }
    onChange({ nodes: [...nodes, node], edges })
    setSelectedId(id)
  }

  const updateNode = (id: string, patch: Partial<WorkflowNode>) => {
    if (readOnly) return
    onChange({
      nodes: nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)),
      edges,
    })
  }

  const updateConfig = (id: string, config: Record<string, unknown>) => {
    if (readOnly) return
    onChange({
      nodes: nodes.map((node) =>
        node.id === id ? { ...node, config: { ...node.config, ...config } } : node,
      ),
      edges,
    })
  }

  const removeNode = (id: string) => {
    if (readOnly) return
    onChange({
      nodes: nodes.filter((node) => node.id !== id),
      edges: edges.filter((edge) => edge.source !== id && edge.target !== id),
    })
    setSelectedId(null)
  }

  const connect = (fromId: string, toId: string, branch?: string) => {
    if (readOnly || fromId === toId) return
    const already = edges.find(
      (edge) => edge.source === fromId && edge.target === toId && edge.branch === branch,
    )
    if (already) return
    const edge: WorkflowEdge = {
      id: `e_${Math.random().toString(36).slice(2, 8)}`,
      source: fromId,
      target: toId,
      branch,
    }
    onChange({ nodes, edges: [...edges, edge] })
    setConnecting(null)
  }

  const removeEdge = (edgeId: string) => {
    if (readOnly) return
    onChange({ nodes, edges: edges.filter((edge) => edge.id !== edgeId) })
  }

  const onCanvasClick = (event: React.MouseEvent) => {
    if (readOnly) return
    setSelectedId(null)
    setConnecting(null)
    void event
  }

  const selected = nodes.find((node) => node.id === selectedId) ?? null

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[180px_minmax(0,1fr)_280px]">
      {/* palette */}
      <div className="border-r border-border p-2">
        <p className="px-1 py-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          Blocks
        </p>
        <div className="space-y-1">
          {PALETTE.map((type) => {
            const meta = NODE_META[type]
            const Icon = meta.icon
            return (
              <button
                key={type}
                type="button"
                disabled={readOnly}
                onClick={() => addNode(type)}
                className="flex w-full items-center gap-2 rounded-sm px-1.5 py-1.5 text-left text-[12px] transition-colors hover:bg-muted disabled:opacity-50"
              >
                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{meta.label}</span>
              </button>
            )
          })}
        </div>

        {!readOnly ? (
          <p className="mt-4 px-1 text-[10px] leading-relaxed text-muted-foreground">
            Click a block to add it, then use its <strong>Connect</strong> handle
            to draw an edge to another node.
          </p>
        ) : null}
      </div>

      {/* canvas */}
      <div
        ref={canvasRef}
        onClick={onCanvasClick}
        className="relative min-h-0 overflow-auto bg-subtle"
        style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, var(--color-border) 1px, transparent 0)`,
          backgroundSize: `${GRID}px ${GRID}px`,
        }}
      >
        <div className="relative" style={{ width: 900, height: 620 }}>
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            aria-hidden="true"
          >
            {edges.map((edge) => {
              const from = nodes.find((node) => node.id === edge.source)
              const to = nodes.find((node) => node.id === edge.target)
              if (!from || !to) return null

              const x1 = from.position.x + 200
              const y1 = from.position.y + 32
              const x2 = to.position.x
              const y2 = to.position.y + 32
              const midX = (x1 + x2) / 2

              return (
                <g key={edge.id}>
                  <path
                    d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                    fill="none"
                    stroke="var(--color-border-strong)"
                    strokeWidth="1.5"
                  />
                  {edge.branch ? (
                    <text
                      x={midX}
                      y={(y1 + y2) / 2 - 4}
                      textAnchor="middle"
                      className="fill-muted-foreground font-mono"
                      style={{ fontSize: 9 }}
                    >
                      {edge.branch}
                    </text>
                  ) : null}
                  <circle cx={x2} cy={y2} r="3" fill="var(--color-border-strong)" />
                </g>
              )
            })}
          </svg>

          {nodes.map((node) => (
            <NodeCard
              key={node.id}
              node={node}
              selected={selectedId === node.id}
              connecting={connecting === node.id}
              isTrigger={node.type === 'trigger'}
              triggerLabel={
                node.type === 'trigger'
                  ? TRIGGER_LABELS[String(node.config.type ?? triggerType)] ??
                    'Contact created'
                  : undefined
              }
              onSelect={() => setSelectedId(node.id)}
              onStartConnect={() => setConnecting(node.id)}
              onFinishConnect={(targetId) => connect(node.id, targetId)}
              readOnly={readOnly}
            />
          ))}

          {connecting ? (
            <div className="absolute left-3 top-3 rounded-md border border-primary bg-accent px-2 py-1 text-[11px] text-accent-foreground">
              Pick the node this connects to
            </div>
          ) : null}
        </div>
      </div>

      {/* inspector */}
      <div className="min-h-0 overflow-y-auto border-l border-border">
        {selected ? (
          <NodeInspector
            node={selected}
            onChangeConfig={(config) => updateConfig(selected.id, config)}
            onRemove={() => removeNode(selected.id)}
            readOnly={readOnly}
          />
        ) : (
          <div className="p-4">
            <p className="text-[13px] font-medium">Inspector</p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              Select a node on the canvas to configure it.
            </p>

            {edges.length > 0 ? (
              <>
                <p className="mt-5 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  Connections
                </p>
                <ul className="mt-2 space-y-1">
                  {edges.map((edge) => (
                    <li
                      key={edge.id}
                      className="flex items-center gap-1.5 rounded-sm border border-border px-2 py-1"
                    >
                      <span className="min-w-0 flex-1 truncate font-mono text-[10px]">
                        {edge.source}
                        {edge.branch ? ` [${edge.branch}]` : ''} → {edge.target}
                      </span>
                      {!readOnly ? (
                        <button
                          type="button"
                          aria-label="Remove connection"
                          onClick={() => removeEdge(edge.id)}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <X className="size-3" />
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            <p className="mt-5 text-[11px] leading-relaxed text-muted-foreground">
              {triggerConfig
                ? 'The graph is validated on save.'
                : 'A workflow needs exactly one trigger.'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function NodeCard({
  node,
  selected,
  connecting,
  isTrigger,
  triggerLabel,
  onSelect,
  onStartConnect,
  onFinishConnect,
  readOnly,
}: {
  node: WorkflowNode
  selected: boolean
  connecting: boolean
  isTrigger: boolean
  triggerLabel?: string
  onSelect: () => void
  onStartConnect: () => void
  onFinishConnect: (targetId: string) => void
  readOnly?: boolean
}) {
  const meta = NODE_META[node.type]
  const Icon = meta.icon

  return (
    <div
      onClick={(event) => {
        event.stopPropagation()
        if (connecting) onFinishConnect(node.id)
        else onSelect()
      }}
      className={cn(
        'absolute flex h-16 w-48 cursor-pointer items-center gap-2 rounded-lg border bg-card px-3 transition-colors duration-100',
        selected
          ? 'border-primary shadow-[0_0_0_2px_var(--color-primary-muted)]'
          : 'border-border hover:border-border-strong',
      )}
      style={{ left: node.position.x, top: node.position.y }}
    >
      <span
        className={cn(
          'grid size-7 shrink-0 place-items-center rounded-md border',
          meta.accent === 'primary'
            ? 'border-primary/40 bg-primary-muted text-primary-foreground-muted'
            : meta.accent === 'info'
              ? 'border-info/30 bg-info-muted text-info'
              : 'border-border bg-muted text-muted-foreground',
        )}
      >
        <Icon className="size-3.5" />
      </span>

      <div className="min-w-0">
        <p className="truncate text-[12px] font-medium">{meta.label}</p>
        <p className="truncate text-[10px] text-muted-foreground">
          {isTrigger
            ? (triggerLabel ?? 'When…')
            : summariseConfig(node)}
        </p>
      </div>

      {!readOnly && !isTrigger ? (
        <button
          type="button"
          aria-label="Connect to another node"
          onClick={(event) => {
            event.stopPropagation()
            onStartConnect()
          }}
          className="absolute -right-2.5 bottom-2.5 grid size-5 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:border-primary hover:text-primary"
        >
          <Plus className="size-3" />
        </button>
      ) : null}
    </div>
  )
}

function summariseConfig(node: WorkflowNode): string {
  const config = node.config ?? {}
  switch (node.type) {
    case 'wait':
      return `${config.amount ?? 1} ${config.unit ?? 'hours'}`
    case 'condition':
      return `${String(config.field ?? 'tag')} ${String(config.operator ?? 'equals')} ${String(config.value ?? '')}`
    case 'goal':
      return `wait for ${String(config.event ?? 'opened')}`
    case 'split':
      return `variant ${String(config.variant ?? 'a')}`
    case 'send_email':
      return config.templateId ? 'from a template' : (config.subject ?? 'custom email')
    case 'add_tag':
    case 'remove_tag':
      return Array.isArray(config.tagNames)
        ? (config.tagNames as string[]).join(', ')
        : String(config.tagName ?? '')
    case 'update_contact':
      return Object.keys((config.fields ?? {}) as object).join(', ')
    case 'add_to_segment':
    case 'remove_from_segment':
      return 'a segment'
    case 'webhook':
      return String(config.url ?? '')
    default:
      return ''
  }
}

function NodeInspector({
  node,
  onChangeConfig,
  onRemove,
  readOnly,
}: {
  node: WorkflowNode
  onChangeConfig: (config: Record<string, unknown>) => void
  onRemove: () => void
  readOnly?: boolean
}) {
  const config = node.config ?? {}
  const { data: templates } = useServerQuery(templateServerFns.list, {
    category: null,
    search: null,
  })
  const { data: segments } = useServerQuery(
    segmentServerFns.list,
    undefined as never,
  )
  const meta = NODE_META[node.type]

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <meta.icon className="size-3.5 text-muted-foreground" />
          <p className="text-[13px] font-semibold">{meta.label}</p>
        </div>
        {!readOnly ? (
          <Button variant="ghost" size="icon-sm" onClick={onRemove} aria-label="Delete node">
            <Trash2 />
          </Button>
        ) : null}
      </div>

      {node.type === 'trigger' ? (
        <Field label="Trigger">
          <Select
            value={String(config.type ?? 'contact_created')}
            disabled={readOnly}
            onChange={(event) => onChangeConfig({ type: event.target.value })}
          >
            {Object.entries(TRIGGER_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      {node.type === 'wait' ? (
        <>
          <Field label="Amount">
            <Input
              type="number"
              value={String(config.amount ?? 1)}
              disabled={readOnly}
              onChange={(event) => onChangeConfig({ amount: Number(event.target.value) })}
            />
          </Field>
          <Field label="Unit">
            <Select
              value={String(config.unit ?? 'hours')}
              disabled={readOnly}
              onChange={(event) => onChangeConfig({ unit: event.target.value })}
            >
              {['minutes', 'hours', 'days', 'weeks'].map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </Select>
          </Field>
        </>
      ) : null}

      {node.type === 'condition' ? (
        <>
          <Field label="Field">
            <Select
              value={String(config.field ?? 'tag')}
              disabled={readOnly}
              onChange={(event) => onChangeConfig({ field: event.target.value })}
            >
              {[
                'tag',
                'email',
                'first_name',
                'last_name',
                'company',
                'status',
                'opened',
                'clicked',
                'purchased',
              ].map((field) => (
                <option key={field} value={field}>
                  {field}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Operator">
            <Select
              value={String(config.operator ?? 'contains')}
              disabled={readOnly}
              onChange={(event) => onChangeConfig({ operator: event.target.value })}
            >
              {['equals', 'not_equals', 'contains', 'not_contains', 'greater_than', 'less_than'].map(
                (operator) => (
                  <option key={operator} value={operator}>
                    {operator.replace('_', ' ')}
                  </option>
                ),
              )}
            </Select>
          </Field>
          <Field label="Value">
            <Input
              value={String(config.value ?? '')}
              disabled={readOnly}
              onChange={(event) => onChangeConfig({ value: event.target.value })}
            />
          </Field>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Connect an edge with the <code className="font-mono">true</code>{' '}
            branch and one with <code className="font-mono">false</code>.
          </p>
        </>
      ) : null}

      {node.type === 'goal' ? (
        <>
          <Field label="Wait for event">
            <Select
              value={String(config.event ?? 'opened')}
              disabled={readOnly}
              onChange={(event) => onChangeConfig({ event: event.target.value })}
            >
              {['opened', 'clicked', 'purchased', 'custom'].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Timeout (hours)">
            <Input
              type="number"
              value={String(config.timeoutHours ?? 24)}
              disabled={readOnly}
              onChange={(event) =>
                onChangeConfig({ timeoutHours: Number(event.target.value) })
              }
            />
          </Field>
        </>
      ) : null}

      {node.type === 'split' ? (
        <Field label="Variant" hint="Branch edges are labelled a and b">
          <Select
            value={String(config.variant ?? 'a')}
            disabled={readOnly}
            onChange={(event) => onChangeConfig({ variant: event.target.value })}
          >
            <option value="a">A</option>
            <option value="b">B</option>
          </Select>
        </Field>
      ) : null}

      {node.type === 'send_email' ? (
        <>
          <Field label="Template" hint="Leave empty to write an inline email">
            <Select
              value={String(config.templateId ?? '')}
              disabled={readOnly}
              onChange={(event) => onChangeConfig({ templateId: event.target.value })}
            >
              <option value="">Custom email</option>
              {templates?.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Subject">
            <Input
              value={String(config.subject ?? '')}
              disabled={readOnly}
              onChange={(event) => onChangeConfig({ subject: event.target.value })}
              placeholder="Welcome aboard, {{firstName}}"
            />
          </Field>
        </>
      ) : null}

      {node.type === 'add_tag' || node.type === 'remove_tag' ? (
        <Field label="Tags" hint="Comma separated">
          <Input
            value={
              Array.isArray(config.tagNames)
                ? (config.tagNames as string[]).join(', ')
                : String(config.tagName ?? '')
            }
            disabled={readOnly}
            onChange={(event) =>
              onChangeConfig({
                tagNames: event.target.value
                  .split(',')
                  .map((tag) => tag.trim())
                  .filter(Boolean),
              })
            }
            placeholder="trial, engaged"
          />
        </Field>
      ) : null}

      {node.type === 'update_contact' ? (
        <div className="space-y-2">
          {['firstName', 'lastName', 'company', 'phone'].map((field) => (
            <Field key={field} label={field}>
              <Input
                value={String(
                  ((config.fields ?? {}) as Record<string, string>)[field] ?? '',
                )}
                disabled={readOnly}
                onChange={(event) =>
                  onChangeConfig({
                    fields: {
                      ...((config.fields ?? {}) as Record<string, string>),
                      [field]: event.target.value,
                    },
                  })
                }
              />
            </Field>
          ))}
        </div>
      ) : null}

      {node.type === 'add_to_segment' || node.type === 'remove_from_segment' ? (
        <Field label="Segment">
          <Select
            value={String(config.segmentId ?? '')}
            disabled={readOnly}
            onChange={(event) => onChangeConfig({ segmentId: event.target.value })}
          >
            <option value="">Select a segment…</option>
            {segments?.map((segment) => (
              <option key={segment.id} value={segment.id}>
                {segment.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      {node.type === 'webhook' ? (
        <>
          <Field label="URL">
            <Input
              value={String(config.url ?? '')}
              disabled={readOnly}
              onChange={(event) => onChangeConfig({ url: event.target.value })}
              placeholder="https://example.com/hook"
            />
          </Field>
          <Field label="Body (JSON)">
            <Textarea
              rows={4}
              value={
                typeof config.body === 'string'
                  ? config.body
                  : JSON.stringify(config.body ?? {}, null, 2)
              }
              disabled={readOnly}
              onChange={(event) => {
                try {
                  onChangeConfig({ body: JSON.parse(event.target.value) })
                } catch {
                  onChangeConfig({ body: event.target.value })
                }
              }}
              className="font-mono text-[11px]"
            />
          </Field>
        </>
      ) : null}

      <Badge tone="neutral" className="mt-2">
        <Waypoints className="size-2.5" />
        {node.id}
      </Badge>
    </div>
  )
}

function defaultConfig(type: WorkflowNodeType): Record<string, unknown> {
  switch (type) {
    case 'trigger':
      return { type: 'contact_created' }
    case 'wait':
      return { amount: 1, unit: 'hours' }
    case 'condition':
      return { field: 'tag', operator: 'contains', value: '' }
    case 'goal':
      return { event: 'opened', timeoutHours: 24 }
    case 'split':
      return { variant: 'a' }
    case 'send_email':
      return { subject: 'Hello {{firstName}}' }
    case 'add_tag':
    case 'remove_tag':
      return { tagNames: [] }
    case 'update_contact':
      return { fields: {} }
    case 'add_to_segment':
    case 'remove_from_segment':
      return { segmentId: '' }
    case 'webhook':
      return { url: '', method: 'POST', body: {} }
    default:
      return {}
  }
}
