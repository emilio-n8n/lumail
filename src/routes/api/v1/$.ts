import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

/**
 * The domain layer is server-only, and this file is part of the client route
 * tree, so it is imported lazily inside the request handlers below.
 */
type ApiKeyContext = {
  workspaceId: string
  apiKeyId: string
  scopes: string[]
  name: string
  principalUserId: string
}

type Domain = {
  apiKeyStorage: typeof import('@/lib/auth/session')['apiKeyStorage']
  resolveApiKey: typeof import('@/lib/domain/platform')['resolveApiKey']
  assertScope: typeof import('@/lib/domain/platform')['assertScope']
  contacts: typeof import('@/lib/domain/contacts')
  segmentDomain: typeof import('@/lib/domain/segments')
  campaigns: typeof import('@/lib/domain/campaigns')
  templates: typeof import('@/lib/domain/templates')
  workflows: typeof import('@/lib/domain/workflows')
  sendTransactional: typeof import('@/lib/domain/transactional')['sendTransactional']
  recordEvent: typeof import('@/lib/domain/activity')['recordEvent']
  withAdminDb: typeof import('@/integrations/database/client')['withAdminDb']
  queueEventWebhooks: typeof import('@/lib/webhooks/dispatch')['queueEventWebhooks']
}

let domainPromise: Promise<Domain> | null = null

function domain(): Promise<Domain> {
  domainPromise ??= (async () => ({
    apiKeyStorage: (await import('@/lib/auth/session')).apiKeyStorage,
    resolveApiKey: (await import('@/lib/domain/platform')).resolveApiKey,
    assertScope: (await import('@/lib/domain/platform')).assertScope,
    contacts: await import('@/lib/domain/contacts'),
    segmentDomain: await import('@/lib/domain/segments'),
    campaigns: await import('@/lib/domain/campaigns'),
    templates: await import('@/lib/domain/templates'),
    workflows: await import('@/lib/domain/workflows'),
    sendTransactional: (await import('@/lib/domain/transactional')).sendTransactional,
    recordEvent: (await import('@/lib/domain/activity')).recordEvent,
    withAdminDb: (await import('@/integrations/database/client')).withAdminDb,
    queueEventWebhooks: (await import('@/lib/webhooks/dispatch')).queueEventWebhooks,
  }))()
  return domainPromise
}

/**
 * Public REST API — `/api/v1/*`
 *
 * Authentication is an API key (`Authorization: Bearer lm_live_…`). The key
 * resolves to a workspace, and the request is then executed inside an API-key
 * async context so `requireWorkspace` authorises it exactly as it would a signed
 * in user. There is no second, weaker code path here.
 */

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }

type Ctx = {
  request: Request
  params: Record<string, string>
}

type ApiResult =
  | { status: 200 | 201; body: unknown }
  | { status: 400 | 401 | 403 | 404; body: { error: string } }

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, 'cache-control': 'no-store' },
  })
}

async function authenticate(
  request: Request,
  scope: string,
): Promise<{ context: ApiKeyContext } | { error: Response }> {
  const { resolveApiKey, assertScope } = await domain()
  const header = request.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null

  if (!token) {
    return {
      error: json(401, {
        error: 'Provide an API key as "Authorization: Bearer lm_live_…"',
      }),
    }
  }

  const key = await resolveApiKey(token)
  if (!key) {
    return { error: json(401, { error: 'That API key is invalid or revoked' }) }
  }

  try {
    assertScope(key.scopes, scope)
  } catch (error) {
    return { error: json(403, { error: (error as Error).message }) }
  }

  return {
    context: {
      workspaceId: key.workspaceId,
      apiKeyId: key.apiKeyId,
      scopes: key.scopes,
      name: key.name,
      principalUserId: key.principalUserId,
    },
  }
}

/** Runs the domain layer inside an API-key context. */
async function run<T>(
  request: Request,
  scope: string,
  handler: () => Promise<T>,
): Promise<Response> {
  const { apiKeyStorage } = await domain()
  const auth = await authenticate(request, scope)
  if ('error' in auth) return auth.error

  try {
    const result = await apiKeyStorage.run(auth.context, handler)
    return json(200, result)
  } catch (error) {
    const status = (error as { status?: number }).status ?? 400
    return json(status, { error: (error as Error).message })
  }
}

