import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { apiKeyStorage, type ApiKeyContext } from '@/lib/auth/session'
import { resolveApiKey, assertScope } from '@/lib/domain/platform'
import { tools, type ToolDefinition } from '@/lib/ai/tools'
import { getAppUrl } from '@/lib/email/send'
import { resolveSession } from '@/lib/auth/session'
import { ensureJobTicker } from '@/lib/jobs/ticker'

/**
 * MCP server — served by the application at `/mcp`.
 *
 * Running inside the app process matters: the embedded database is a
 * single-connection resource, and — more importantly — serving MCP in-process
 * means every tool call goes through the exact same domain services the
 * dashboard uses. There is no second implementation to drift.
 *
 * Authentication accepts either a signed-in session (so you can point an agent
 * at your own workspace from the browser) or a workspace API key.
 */

export type McpAuth = { kind: 'api-key'; context: ApiKeyContext } | { kind: 'session' }

async function authenticate(request: Request): Promise<McpAuth | null> {
  const header = request.headers.get('authorization') ?? ''
  if (header.startsWith('Bearer ')) {
    const resolved = await resolveApiKey(header.slice(7))
    if (!resolved) return null
    return {
      kind: 'api-key',
      context: {
        workspaceId: resolved.workspaceId,
        apiKeyId: resolved.apiKeyId,
        scopes: resolved.scopes,
        name: resolved.name,
        principalUserId: resolved.principalUserId,
      },
    }
  }

  const session = await resolveSession()
  return session ? { kind: 'session' } : null
}

export async function handleMcpRequest(request: Request): Promise<Response> {
  ensureJobTicker()

  const auth = await authenticate(request)
  if (!auth) {
    return new Response(
      JSON.stringify({
        error: 'unauthorized',
        message:
          'Provide a workspace API key (Authorization: Bearer lm_live_…) or sign in and pass the session cookie.',
      }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    )
  }

  // Build a fresh server per request: stateless transport, no session leaks
  // between agents.
  const server = buildServer(auth)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  })

  await server.connect(transport)

  const response = await transport.handleRequest(request)
  return response
}

function buildServer(auth: McpAuth): McpServer {
  const server = new McpServer(
    { name: 'lumail', version: '1.0.0' },
    {
      capabilities: { tools: {} },
      instructions: `Lumail is an email marketing platform: contacts, segments, campaigns, templates,
automations, transactional sends and analytics.

These tools are the same operations the Lumail dashboard performs. A typical flow:

1. Call \`describe_capabilities\` if you are unsure about field, operator or node names.
2. Use \`search_contacts\` to find a cohort, then \`create_segment\` to save it.
3. Use \`create_campaign\` then \`send_campaign\` or \`schedule_campaign\` to reach them.
4. Use \`create_workflow\` then \`activate_workflow\` for lifecycle journeys.
5. Read results with \`get_campaign_analytics\` and \`get_contact_activity\`.

Merge variables use double braces: {{firstName}}, {{company}}.

Lumail instance: ${getAppUrl()}`,
    },
  )

  for (const tool of tools as ToolDefinition[]) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.schema,
        annotations: {
          readOnlyHint: tool.scope.endsWith(':read'),
          destructiveHint:
            tool.name === 'delete_contacts' || tool.name === 'delete_segment',
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      (async (args: Record<string, unknown>) => {
        if (auth.kind === 'api-key') {
          try {
            assertScope(auth.context.scopes, tool.scope)
          } catch (error) {
            return {
              isError: true,
              content: [{ type: 'text' as const, text: (error as Error).message }],
            }
          }
        }

        try {
          const run = () => tool.handler(args ?? {})
          const result =
            auth.kind === 'api-key'
              ? await apiKeyStorage.run(auth.context, run)
              : await run()

          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          }
        } catch (error) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: `${tool.name} failed: ${(error as Error).message}`,
              },
            ],
          }
        }
      }) as never,
    )
  }

  return server
}