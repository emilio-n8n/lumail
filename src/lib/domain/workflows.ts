import { many, one, withAuthenticatedDb, withAdminDb } from '@/integrations/database/client'
import type { Tx } from '@/integrations/database/client'
import { requireWorkspaceMember } from '@/integrations/database/auth-runtime'
import { NotFoundError, ValidationError } from '@/lib/auth/session'
import { mapWorkflow, mapWorkflowRun } from './mappers'
import { queueEventWebhooks } from '@/lib/webhooks/dispatch'
import type { JsonObject,
  Workflow,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowStatus,
} from './types'

import { WORKFLOW_NODE_TYPES, WORKFLOW_TRIGGERS } from './workflow-types'

export { WORKFLOW_NODE_TYPES, WORKFLOW_TRIGGERS }

export type WorkflowInput = {
  name: string
  description?: string | null
  trigger?: Record<string, unknown>
  definition: WorkflowDefinition
}

export async function listWorkflows(): Promise<
  (Workflow & { enrolled: number; active: number })[]
> {
  const { userId, workspaceId } = await requireWorkspaceMember()

  return withAuthenticatedDb({ userId, workspaceId }, async (tx) => {
    const rows = await many<Record<string, any>>(
      tx,
      `
      select w.*,
        (select count(*)::int from public.workflow_enrollments e where e.workflow_id = w.id and e.completed_at is null) as enrolled,
        (select count(*)::int from public.workflow_runs r where r.workflow_id = w.id and r.status = 'running') as active
      from public.workflows w
      order by w.updated_at desc
      `,
    )
    return rows.map((row) => ({
      ...mapWorkflow(row),
      enrolled: Number(row.enrolled),
      active: Number(row.active),
    }))
  })
}

export async function getWorkflow(id: string): Promise<Workflow> {
  const { userId, workspaceId } = await requireWorkspaceMember()
  return withAuthenticatedDb({ userId, workspaceId }, async (tx) => {
    const row = await one<Record<string, any>>(
      tx,
      'select * from public.workflows where id = $1',
      [id],
    )
    if (!row) throw new NotFoundError('Workflow not found')
    return mapWorkflow(row)
  })
}

export async function createWorkflow(input: WorkflowInput): Promise<Workflow> {
  const { userId, workspaceId } = await requireWorkspaceMember()

  validateDefinition(input.definition)

  return withAuthenticatedDb({ userId, workspaceId }, async (tx) => {
    const row = await one<Record<string, any>>(
      tx,
      `
      insert into public.workflows (
        workspace_id, name, description, status, trigger, definition, created_by
      )
      values ($1,$2,$3,'draft',$4,$5,$6)
      returning *
      `,
      [
        workspaceId,
        input.name,
        input.description ?? null,
        JSON.stringify(input.trigger ?? { type: 'contact_created' }),
        JSON.stringify(input.definition),
        userId,
      ],
    )
    return mapWorkflow(row!)
  })
}

export async function updateWorkflow(
  id: string,
  patch: Partial<WorkflowInput> & { status?: WorkflowStatus },
): Promise<Workflow> {
  const { userId, workspaceId } = await requireWorkspaceMember()

  if (patch.definition) validateDefinition(patch.definition)

  const row = await withAuthenticatedDb({ userId, workspaceId }, (tx) =>
    one<Record<string, any>>(
      tx,
      `
      update public.workflows set
        name = coalesce($2, name),
        description = coalesce($3, description),
        trigger = coalesce($4, trigger),
        definition = coalesce($5, definition),
        status = coalesce($6, status),
        activated_at = case when $6 = 'active' and activated_at is null then now() else activated_at end,
        updated_at = now()
      where id = $1
      returning *
      `,
      [
        id,
        patch.name ?? null,
        patch.description ?? null,
        patch.trigger ? JSON.stringify(patch.trigger) : null,
        patch.definition ? JSON.stringify(patch.definition) : null,
        patch.status ?? null,
      ],
    ),
  )

  if (!row) throw new NotFoundError('Workflow not found')

  if (patch.status === 'active') {
    await queueEventWebhooks(workspaceId, 'workflow.activated', { workflowId: id })
  }
  if (patch.status === 'paused') {
    await queueEventWebhooks(workspaceId, 'workflow.paused', { workflowId: id })
  }

  return mapWorkflow(row)
}

export async function setWorkflowStatus(
  id: string,
  status: WorkflowStatus,
): Promise<Workflow> {
  return updateWorkflow(id, { status })
}

export async function deleteWorkflow(id: string): Promise<void> {
  const { userId, workspaceId } = await requireWorkspaceMember()
  await withAuthenticatedDb({ userId, workspaceId }, (tx) =>
    tx.query('delete from public.workflows where id = $1', [id]),
  )
}

export async function listWorkflowRuns(
  workflowId?: string | null,
  limit = 50,
): Promise<(WorkflowRun & { contactEmail: string | null })[]> {
  const { userId, workspaceId } = await requireWorkspaceMember()
  return withAuthenticatedDb({ userId, workspaceId }, async (tx) => {
    const params: unknown[] = [workspaceId]
    let filter = ''
    if (workflowId) {
      params.push(workflowId)
      filter = ` and r.workflow_id = $${params.length}`
    }
    params.push(Math.min(limit, 200))

    const rows = await many<Record<string, any>>(
      tx,
      `
      select r.*, c.email as contact_email
      from public.workflow_runs r
      join public.contacts c on c.id = r.contact_id
      where r.workspace_id = $1 ${filter}
      order by r.started_at desc
      limit $${params.length}
      `,
      params,
    )
    return rows.map((row) => ({
      ...mapWorkflowRun(row),
      contactEmail: row.contact_email ?? null,
    }))
  })
}

