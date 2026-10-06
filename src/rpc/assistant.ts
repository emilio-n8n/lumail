import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { z } from 'zod'
import { streamText, stepCountIs, tool, type ModelMessage, type ToolSet } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { guard } from './auth'

/**
 * The tool surface reaches the database, so it is loaded behind a
 * server-only boundary: in the browser build this becomes a throwing stub and
 * the import is dropped entirely.
 */
const loadTools = createServerOnlyFn(() => import('@/lib/ai/tools'))

/**
 * The in-product AI assistant.
 *
 * The assistant has no private capabilities: it is given exactly the same tool
 * definitions the MCP server exposes, wired to the same domain services. When it
 * says it created a segment, a segment really exists — and it is visible in the
 * dashboard immediately.
 *
 * The assistant is driven by Lovable AI. Without a
 * key, a deterministic intent router drives the very same tools, so the feature
 * is fully demonstrable offline.
 */

const SYSTEM_PROMPT = `You are the Lumail assistant — an operator for an email marketing platform.

You act on the user's workspace through tools. You never invent data, ids or
results: if you need information, call a tool and use what it returns.

How to work:
- Prefer \`search_contacts\` over \`list_contacts\` for any "who …" question.
- When a query implies a cohort (people who clicked Pricing but never bought),
  search first, then offer to save the cohort as a segment.
- Compose emails with \`send_email\` for one-off messages, or create a campaign
  when the user asks to reach a segment.
- Merge variables use double braces: {{firstName}}, {{company}}.
- Automations are directed acyclic graphs: exactly one trigger node, no cycles,
  every node reachable from the trigger.
- Call \`describe_capabilities\` if you are unsure about field or operator names.

Report concrete numbers you actually received from tools. If you change
something, say what changed and offer a next step. Be concise and concrete.`

type ToolExecution = {
  ok: boolean
  result?: unknown
  error?: string
}

/**
 * Builds the assistant's tool set from the shared definitions. The registry is
 * assembled dynamically, so it is handed to the SDK as an opaque `ToolSet`.
 */
async function buildTools(): Promise<ToolSet> {
  const { tools: definitions } = await loadTools()
  const registry: Record<string, unknown> = {}
  for (const definition of definitions) {
    registry[definition.name] = tool({
      description: definition.description,
      inputSchema: definition.schema,
      execute: async (input: unknown): Promise<ToolExecution> => {
        try {
          const result = await definition.handler(input)
          return { ok: true, result }
        } catch (error) {
          return { ok: false, error: (error as Error).message }
        }
      },
    })
  }
  return registry as ToolSet
}

export const assistantSend = createServerFn({ method: 'POST' })
    .validator(
      z.object({
        messages: z.array(
          z.object({
            role: z.enum(['user', 'assistant']),
            content: z.string(),
          }),
        ),
      }),
    )
    .handler(async function* ({ data }) {
      try {
        yield* assistantImpl(data.messages)
      } catch (error) {
        console.error('[assistant]', (error as Error).stack ?? error)
        throw error
      }
    })

async function* assistantImpl(history: { role: string; content: string }[]) {
  const { requireWorkspaceMember } = await import(
    '@/integrations/database/auth-runtime'
  )
  const { workspaceId } = await requireWorkspaceMember()
  const apiKey = process.env.LOVABLE_API_KEY

  if (!apiKey) {
    yield* offlineAssistant(history, workspaceId)
    return
  }

  const messages: ModelMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...(history as ModelMessage[]),
  ]

  let runId: string | undefined
  const gateway = createOpenAI({
    baseURL: 'https://ai.gateway.lovable.dev/v1',
    apiKey,
    headers: { 'Lovable-API-Key': apiKey, 'X-Lovable-AIG-SDK': 'vercel-ai-sdk' },
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers)
      if (runId) headers.set('X-Lovable-AIG-Run-ID', runId)
      const response = await fetch(input, { ...init, headers })
      runId ??= response.headers.get('X-Lovable-AIG-Run-ID') ?? undefined
      return response
    },
  })

  const result = streamText({
    model: gateway.responses('openai/gpt-6-astra'),
    providerOptions: {
      openai: {
        forceReasoning: true,
        reasoningEffort: 'low',
        reasoningSummary: 'auto',
        store: false,
        include: ['reasoning.encrypted_content'],
      },
    },
    system: SYSTEM_PROMPT,
    messages,
    tools: await buildTools(),
    stopWhen: stepCountIs(50),
  })

  for await (const part of result.fullStream) {
    if (part.type === 'text-delta') {
      yield { type: 'text' as const, delta: part.text }
    } else if (part.type === 'error') {
      const message = (part.error as Error)?.message ?? String(part.error)
      yield { type: 'text' as const, delta: `\n\n_The assistant could not answer: ${message}_` }
    }
  }
}

export const assistantServerFns = {
  send: assistantSend,
}


/**
 * Deterministic fallback router.
 *
 * It maps a small set of natural intents onto the real tools, so "who clicked
 * pricing but didn't buy?" genuinely queries the database and genuinely creates
 * a segment. This is a fallback, not a mock of the assistant's abilities.
 */
