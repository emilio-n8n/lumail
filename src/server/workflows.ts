import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { z } from 'zod'
import { guard } from './auth'
import { WEBHOOK_EVENTS } from '@/lib/webhooks/events'
import type { WorkflowDefinition } from '@/lib/domain/types'

/**
 * Automations, analytics, platform settings and transactional email.
 * Domain modules are loaded lazily (see auth.ts).
 */
const loadDeps = createServerOnlyFn(async () => {
  const [
    workflows,
    analytics,
    platform,
    workspace,
    messages,
    ticker,
    runner,
    email,
    authRuntime,
  ] = await Promise.all([
    import('@/lib/domain/workflows'),
    import('@/lib/domain/analytics'),
    import('@/lib/domain/platform'),
    import('@/lib/domain/workspace'),
    import('@/lib/email/messages'),
    import('@/lib/jobs/ticker'),
    import('@/lib/jobs/runner'),
    import('@/lib/email/index'),
    import('@/integrations/database/auth-runtime'),
  ])
  return {
    workflows,
    analytics,
    platform,
    workspace,
    messages,
    ensureJobTicker: ticker.ensureJobTicker,
    jobHealth: runner.jobHealth,
    runDueJobs: runner.runDueJobs,
    providerHealth: email.providerHealth,
    isLiveProvider: email.isLiveProvider,
    requireWorkspaceAdmin: authRuntime.requireWorkspaceAdmin,
    requireWorkspaceMember: authRuntime.requireWorkspaceMember,
  }
})

function load() {
  return loadDeps()
}

/** Automations, analytics, platform settings and transactional email. */

const definitionSchema: z.ZodType<WorkflowDefinition> = z.object({
  nodes: z.array(z.any()),
  edges: z.array(z.any()),
})

export const workflowList = createServerFn({ method: 'GET' }).handler(async () =>
    guard(async () => (await load()).workflows.listWorkflows()),
  )

export const workflowGet = createServerFn({ method: 'GET' })
    .validator(z.object({ id: z.string().uuid() }))
    .handler(async ({ data }) => guard(async () => (await load()).workflows.getWorkflow(data.id)))

export const workflowCreate = createServerFn({ method: 'POST' })
    .validator(
      z.object({
        name: z.string().min(1, 'Give the automation a name'),
        description: z.string().nullable().optional(),
        trigger: z.record(z.string(), z.unknown()).optional(),
        definition: definitionSchema,
      }),
    )
    .handler(async ({ data }) => guard(async () => (await load()).workflows.createWorkflow(data as never)))

export const workflowUpdate = createServerFn({ method: 'POST' })
    .validator(
      z.object({
        id: z.string().uuid(),
        name: z.string().optional(),
        description: z.string().nullable().optional(),
        trigger: z.record(z.string(), z.unknown()).optional(),
        definition: definitionSchema.optional(),
        status: z.enum(['draft', 'active', 'paused', 'archived']).optional(),
      }),
    )
    .handler(({ data }) => {
      const { id, ...patch } = data
      return guard(async () => (await load()).workflows.updateWorkflow(id, patch as never))
    })

export const workflowSetStatus = createServerFn({ method: 'POST' })
    .validator(
      z.object({
        id: z.string().uuid(),
        status: z.enum(['draft', 'active', 'paused', 'archived']),
      }),
    )
    .handler(async ({ data }) =>
      guard(async () => {
      const { workflows, analytics, platform, workspace, messages,
        ensureJobTicker, jobHealth, runDueJobs, providerHealth, isLiveProvider,
        requireWorkspaceAdmin, requireWorkspaceMember } = await load()
        ensureJobTicker()
        return workflows.setWorkflowStatus(data.id, data.status)
      }),
    )

export const workflowRemove = createServerFn({ method: 'POST' })
    .validator(z.object({ id: z.string().uuid() }))
    .handler(async ({ data }) => guard(async () => (await load()).workflows.deleteWorkflow(data.id)))

