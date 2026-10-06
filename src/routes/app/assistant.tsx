import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowRight, Sparkles, Terminal, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/app/shell'
import { Badge, Card, CardHeader } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { assistantServerFns } from '@/server/assistant'
import { metadataServerFns } from '@/server/contacts'
import { useServerQuery } from '@/lib/use-server-query'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/app/assistant')({
  component: AssistantPage,
})

/**
 * AI assistant.
 *
 * The assistant streams from a server function that runs the shared tool
 * definitions — the same ones the MCP server exposes. Nothing it does is
 * simulated; the suggestions below the composer link straight to whatever it
 * just created.
 */

type Turn = {
  role: 'user' | 'assistant'
  content: string
}

const SUGGESTIONS = [
  'Who clicked Pricing but never bought?',
  'Show me contacts with no activity in 30 days',
  'Create a welcome automation for new signups',
  'How is this workspace performing?',
]

function AssistantPage() {
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const { toast } = useToast()
  const { data: toolData } = useServerQuery(
    metadataServerFns.toolSummaries,
    undefined as never,
  )
  const tools = toolData?.tools ?? []

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns])

  const send = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || streaming) return

    setInput('')
    setStreaming(true)

    const history: Turn[] = [...turns, { role: 'user', content: trimmed }]
    setTurns([...history, { role: 'assistant', content: '' }])

    try {
      const stream = await assistantServerFns.send({
        data: {
          messages: history.map((turn) => ({
            role: turn.role,
            content: turn.content,
          })),
        },
      })

      let accumulated = ''
      for await (const chunk of stream) {
        if (chunk.type === 'text') {
          accumulated += chunk.delta
          setTurns((current) => {
            const next = [...current]
            next[next.length - 1] = { role: 'assistant', content: accumulated }
            return next
          })
        }
      }
    } catch (error) {
      toast({
        title: 'The assistant could not answer',
        description: (error as Error).message,
        tone: 'error',
      })
      setTurns((current) => current.slice(0, -1))
    } finally {
      setStreaming(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <PageHeader
        title="Assistant"
        description="Ask for a cohort, a segment, a campaign or a journey. The assistant calls the same tools the MCP server exposes."
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setTurns([])}
            disabled={turns.length === 0}
          >
            <Trash2 />
            Clear
          </Button>
        }
      />

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-3">
        <Card className="flex min-h-[520px] flex-col lg:col-span-2">
          <CardHeader
            title="Conversation"
            description="Actions are performed against this workspace."
          />

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            {turns.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                <span className="grid size-9 place-items-center rounded-md border border-border bg-subtle text-primary-foreground-muted">
                  <Sparkles className="size-4" />
                </span>
                <p className="max-w-sm text-[13px] leading-relaxed text-muted-foreground">
                  Try one of these, or ask in your own words. Anything it
                  creates appears in the dashboard immediately.
                </p>
                <div className="flex flex-col gap-1.5">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => send(suggestion)}
                      className="group flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-left text-[12px] transition-colors hover:border-primary hover:bg-accent"
                    >
                      {suggestion}
                      <ArrowRight className="ml-auto size-3 text-muted-foreground transition-colors group-hover:text-foreground" />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              turns.map((turn, index) => (
                <div
                  key={index}
                  className={cn(
                    'max-w-[85%] rounded-lg border px-3 py-2',
                    turn.role === 'user'
                      ? 'ml-auto border-border bg-muted'
                      : 'border-border bg-card',
                  )}
                >
                  <p className="text-[10px] font-medium uppercase tracking-[0.07em] text-muted-foreground">
                    {turn.role === 'user' ? 'You' : 'Assistant'}
                  </p>
                  <div className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed">
                    {renderMarkdownish(turn.content)}
                    {streaming && index === turns.length - 1 ? (
                      <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-primary align-middle" />
                    ) : null}
                  </div>
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>

          <form
            className="flex items-center gap-2 border-t border-border p-3"
            onSubmit={(event) => {
              event.preventDefault()
              void send(input)
            }}
          >
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Who clicked Pricing but never bought?"
              disabled={streaming}
              className="h-9 flex-1 rounded-md border border-input bg-card px-3 text-[13px] outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/25 disabled:opacity-50"
            />
            <Button
              type="submit"
              variant="primary"
              size="md"
              loading={streaming}
              disabled={!input.trim()}
            >
              Send
            </Button>
          </form>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Available tools"
              description={`${tools.length} capabilities, identical to the MCP server.`}
            />
            <div className="max-h-96 overflow-y-auto divide-y divide-border">
              {tools.map((tool) => (
                <div key={tool.name} className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <Terminal className="size-3 shrink-0 text-muted-foreground" />
                    <code className="truncate font-mono text-[11px]">
                      {tool.name}
                    </code>
                    <Badge tone="outline" className="ml-auto shrink-0">
                      {tool.scope}
                    </Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                    {tool.description.split('\n')[0]}
                  </p>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="After a request" />
            <div className="space-y-1.5 p-3 text-[12px]">
              <Link
                to="/app/segments"
                className="flex items-center justify-between rounded-sm px-2 py-1.5 transition-colors hover:bg-muted"
              >
                <span>Segments created</span>
                <ArrowRight className="size-3 text-muted-foreground" />
              </Link>
              <Link
                to="/app/campaigns"
                className="flex items-center justify-between rounded-sm px-2 py-1.5 transition-colors hover:bg-muted"
              >
                <span>Campaigns</span>
                <ArrowRight className="size-3 text-muted-foreground" />
              </Link>
              <Link
                to="/app/automations"
                className="flex items-center justify-between rounded-sm px-2 py-1.5 transition-colors hover:bg-muted"
              >
                <span>Automations</span>
                <ArrowRight className="size-3 text-muted-foreground" />
              </Link>
            </div>
          </Card>

          <Card>
            <CardHeader title="How it works" />
            <div className="space-y-2 p-4 text-[12px] leading-relaxed text-muted-foreground">
              <p>
                Lovable AI is connected, so
                the model drives the tools directly.
              </p>
              <p>
                Without a key, a deterministic router drives the very same
                tools, so the feature stays fully usable offline.
              </p>
              <p className="text-foreground">
                Press <Kbd>⌘K</Kbd> anywhere to jump between sections.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

/** Minimal inline formatting: **bold** and `code`, nothing more. */
function renderMarkdownish(text: string) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={index} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      )
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={index}
          className="rounded-xs border border-border bg-muted px-1 font-mono text-[11px]"
        >
          {part.slice(1, -1)}
        </code>
      )
    }
    return <span key={index}>{part}</span>
  })
}