async function* offlineAssistant(
  history: { role: string; content: string }[],
  workspaceId: string,
) {
  const userMessage = [...history].reverse().find((m) => m.role === 'user')?.content ?? ''
  const lower = userMessage.toLowerCase()

  // Step 1 — acknowledge while the tool runs.
  yield { type: 'text' as const, delta: '' }
  await new Promise((resolve) => setTimeout(resolve, 120))

  const { toolsByName } = await loadTools()
  const campaigns = (await toolsByName.get('list_campaigns')!.handler({
    limit: 20,
  })) as { campaigns: { id: string; name: string }[] }

  const wantsPricing = /pricing|price|plan|upgrade/.test(lower)
  const wantsPurchase = /purchas|bought|buy|customer|convert/.test(lower)
  const wantsCampaign = /campaign|send|mail them|email them|blast/.test(lower)
  const wantsSegment = /segment|cohort|group|save/.test(lower)

  const campaign =
    campaigns.campaigns.find((c) => (wantsPricing ? /pricing/i.test(c.name) : false)) ??
    campaigns.campaigns[0]

  if ((wantsPricing || wantsPurchase) && campaign) {
    const found = (await toolsByName
      .get('search_contacts')!
      .handler({
        campaignId: campaign.id,
        campaignClicked: wantsPricing,
        notPurchased: wantsPurchase,
        limit: 50,
      })) as { total: number; contacts: { id: string; email: string }[] }

    yield {
      type: 'text' as const,
      delta: `Looking through "${campaign.name}" for contacts who ${
        wantsPricing ? 'clicked a link' : 'received it'
      }${wantsPurchase ? ' and have not purchased' : ''}…\n\n`,
    }
    await new Promise((resolve) => setTimeout(resolve, 150))

    yield {
      type: 'text' as const,
      delta: `I found **${found.total}** contact${found.total === 1 ? '' : 's'}.`,
    }

    if (found.total > 0 && wantsSegment) {
      const segment = (await toolsByName
        .get('create_segment')!
        .handler({
          name: `${wantsPricing ? 'Pricing clickers' : 'Campaign engaged'} — not yet converted`,
          description: `Created from: "${userMessage}"`,
          matchMode: 'all',
          conditions: [
            {
              field: 'campaign_received',
              operator: 'equals',
              value: '',
              campaignId: campaign.id,
            },
            ...(wantsPricing
              ? [
                  {
                    field: 'campaign_clicked',
                    operator: 'equals',
                    value: '',
                    campaignId: campaign.id,
                  },
                ]
              : []),
            ...(wantsPurchase
              ? [{ field: 'purchased', operator: 'not_equals', value: 'true' }]
              : []),
          ],
        })) as { id: string; name: string; memberCount: number }

      yield {
        type: 'text' as const,
        delta: `\n\nSaved them as the segment **${segment.name}** — ${segment.memberCount} members. You can now create a campaign against it.`,
      }
    } else if (found.total > 0) {
      yield {
        type: 'text' as const,
        delta: '\n\nAsk me to "create a segment" from these and I will save the cohort.',
      }
    }
    return
  }

  if (wantsCampaign && campaigns.campaigns.length > 0) {
    yield {
      type: 'text' as const,
      delta: `There ${campaigns.campaigns.length === 1 ? 'is' : 'are'} ${campaigns.campaigns.length} campaign${campaigns.campaigns.length === 1 ? '' : 's'} in this workspace. Tell me which audience to reach (or say "all subscribed contacts") and I will draft and launch it.`,
    }
    return
  }

  if (/contact|subscriber|audience|list|how many/.test(lower)) {
    const subscribed = (await toolsByName
      .get('list_contacts')!
      .handler({ status: 'subscribed', pageSize: 5 })) as {
      total: number
      items: { firstName: string | null; email: string }[]
    }

    const names = subscribed.items
      .map((c) => c.firstName ?? c.email.split('@')[0]!)
      .join(', ')

    yield {
      type: 'text' as const,
      delta: `**${subscribed.total}** contact${subscribed.total === 1 ? ' is' : 's are'} subscribed right now.\n\nA few of them: ${names}${subscribed.total > subscribed.items.length ? '…' : ''}\n\nAsk me to save one of these as a segment, or to draft a campaign for the whole list.`,
    }
    return
  }

  const overview = (await toolsByName
    .get('get_workspace_overview')!
    .handler({ range: '30d' })) as {
    stats: { emailsSent: number; openRate: number; clickRate: number; totalContacts: number }
  }

  yield {
    type: 'text' as const,
    delta: `Here is where the workspace stands over the last 30 days:\n\n- ${overview.stats.totalContacts} contacts\n- ${overview.stats.emailsSent} emails sent\n- ${Math.round(overview.stats.openRate * 100)}% open rate, ${Math.round(overview.stats.clickRate * 100)}% click rate\n\nAsk me to find a cohort, build a segment, compose a campaign, or wire up an automation.`,
  }

  void workspaceId
}