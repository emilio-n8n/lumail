import { createFileRoute } from '@tanstack/react-router'

/**
 * MCP endpoint: POST|GET|DELETE /mcp
 *
 * Point any MCP client at this URL. Authenticate with a workspace API key
 * (`Authorization: Bearer lm_live_…`) or with the dashboard session cookie.
 */
export const Route = createFileRoute('/mcp')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleMcpRequest } = await import('@/lib/mcp/server')
        return handleMcpRequest(request)
      },
      POST: async ({ request }) => {
        const { handleMcpRequest } = await import('@/lib/mcp/server')
        return handleMcpRequest(request)
      },
      DELETE: async ({ request }) => {
        const { handleMcpRequest } = await import('@/lib/mcp/server')
        return handleMcpRequest(request)
      },
    },
  },
})