async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    return ((await request.json()) ?? {}) as Record<string, unknown>
  } catch {
    throw new Error('Request body must be valid JSON')
  }
}

const uuid = z.string().uuid()

export const Route = createFileRoute('/api/v1/$')({
  server: {
    handlers: {
      GET: async ({ request, params }: Ctx) => route(request, params, 'GET'),
      POST: async ({ request, params }: Ctx) => route(request, params, 'POST'),
      PATCH: async ({ request, params }: Ctx) => route(request, params, 'PATCH'),
      PUT: async ({ request, params }: Ctx) => route(request, params, 'PUT'),
      DELETE: async ({ request, params }: Ctx) => route(request, params, 'DELETE'),
    },
  },
})

async function route(
  request: Request,
  params: Record<string, string>,
  method: string,
): Promise<Response> {
  const {
    contacts,
    segmentDomain,
    campaigns,
    templates,
    workflows,
    sendTransactional,
    recordEvent,
    withAdminDb,
    queueEventWebhooks,
  } = await domain()

  const path = (params._splat ?? '').replace(/^\/+|\/+$/g, '')
  const segments = path.split('/').filter(Boolean)
  const resource = segments[0] ?? ''
  const id = segments[1]

  const url = new URL(request.url)

  switch (resource) {
    /* ------------------------------------------------------------ contacts */
    case 'contacts': {
      if (method === 'GET' && !id) {
        return run(request, 'contacts:read', async () => {
          const tagNames = url.searchParams.getAll('tag')
          const tags = tagNames.length ? await contacts.listTags() : []
          return contacts.listContacts({
            page: Number(url.searchParams.get('page') ?? 1),
            pageSize: Number(url.searchParams.get('pageSize') ?? 25),
            search: url.searchParams.get('search') ?? undefined,
            status: url.searchParams.get('status'),
            tagIds: tags
              .filter((tag) => tagNames.includes(tag.name))
              .map((tag) => tag.id),
            sort: (url.searchParams.get('sort') as never) ?? undefined,
            direction: (url.searchParams.get('direction') as never) ?? undefined,
            segmentId: url.searchParams.get('segment'),
          })
        })
      }

      if (method === 'GET' && id) {
        return run(request, 'contacts:read', () => contacts.getContact(uuid.parse(id)))
      }

      if (method === 'POST' && !id) {
        return run(request, 'contacts:write', async () => {
          const payload = await body(request)
          return { contact: await contacts.createContact(payload as never) }
        })
      }

      if ((method === 'PATCH' || method === 'PUT') && id) {
        return run(request, 'contacts:write', async () => {
          const payload = await body(request)
          return {
            contact: await contacts.updateContact(uuid.parse(id), payload as never),
          }
        })
      }

      if (method === 'DELETE' && id) {
        return run(request, 'contacts:write', async () => ({
          deleted: await contacts.deleteContacts([uuid.parse(id)]),
        }))
      }
      break
    }

    /* ------------------------------------------------------------ segments */
    case 'segments': {
      if (method === 'GET' && !id) {
        return run(request, 'segments:read', async () => ({
          segments: await segmentDomain.listSegments(),
        }))
      }

      if (method === 'GET' && id) {
        return run(request, 'segments:read', async () => {
          const segment = await segmentDomain.getSegment(uuid.parse(id))
          const members = await segmentDomain.getSegmentMembers(
            segment.id,
            Number(url.searchParams.get('page') ?? 1),
            Number(url.searchParams.get('pageSize') ?? 25),
          )
          return { ...segment, members }
        })
      }

      if (method === 'POST' && !id) {
        return run(request, 'segments:write', async () => {
          const payload = await body(request)
          return { segment: await segmentDomain.createSegment(payload as never) }
        })
      }

      if ((method === 'PATCH' || method === 'PUT') && id) {
        return run(request, 'segments:write', async () => {
          const payload = await body(request)
          return {
            segment: await segmentDomain.updateSegment(uuid.parse(id), payload as never),
          }
        })
      }

      if (method === 'DELETE' && id) {
        return run(request, 'segments:write', async () => {
          await segmentDomain.deleteSegment(uuid.parse(id))
          return { deleted: true }
        })
      }

      if (method === 'POST' && segments[2] === 'members') {
        return run(request, 'segments:write', async () => {
          const payload = await body(request)
          return {
            updated: await segmentDomain.setSegmentMembers(
              uuid.parse(id!),
              payload.contactIds as string[],
              (payload.mode as 'add' | 'remove') ?? 'add',
            ),
          }
        })
      }
      break
    }

    /* ----------------------------------------------------------- campaigns */
    case 'campaigns': {
      if (method === 'GET' && !id) {
        return run(request, 'campaigns:read', async () => ({
          campaigns: await campaigns.listCampaigns({
            status: url.searchParams.get('status'),
            search: url.searchParams.get('search') ?? undefined,
            limit: Number(url.searchParams.get('limit') ?? 100),
          }),
        }))
      }

      if (method === 'GET' && id) {
        return run(request, 'campaigns:read', () => campaigns.getCampaign(uuid.parse(id)))
      }

      if (method === 'POST' && !id) {
        return run(request, 'campaigns:write', async () => {
          const payload = await body(request)
          return { campaign: await campaigns.createCampaign(payload as never) }
        })
      }

      if ((method === 'PATCH' || method === 'PUT') && id) {
        return run(request, 'campaigns:write', async () => {
          const payload = await body(request)
          return {
            campaign: await campaigns.updateCampaign(uuid.parse(id), payload as never),
          }
        })
      }

      if (method === 'DELETE' && id) {
        return run(request, 'campaigns:write', async () => {
          await campaigns.deleteCampaign(uuid.parse(id))
          return { deleted: true }
        })
      }

      if (method === 'POST' && segments[2] === 'send' && id) {
        return run(request, 'campaigns:write', () =>
          campaigns.launchCampaign(uuid.parse(id)),
        )
      }

      if (method === 'POST' && segments[2] === 'schedule' && id) {
        return run(request, 'campaigns:write', async () => {
          const payload = await body(request)
          return {
            campaign: await campaigns.scheduleCampaign(
              uuid.parse(id),
              new Date(payload.scheduledAt as string),
            ),
          }
        })
      }

      if (method === 'GET' && segments[2] === 'analytics' && id) {
        return run(request, 'analytics:read', () =>
          campaigns.campaignStats(uuid.parse(id)),
        )
      }
      break
    }

    /* ----------------------------------------------------------- templates */
    case 'templates': {
      if (method === 'GET' && !id) {
        return run(request, 'templates:read', async () => ({
          templates: await templates.listTemplates({
            category: url.searchParams.get('category'),
            search: url.searchParams.get('search') ?? undefined,
          }),
        }))
      }

      if (method === 'GET' && id) {
        return run(request, 'templates:read', () => templates.getTemplate(uuid.parse(id)))
      }

      if (method === 'POST' && !id) {
        return run(request, 'templates:write', async () => {
          const payload = await body(request)
          return { template: await templates.createTemplate(payload as never) }
        })
      }

      if ((method === 'PATCH' || method === 'PUT') && id) {
        return run(request, 'templates:write', async () => {
          const payload = await body(request)
          return {
            template: await templates.updateTemplate(uuid.parse(id), payload as never),
          }
        })
      }

      if (method === 'DELETE' && id) {
        return run(request, 'templates:write', async () => {
          await templates.deleteTemplate(uuid.parse(id))
          return { deleted: true }
        })
      }
      break
    }

    /* ----------------------------------------------------------- workflows */
    case 'workflows': {
      if (method === 'GET' && !id) {
        return run(request, 'workflows:read', async () => ({
          workflows: await workflows.listWorkflows(),
        }))
      }

      if (method === 'GET' && id) {
        return run(request, 'workflows:read', () => workflows.getWorkflow(uuid.parse(id)))
      }

      if (method === 'POST' && !id) {
        return run(request, 'workflows:write', async () => {
          const payload = await body(request)
          return { workflow: await workflows.createWorkflow(payload as never) }
        })
      }

      if ((method === 'PATCH' || method === 'PUT') && id) {
        return run(request, 'workflows:write', async () => {
          const payload = await body(request)
          return {
            workflow: await workflows.updateWorkflow(uuid.parse(id), payload as never),
          }
        })
      }

      if (method === 'DELETE' && id) {
        return run(request, 'workflows:write', async () => {
          await workflows.deleteWorkflow(uuid.parse(id))
          return { deleted: true }
        })
      }

      if (method === 'POST' && segments[2] === 'activate' && id) {
        return run(request, 'workflows:write', () =>
          workflows.setWorkflowStatus(uuid.parse(id), 'active'),
        )
      }

      if (method === 'POST' && segments[2] === 'pause' && id) {
        return run(request, 'workflows:write', () =>
          workflows.setWorkflowStatus(uuid.parse(id), 'paused'),
        )
      }

      if (method === 'GET' && segments[2] === 'runs') {
        return run(request, 'workflows:read', async () => ({
          runs: await workflows.listWorkflowRuns(id ?? null, 100),
        }))
      }
      break
    }

    /* ---------------------------------------------------------------- email */
    case 'emails': {
      if (method === 'POST' && !id) {
        return run(request, 'emails:send', async () => {
          const payload = await body(request)
          return sendTransactional(payload as never)
        })
      }

      // The outbound ledger behind `/app/transactional`, queryable per kind.
      if (method === 'GET' && !id) {
        return run(request, 'analytics:read', async () => {
          const { requireWorkspaceMember } = await import(
            '@/integrations/database/auth-runtime'
          )
          const { listMessages } = await import('@/lib/email/messages')
          const { workspaceId } = await requireWorkspaceMember()
          const messages = await listMessages({
            workspaceId,
            kind: (url.searchParams.get('kind') as never) ?? null,
            status: url.searchParams.get('status'),
            campaignId: url.searchParams.get('campaignId'),
            search: url.searchParams.get('search') ?? undefined,
            limit: Number(url.searchParams.get('limit') ?? 100),
          })
          return { messages }
        })
      }
      break
    }

    /* --------------------------------------------------------------- events */
    case 'events': {
      if (method === 'POST' && !id) {
        return run(request, 'contacts:write', async () => {
          const payload = await body(request)
          const { requireWorkspaceMember } = await import(
            '@/integrations/database/auth-runtime'
          )
          const { workspaceId } = await requireWorkspaceMember()

          const id = await withAdminDb((tx) =>
            recordEvent(tx, {
              workspaceId,
              contactId: (payload.contactId as string) ?? null,
              eventType: 'custom',
              metadata: {
                name: payload.name,
                ...((payload.data as Record<string, unknown>) ?? {}),
              },
            }),
          )

          const { handleTrigger } = await import('@/lib/workflows/engine')
          const started = await handleTrigger({
            type: 'custom_event',
            workspaceId,
            contactId: payload.contactId as string,
            data: { eventName: payload.name },
          })

          await queueEventWebhooks(workspaceId, 'contact.updated', {
            event: payload.name,
            contactId: payload.contactId,
          })

          return { eventId: id, automationsStarted: started }
        })
      }
      break
    }

    /* ------------------------------------------------------------ discovery */
    case '':
      return json(200, {
        name: 'Lumail API',
        version: 'v1',
        resources: [
          '/api/v1/contacts',
          '/api/v1/segments',
          '/api/v1/campaigns',
          '/api/v1/templates',
          '/api/v1/workflows',
          '/api/v1/emails',
          '/api/v1/events',
        ],
        authentication: 'Authorization: Bearer lm_live_…',
      })

    default:
      break
  }

  return json(404, { error: `No route for ${method} /api/v1/${path}` })
}