export const workflowRuns = createServerFn({ method: 'GET' })
    .validator(
      z.object({
        workflowId: z.string().uuid().nullable().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
    )
    .handler(async ({ data }) => guard(async () => (await load()).workflows.listWorkflowRuns(data.workflowId, data.limit)))

export const workflowNodeRuns = createServerFn({ method: 'GET' })
    .validator(z.object({ runId: z.string().uuid() }))
    .handler(async ({ data }) => guard(async () => (await load()).workflows.workflowNodeRuns(data.runId)))

export const workflowStats = createServerFn({ method: 'GET' }).handler(async () =>
    guard(async () => (await load()).workflows.workflowStats()),
  )

export const workflowEnroll = createServerFn({ method: 'POST' })
    .validator(
      z.object({
        workflowId: z.string().uuid(),
        contactId: z.string().uuid(),
      }),
    )
    .handler(({ data }) =>
      guard(async () => {
      const { workflows, analytics, platform, workspace, messages,
        ensureJobTicker, jobHealth, runDueJobs, providerHealth, isLiveProvider,
        requireWorkspaceAdmin, requireWorkspaceMember } = await load()
        const { startRun } = await import('@/lib/workflows/engine')
        const { resolveSession } = await import('@/lib/auth/session')
        const session = await resolveSession()
        if (!session?.workspaceId) throw new Error('No workspace selected')
        const started = await startRun(data.workflowId, {
          type: 'manual',
          workspaceId: session.workspaceId,
          contactId: data.contactId,
        })
        return { started }
      }),
    )

export const workflowServerFns = {
  list: workflowList,
  get: workflowGet,
  create: workflowCreate,
  update: workflowUpdate,
  setStatus: workflowSetStatus,
  remove: workflowRemove,
  runs: workflowRuns,
  nodeRuns: workflowNodeRuns,
  stats: workflowStats,
  enroll: workflowEnroll,
}


export const analyticsOverview = createServerFn({ method: 'GET' })
    .validator(z.object({ range: z.enum(['24h', '7d', '30d', '90d']).optional() }))
    .handler(async ({ data }) =>
      guard(async () => {
        const { analytics, ensureJobTicker } = await load()
        ensureJobTicker()
        const range = data?.range ?? '30d'
        const [stats, series, campaigns, activity, workflows, funnel, growth, links] =
          await Promise.all([
            analytics.overviewStats(range),
            analytics.timeseries(range),
            analytics.topCampaigns(6),
            analytics.recentActivity(12),
            analytics.workflowPerformance(),
            analytics.funnelBreakdown(range),
            analytics.contactGrowth(range),
            analytics.linkPerformance(6),
          ])
        return {
          stats,
          series,
          campaigns,
          activity,
          workflows,
          funnel,
          growth,
          links,
        }
      }),
    )

export const analyticsCampaignStats = createServerFn({ method: 'GET' })
    .validator(z.object({ id: z.string().uuid() }))
    .handler(({ data }) =>
      guard(async () => {
      const { workflows, analytics, platform, workspace, messages,
        ensureJobTicker, jobHealth, runDueJobs, providerHealth, isLiveProvider,
        requireWorkspaceAdmin, requireWorkspaceMember } = await load()
        const [stats, series] = await Promise.all([
          import('@/lib/domain/campaigns').then((module) => module.campaignStats(data.id)),
          import('@/lib/domain/analytics').then((module) => module.timeseries('30d')),
        ])
        return { stats, series }
      }),
    )

export const analyticsServerFns = {
  overview: analyticsOverview,
  campaignStats: analyticsCampaignStats,
}


export const settingsContext = createServerFn({ method: 'GET' }).handler(async () =>
    guard(async () => (await load()).workspace.getWorkspaceContext()),
  )

export const settingsUpdateWorkspace = createServerFn({ method: 'POST' })
    .validator(
      z.object({
        name: z.string().min(1).optional(),
        timezone: z.string().optional(),
        fromName: z.string().nullable().optional(),
      }),
    )
    .handler(async ({ data }) => guard(async () => (await load()).workspace.updateWorkspace(data)))

export const settingsCreateWorkspace = createServerFn({ method: 'POST' })
    .validator(z.object({ name: z.string().min(1, 'Give the workspace a name') }))
    .handler(async ({ data }) => guard(async () => (await load()).workspace.createWorkspace(data)))

export const settingsMembers = createServerFn({ method: 'GET' }).handler(async () =>
    guard(async () => (await load()).workspace.listMembers()),
  )

export const settingsUpdateMemberRole = createServerFn({ method: 'POST' })
    .validator(
      z.object({
        memberId: z.string().uuid(),
        role: z.enum(['owner', 'admin', 'member']),
      }),
    )
    .handler(async ({ data }) =>
      guard(async () => (await load()).workspace.updateMemberRole(data.memberId, data.role)),
    )

export const settingsRemoveMember = createServerFn({ method: 'POST' })
    .validator(z.object({ memberId: z.string().uuid() }))
    .handler(async ({ data }) => guard(async () => (await load()).workspace.removeMember(data.memberId)))

export const settingsInvite = createServerFn({ method: 'POST' })
    .validator(
      z.object({
        email: z.string().email(),
        role: z.enum(['owner', 'admin', 'member']),
      }),
    )
    .handler(async ({ data }) => guard(async () => (await load()).workspace.createInvite(data)))

export const settingsInvites = createServerFn({ method: 'GET' }).handler(async () =>
    guard(async () => (await load()).workspace.listInvites()),
  )

export const settingsServerFns = {
  context: settingsContext,
  updateWorkspace: settingsUpdateWorkspace,
  createWorkspace: settingsCreateWorkspace,
  members: settingsMembers,
  updateMemberRole: settingsUpdateMemberRole,
  removeMember: settingsRemoveMember,
  invite: settingsInvite,
  invites: settingsInvites,
}


export const platformApiKeys = createServerFn({ method: 'GET' }).handler(() =>
    guard(async () => {
      const { workflows, analytics, platform, workspace, messages,
        ensureJobTicker, jobHealth, runDueJobs, providerHealth, isLiveProvider,
        requireWorkspaceAdmin, requireWorkspaceMember } = await load()
      const context = await requireWorkspaceAdmin()
      return { keys: await platform.listApiKeys(context), scopes: platform.API_KEY_SCOPES }
    }),
  )

export const platformCreateApiKey = createServerFn({ method: 'POST' })
    .validator(
      z.object({
        name: z.string().min(1, 'Give the key a name'),
        scopes: z.array(z.string()).optional(),
      }),
    )
    .handler(({ data }) =>
      guard(async () => {
      const { workflows, analytics, platform, workspace, messages,
        ensureJobTicker, jobHealth, runDueJobs, providerHealth, isLiveProvider,
        requireWorkspaceAdmin, requireWorkspaceMember } = await load()
        const context = await requireWorkspaceAdmin()
        return platform.createApiKey(context, data)
      }),
    )

export const platformRevokeApiKey = createServerFn({ method: 'POST' })
    .validator(z.object({ id: z.string().uuid() }))
    .handler(({ data }) =>
      guard(async () => {
      const { workflows, analytics, platform, workspace, messages,
        ensureJobTicker, jobHealth, runDueJobs, providerHealth, isLiveProvider,
        requireWorkspaceAdmin, requireWorkspaceMember } = await load()
        const context = await requireWorkspaceAdmin()
        await platform.revokeApiKey(context, data.id)
        return { ok: true }
      }),
    )

export const platformDomains = createServerFn({ method: 'GET' }).handler(() =>
    guard(async () => {
      const { workflows, analytics, platform, workspace, messages,
        ensureJobTicker, jobHealth, runDueJobs, providerHealth, isLiveProvider,
        requireWorkspaceAdmin, requireWorkspaceMember } = await load()
      const context = await requireWorkspaceMember()
      const { getAppUrl } = await import('@/lib/email/send')
      return {
        domains: await platform.listDomains(context, getAppUrl()),
        health: await providerHealth(),
        live: isLiveProvider(),
      }
    }),
  )

export const platformAddDomain = createServerFn({ method: 'POST' })
    .validator(z.object({ name: z.string().min(3, 'Enter a domain name') }))
    .handler(({ data }) =>
      guard(async () => {
      const { workflows, analytics, platform, workspace, messages,
        ensureJobTicker, jobHealth, runDueJobs, providerHealth, isLiveProvider,
        requireWorkspaceAdmin, requireWorkspaceMember } = await load()
        const context = await requireWorkspaceAdmin()
        return platform.addDomain(context, data.name)
      }),
    )

export const platformVerifyDomain = createServerFn({ method: 'POST' })
    .validator(z.object({ id: z.string().uuid() }))
    .handler(({ data }) =>
      guard(async () => {
      const { workflows, analytics, platform, workspace, messages,
        ensureJobTicker, jobHealth, runDueJobs, providerHealth, isLiveProvider,
        requireWorkspaceAdmin, requireWorkspaceMember } = await load()
        const context = await requireWorkspaceAdmin()
        const { getAppUrl } = await import('@/lib/email/send')
        return platform.verifyDomain(context, data.id, getAppUrl())
      }),
    )

export const platformSetDefaultDomain = createServerFn({ method: 'POST' })
    .validator(z.object({ id: z.string().uuid() }))
    .handler(({ data }) =>
      guard(async () => {
      const { workflows, analytics, platform, workspace, messages,
        ensureJobTicker, jobHealth, runDueJobs, providerHealth, isLiveProvider,
        requireWorkspaceAdmin, requireWorkspaceMember } = await load()
        const context = await requireWorkspaceAdmin()
        await platform.setDefaultDomain(context, data.id)
        return { ok: true }
      }),
    )

export const platformDeleteDomain = createServerFn({ method: 'POST' })
    .validator(z.object({ id: z.string().uuid() }))
    .handler(({ data }) =>
      guard(async () => {
      const { workflows, analytics, platform, workspace, messages,
        ensureJobTicker, jobHealth, runDueJobs, providerHealth, isLiveProvider,
        requireWorkspaceAdmin, requireWorkspaceMember } = await load()
        const context = await requireWorkspaceAdmin()
        await platform.deleteDomain(context, data.id)
        return { ok: true }
      }),
    )

export const platformWebhooks = createServerFn({ method: 'GET' }).handler(() =>
    guard(async () => {
      const { workflows, analytics, platform, workspace, messages,
        ensureJobTicker, jobHealth, runDueJobs, providerHealth, isLiveProvider,
        requireWorkspaceAdmin, requireWorkspaceMember } = await load()
      const context = await requireWorkspaceAdmin()
      return {
        webhooks: await platform.listWebhooks(context),
        deliveries: await platform.listWebhookDeliveries(context, null, 25),
        events: WEBHOOK_EVENTS,
      }
    }),
  )

export const platformCreateWebhook = createServerFn({ method: 'POST' })
    .validator(
      z.object({
        url: z.string().url('Enter a valid URL'),
        events: z.array(z.string()).min(1, 'Pick at least one event'),
        description: z.string().nullable().optional(),
      }),
    )
    .handler(({ data }) =>
      guard(async () => {
      const { workflows, analytics, platform, workspace, messages,
        ensureJobTicker, jobHealth, runDueJobs, providerHealth, isLiveProvider,
        requireWorkspaceAdmin, requireWorkspaceMember } = await load()
        const context = await requireWorkspaceAdmin()
        return platform.createWebhook(context, data)
      }),
    )

export const platformUpdateWebhook = createServerFn({ method: 'POST' })
    .validator(
      z.object({
        id: z.string().uuid(),
        url: z.string().url().optional(),
        events: z.array(z.string()).optional(),
        isActive: z.boolean().optional(),
        description: z.string().nullable().optional(),
      }),
    )
    .handler(({ data }) =>
      guard(async () => {
      const { workflows, analytics, platform, workspace, messages,
        ensureJobTicker, jobHealth, runDueJobs, providerHealth, isLiveProvider,
        requireWorkspaceAdmin, requireWorkspaceMember } = await load()
        const context = await requireWorkspaceAdmin()
        const { id, ...patch } = data
        return platform.updateWebhook(context, id, patch)
      }),
    )

export const platformDeleteWebhook = createServerFn({ method: 'POST' })
    .validator(z.object({ id: z.string().uuid() }))
    .handler(({ data }) =>
      guard(async () => {
      const { workflows, analytics, platform, workspace, messages,
        ensureJobTicker, jobHealth, runDueJobs, providerHealth, isLiveProvider,
        requireWorkspaceAdmin, requireWorkspaceMember } = await load()
        const context = await requireWorkspaceAdmin()
        await platform.deleteWebhook(context, data.id)
        return { ok: true }
      }),
    )

export const platformJobs = createServerFn({ method: 'GET' }).handler(() =>
    guard(async () => {
      const { workflows, analytics, platform, workspace, messages,
        ensureJobTicker, jobHealth, runDueJobs, providerHealth, isLiveProvider,
        requireWorkspaceAdmin, requireWorkspaceMember } = await load()
      await requireWorkspaceMember()
      ensureJobTicker()
      return jobHealth()
    }),
  )

export const platformRunJobs = createServerFn({ method: 'POST' })
    .validator(z.object({ limit: z.number().int().min(1).max(200).optional() }))
    .handler(async ({ data }) =>
      guard(async () => {
        const { runDueJobs, requireWorkspaceMember } = await load()
        await requireWorkspaceMember()
        return runDueJobs(data?.limit ?? 25)
      }),
    )

export const platformServerFns = {
  apiKeys: platformApiKeys,
  createApiKey: platformCreateApiKey,
  revokeApiKey: platformRevokeApiKey,
  domains: platformDomains,
  addDomain: platformAddDomain,
  verifyDomain: platformVerifyDomain,
  setDefaultDomain: platformSetDefaultDomain,
  deleteDomain: platformDeleteDomain,
  webhooks: platformWebhooks,
  createWebhook: platformCreateWebhook,
  updateWebhook: platformUpdateWebhook,
  deleteWebhook: platformDeleteWebhook,
  jobs: platformJobs,
  runJobs: platformRunJobs,
}


export const transactionalLogs = createServerFn({ method: 'GET' })
    .validator(
      z.object({
        search: z.string().nullable().optional(),
        status: z.string().nullable().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      }),
    )
    .handler(async ({ data }) =>
      guard(async () => {
      const { workflows, analytics, platform, workspace, messages,
        ensureJobTicker, jobHealth, runDueJobs, providerHealth, isLiveProvider,
        requireWorkspaceAdmin, requireWorkspaceMember } = await load()
        const { workspaceId } = await requireWorkspaceMember()
        return messages.listMessages({
          workspaceId,
          kind: 'transactional',
          search: data?.search ?? null,
          status: data?.status ?? null,
          limit: data?.limit ?? 100,
        })
      }),
    )

export const transactionalSend = createServerFn({ method: 'POST' })
    .validator(
      z.object({
        to: z.string().email(),
        subject: z.string().min(1, 'Add a subject line'),
        templateId: z.string().uuid().optional(),
        templateName: z.string().optional(),
        html: z.string().optional(),
        variables: z.record(z.string(), z.string()).optional(),
      }),
    )
    .handler(({ data }) =>
      guard(async () => {
      const { workflows, analytics, platform, workspace, messages,
        ensureJobTicker, jobHealth, runDueJobs, providerHealth, isLiveProvider,
        requireWorkspaceAdmin, requireWorkspaceMember } = await load()
        const { sendTransactional } = await import('@/lib/domain/transactional')
        return sendTransactional(data)
      }),
    )

export const transactionalServerFns = {
  logs: transactionalLogs,
  send: transactionalSend,
}