export type WorkflowNodeRun = {
  id: string
  nodeId: string
  nodeType: string
  status: string
  result: JsonObject
  error: string | null
  startedAt: string
  completedAt: string | null
}

export async function workflowNodeRuns(runId: string): Promise<WorkflowNodeRun[]> {
  const { userId, workspaceId } = await requireWorkspaceMember()
  return withAuthenticatedDb({ userId, workspaceId }, async (tx) =>
    many<WorkflowNodeRun>(
      tx,
      `
      select id, node_id as "nodeId", node_type as "nodeType", status, result,
             error, started_at as "startedAt", completed_at as "completedAt"
      from public.workflow_node_runs
      where run_id = $1
      order by started_at asc
      `,
      [runId],
    ),
  )
}

export type WorkflowStats = {
  active: number
  enrolled: number
  completed: number
  paused: number
  failed: number
}

export async function workflowStats(): Promise<WorkflowStats> {
  const { userId, workspaceId } = await requireWorkspaceMember()
  return withAuthenticatedDb({ userId, workspaceId }, async (tx) => {
    const row = await one<WorkflowStats>(tx, `
      select
        (select count(*)::int from public.workflows where workspace_id = $1 and status = 'active') as active,
        (select count(*)::int from public.workflow_enrollments where workspace_id = $1 and completed_at is null) as enrolled,
        (select count(*)::int from public.workflow_runs where workspace_id = $1 and status = 'completed') as completed,
        (select count(*)::int from public.workflows where workspace_id = $1 and status = 'paused') as paused,
        (select count(*)::int from public.workflow_runs where workspace_id = $1 and status = 'failed') as failed
    `, [workspaceId])
    return row ?? { active: 0, enrolled: 0, completed: 0, paused: 0, failed: 0 }
  })
}

/**
 * Structural validation. The DAG is persisted verbatim, so an inconsistent graph
 * would otherwise only fail at runtime, halfway through a real send.
 */
export function validateDefinition(definition: WorkflowDefinition): void {
  if (!definition || !Array.isArray(definition.nodes)) {
    throw new ValidationError('Workflow definition must contain a nodes array')
  }
  if (!Array.isArray(definition.edges)) {
    throw new ValidationError('Workflow definition must contain an edges array')
  }

  const ids = new Set<string>()
  for (const node of definition.nodes) {
    if (!node.id) throw new ValidationError('Every node needs an id')
    if (ids.has(node.id)) throw new ValidationError(`Duplicate node id "${node.id}"`)
    ids.add(node.id)
    if (!WORKFLOW_NODE_TYPES.includes(node.type)) {
      throw new ValidationError(`Unknown node type "${node.type}"`)
    }
  }

  const triggers = definition.nodes.filter((node) => node.type === 'trigger')
  if (triggers.length !== 1) {
    throw new ValidationError('A workflow must have exactly one trigger node')
  }

  for (const edge of definition.edges) {
    if (!ids.has(edge.source)) {
      throw new ValidationError(`Edge references unknown node "${edge.source}"`)
    }
    if (!ids.has(edge.target)) {
      throw new ValidationError(`Edge references unknown node "${edge.target}"`)
    }
    if (edge.source === edge.target) {
      throw new ValidationError('A node cannot connect to itself')
    }
  }

  // Reachability from the trigger.
  const reachable = new Set<string>()
  const queue = [triggers[0]!.id]
  while (queue.length > 0) {
    const current = queue.shift()!
    if (reachable.has(current)) continue
    reachable.add(current)
    for (const edge of definition.edges.filter((e) => e.source === current)) {
      queue.push(edge.target)
    }
  }

  const orphans = [...ids].filter((id) => !reachable.has(id))
  if (orphans.length > 0) {
    throw new ValidationError(
      `These nodes are not connected to the trigger: ${orphans.join(', ')}`,
    )
  }

  // Cycle detection.
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const walk = (id: string): void => {
    if (visiting.has(id)) throw new ValidationError('The workflow contains a cycle')
    if (visited.has(id)) return
    visiting.add(id)
    for (const edge of definition.edges.filter((e) => e.source === id)) walk(edge.target)
    visiting.delete(id)
    visited.add(id)
  }
  walk(triggers[0]!.id)
}

export async function countRunsInTx(
  tx: Tx,
  workspaceId: string,
  workflowId: string,
): Promise<number> {
  const row = await one<{ count: number }>(
    tx,
    'select count(*)::int as count from public.workflow_runs where workspace_id = $1 and workflow_id = $2',
    [workspaceId, workflowId],
  )
  return row?.count ?? 0
}

export async function touchWorkflowRunCounts(workspaceId: string): Promise<void> {
  await withAdminDb(async (tx) => {
    await tx.query(
      `
      update public.workflows w
      set runs_count = sub.count,
          last_run_at = sub.last_run
      from (
        select workflow_id, count(*)::int as count, max(started_at) as last_run
        from public.workflow_runs
        where workspace_id = $1
        group by workflow_id
      ) sub
      where w.id = sub.workflow_id and w.workspace_id = $1
      `,
      [workspaceId],
    )
  })
}