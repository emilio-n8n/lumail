import { many, one, withAdminDb } from '@/integrations/database/client'
import { enqueueJob } from '@/lib/jobs/queue'
import { deliverToContact } from '@/lib/email/send'
import { resolveSender } from '@/lib/domain/workspace'
import { recordEvent } from '@/lib/domain/activity'
import { queueEventWebhooks } from '@/lib/webhooks/dispatch'
import type {
  ContactRow,
  WorkflowDefinition,
  WorkflowNode,
} from '@/lib/domain/types'

/**
 * Workflow execution engine.
 *
 * A run walks the DAG one node at a time. `wait` and `goal` nodes suspend the
 * run by setting `next_run_at` on the enrollment and scheduling a job — nothing
 * is held in memory, so a restart mid-automation is safe and every step is
 * auditable in `workflow_node_runs`.
 */

const MAX_STEPS_PER_TICK = 50

export type TriggerEvent = {
  type: string
  workspaceId: string
  contactId: string
  /** Trigger-specific payload (tag name, segment id, link url, event name…). */
  data?: Record<string, unknown>
}

type RunContext = {
  runId: string
  workflowId: string
  workspaceId: string
  contact: ContactRow
  definition: WorkflowDefinition
  context: Record<string, unknown>
}

/* ------------------------------------------------------------- triggers */

/**
 * Entry point for every trigger. Finds matching active workflows and starts a
 * run for each — deliberately idempotent per (workflow, contact) so a burst of
 * events cannot enroll the same contact twice in the same automation.
 */
export async function handleTrigger(event: TriggerEvent): Promise<number> {
  const workflows = await withAdminDb(async (tx) =>
    many<Record<string, any>>(
      tx,
      `select * from public.workflows
       where workspace_id = $1 and status = 'active'`,
      [event.workspaceId],
    ),
  )

  let started = 0
  for (const workflow of workflows) {
    const triggerType = String(workflow.trigger?.type ?? 'contact_created')
    if (triggerType !== event.type) continue

    if (!matchesTriggerFilters(workflow.trigger, event)) continue

    const didStart = await startRun(workflow.id as string, event)
    if (didStart) started += 1
  }
  return started
}

function matchesTriggerFilters(
  trigger: Record<string, any>,
  event: TriggerEvent,
): boolean {
  if (!trigger) return true

  if (trigger.tag) {
    const tags = trigger.tagNames
    if (Array.isArray(trigger.tagNames) && trigger.tagNames.length > 0) {
      if (!trigger.tagNames.includes(trigger.tag)) return false
    }
  }

  if (trigger.eventName && event.data?.eventName && trigger.eventName !== event.data.eventName) {
    return false
  }

  if (trigger.url && event.data?.url && trigger.url !== event.data.url) {
    return false
  }

  return true
}

export async function startRun(
  workflowId: string,
  event: TriggerEvent,
): Promise<boolean> {
  const created = await withAdminDb(async (tx) => {
    const workflow = await one<Record<string, any>>(
      tx,
      'select * from public.workflows where id = $1 and status = $2',
      [workflowId, 'active'],
    )
    if (!workflow) return null

    const contact = await one<ContactRow>(
      tx,
      'select * from public.contacts where id = $1 and workspace_id = $2',
      [event.contactId, event.workspaceId],
    )
    if (!contact) return null

    // One open enrollment per (workflow, contact).
    const existing = await one<{ id: string }>(
      tx,
      `select id from public.workflow_enrollments
       where workflow_id = $1 and contact_id = $2 and completed_at is null`,
      [workflowId, event.contactId],
    )
    if (existing) return null

    const definition = (workflow.definition ?? {
      nodes: [],
      edges: [],
    }) as WorkflowDefinition

    const triggerNode =
      definition.nodes.find((node) => node.type === 'trigger') ?? definition.nodes[0]
    if (!triggerNode) return null

    const enrollment = await one<{ id: string }>(
      tx,
      `
      insert into public.workflow_enrollments (
        workspace_id, workflow_id, contact_id, status, current_node_id, context
      )
      values ($1,$2,$3,'waiting',$4,$5)
      returning id
      `,
      [
        event.workspaceId,
        workflowId,
        event.contactId,
        triggerNode.id,
        JSON.stringify({ trigger: event.type, ...(event.data ?? {}) }),
      ],
    )

    const run = await one<{ id: string }>(
      tx,
      `
      insert into public.workflow_runs (
        workspace_id, workflow_id, contact_id, enrollment_id, status, current_node_id, context
      )
      values ($1,$2,$3,$4,'running',$5,$6)
      returning id
      `,
      [
        event.workspaceId,
        workflowId,
        event.contactId,
        enrollment!.id,
        triggerNode.id,
        JSON.stringify(event.data ?? {}),
      ],
    )

    await recordEvent(tx, {
      workspaceId: event.workspaceId,
      contactId: event.contactId,
      eventType: 'workflow_enrolled',
      workflowId,
      metadata: { trigger: event.type, runId: run!.id },
    })

    const firstEdge = definition.edges.find((edge) => edge.source === triggerNode.id)
    return {
      enrollmentId: enrollment!.id,
      runId: run!.id,
      nextNodeId: firstEdge?.target ?? null,
      definition,
      contactId: event.contactId,
      workspaceId: event.workspaceId,
    }
  })

  if (!created) return false

  if (created.nextNodeId) {
    await advanceRun(created.runId, created.nextNodeId)
  } else {
    await completeRun(created.runId)
  }

  return true
}

/* ------------------------------------------------------------ execution */

async function loadRun(
  runId: string,
): Promise<{ run: Record<string, any>; definition: WorkflowDefinition } | null> {
  return withAdminDb(async (tx) => {
    const run = await one<Record<string, any>>(
      tx,
      'select * from public.workflow_runs where id = $1',
      [runId],
    )
    if (!run) return null

    const workflow = await one<Record<string, any>>(
      tx,
      'select * from public.workflows where id = $1',
      [run.workflow_id],
    )
    if (!workflow) return null

    return {
      run,
      definition: (workflow.definition ?? { nodes: [], edges: [] }) as WorkflowDefinition,
    }
  })
}

/**
 * Executes nodes until the run suspends (wait/goal) or terminates. Each call is
 * bounded so a pathological graph cannot spin forever.
 */
export async function advanceRun(
  runId: string,
  startNodeId: string,
): Promise<void> {
  let nodeId: string | null = startNodeId
  let steps = 0

  while (nodeId && steps < MAX_STEPS_PER_TICK) {
    steps += 1

    const loaded = await loadRun(runId)
    if (!loaded) return

    const node = loaded.definition.nodes.find((n) => n.id === nodeId)
    if (!node) {
      await completeRun(runId)
      return
    }

    const contact = await withAdminDb(async (tx) =>
      one<ContactRow>(tx, 'select * from public.contacts where id = $1', [
        loaded.run.contact_id,
      ]),
    )
    if (!contact) {
      await completeRun(runId, 'Contact no longer exists')
      return
    }

    const nodeRunId = await beginNodeRun(loaded.run, node)

    let outcome: StepOutcome
    try {
      outcome = await executeNode(
        {
          runId,
          workflowId: loaded.run.workflow_id,
          workspaceId: loaded.run.workspace_id,
          contact,
          definition: loaded.definition,
          context: (loaded.run.context ?? {}) as Record<string, unknown>,
        },
        node,
      )
    } catch (error) {
      await endNodeRun(nodeRunId, 'failed', { error: (error as Error).message })
      await failRun(runId, (error as Error).message)
      return
    }

    if (outcome.status === 'suspended') {
      await endNodeRun(nodeRunId, 'completed', outcome.result)
      return
    }

    if (outcome.status === 'failed') {
      await endNodeRun(nodeRunId, 'failed', { error: outcome.error })
      await failRun(runId, outcome.error ?? 'Unknown error')
      return
    }

    await endNodeRun(nodeRunId, 'completed', outcome.result)

    if (!outcome.next) {
      await completeRun(runId)
      return
    }

    nodeId = outcome.next
  }
}

type StepOutcome =
  | { status: 'continue'; next: string | null; result: Record<string, unknown> }
  | { status: 'suspended'; result: Record<string, unknown> }
  | { status: 'failed'; error: string }

async function beginNodeRun(
  run: Record<string, any>,
  node: WorkflowNode,
): Promise<string> {
  return withAdminDb(async (tx) => {
    const row = await tx.query<{ id: string }>(
      `
      insert into public.workflow_node_runs (workspace_id, workflow_id, run_id, node_id, node_type)
      values ($1,$2,$3,$4,$5)
      returning id
      `,
      [run.workspace_id, run.workflow_id, run.id, node.id, node.type],
    )
    await tx.query(
      `update public.workflow_runs set current_node_id = $2 where id = $1`,
      [run.id, node.id],
    )
    return row.rows[0]!.id
  })
}

async function endNodeRun(
  id: string,
  status: 'completed' | 'failed',
  result: Record<string, unknown>,
): Promise<void> {
  await withAdminDb((tx) =>
    tx.query(
      `update public.workflow_node_runs
       set status = $2::public.run_status, result = $3, completed_at = now()
       where id = $1`,
      [id, status, JSON.stringify(result ?? {})],
    ),
  )
}

function nextNode(
  definition: WorkflowDefinition,
  nodeId: string,
  branch?: string,
): string | null {
  const edges = definition.edges.filter((edge) => edge.source === nodeId)
  if (edges.length === 0) return null
  const chosen = branch ? edges.find((edge) => edge.branch === branch) : edges[0]
  return (chosen ?? edges[0]).target
}

async function executeNode(
  ctx: RunContext,
  node: WorkflowNode,
): Promise<StepOutcome> {
  const config = node.config ?? {}

  switch (node.type) {
    case 'trigger':
      return { status: 'continue', next: await nextNode(ctx.definition, node.id), result: {} }

    case 'wait': {
      const amount = Number(config.amount ?? 1)
      const unit = String(config.unit ?? 'hours')
      const milliseconds = toMilliseconds(amount, unit)
      const runAt = new Date(Date.now() + milliseconds)

      await withAdminDb(async (tx) => {
        await tx.query(
          `update public.workflow_enrollments
           set status = 'waiting', next_run_at = $2
           where workflow_id = $1 and contact_id = $3 and completed_at is null`,
          [ctx.workflowId, runAt.toISOString(), ctx.contact.id],
        )
        await tx.query(
          `update public.workflow_runs set status = 'waiting' where id = $1`,
          [ctx.runId],
        )
      })

      // The job resumes the *next* node, not this one. Re-entering the wait
      // node would simply re-arm the timer and the run would never progress.
      // A wait with no successor is the end of the graph: the job is enqueued
      // with a null node, which ends the run when it fires.
      const resumeAt = nextNode(ctx.definition, node.id)

      await enqueueJob({
        workspaceId: ctx.workspaceId,
        kind: 'workflow_step',
        runAt,
        payload: { runId: ctx.runId, nodeId: resumeAt },
      })

      return {
        status: 'suspended',
        result: {
          waitUntil: runAt.toISOString(),
          resumesAt: resumeAt,
        },
      }
    }

    case 'goal': {
      const timeoutHours = Number(config.timeoutHours ?? 24)
      const eventName = String(config.event ?? 'opened')
      const runAt = new Date(Date.now() + timeoutHours * 3_600_000)

      await withAdminDb(async (tx) => {
        await tx.query(
          `update public.workflow_enrollments set status = 'waiting', next_run_at = $2
           where workflow_id = $1 and contact_id = $3 and completed_at is null`,
          [ctx.workflowId, runAt.toISOString(), ctx.contact.id],
        )
        await tx.query(`update public.workflow_runs set status = 'waiting' where id = $1`, [
          ctx.runId,
        ])
      })

      await enqueueJob({
        workspaceId: ctx.workspaceId,
        kind: 'workflow_step',
        runAt,
        payload: { runId: ctx.runId, nodeId: node.id, goalEvent: eventName },
      })

      return {
        status: 'suspended',
        result: { goal: eventName, timeoutAt: runAt.toISOString() },
      }
    }

    case 'condition': {
      const matched = evaluateCondition(ctx, config)
      const branch = matched ? 'true' : 'false'
      return {
        status: 'continue',
        next: await nextNode(ctx.definition, node.id, branch),
        result: { matched, field: config.field },
      }
    }

    case 'split': {
      const variant = String(config.variant ?? 'a')
      return {
        status: 'continue',
        next: await nextNode(ctx.definition, node.id, variant),
        result: { variant },
      }
    }

    case 'send_email': {
      const sender = await resolveSender(ctx.workspaceId, {
        fromEmail: config.fromEmail ?? null,
        fromName: config.fromName ?? null,
      })

      const template = config.templateId
        ? await withAdminDb(async (tx) =>
            one<Record<string, any>>(
              tx,
              'select * from public.templates where id = $1 and workspace_id = $2',
              [config.templateId, ctx.workspaceId],
            ),
          )
        : null

      const subject = config.subject ?? template?.subject ?? 'A message for you'
      const html = config.html ?? template?.html ?? ''
      const document = config.document ?? template?.document ?? { blocks: [] }

      const result = await deliverToContact({
        workspaceId: ctx.workspaceId,
        contact: ctx.contact,
        subject,
        html: config.html || !document?.blocks?.length ? html : undefined,
        document: config.html ? undefined : document,
        fromEmail: sender.fromEmail,
        fromName: sender.fromName,
        replyTo: sender.replyTo,
        workflowId: ctx.workflowId,
        workflowRunId: ctx.runId,
        templateId: config.templateId ?? null,
        kind: 'workflow',
        variables: (config.variables as Record<string, string>) ?? {},
      })

      return {
        status: 'continue',
        next: await nextNode(ctx.definition, node.id),
        result: { messageId: result.messageId, status: result.status },
      }
    }

    case 'add_tag':
    case 'remove_tag': {
      const names: string[] = Array.isArray(config.tagNames)
        ? config.tagNames
        : config.tagName
          ? [config.tagName]
          : []

      for (const name of names) {
        const trimmed = String(name).trim()
        if (!trimmed) continue

        if (node.type === 'add_tag') {
          const tag = await withAdminDb(async (tx) => {
            const row = await one<{ id: string }>(
              tx,
              `insert into public.tags (workspace_id, name) values ($1,$2)
               on conflict (workspace_id, name) do update set name = excluded.name
               returning id`,
              [ctx.workspaceId, trimmed],
            )
            await tx.query(
              `insert into public.contact_tags (workspace_id, contact_id, tag_id)
               values ($1,$2,$3) on conflict (contact_id, tag_id) do nothing`,
              [ctx.workspaceId, ctx.contact.id, row!.id],
            )
            return row!
          })

          await logActivity(ctx.workspaceId, ctx.contact.id, 'tag_added', {
            workspaceId: ctx.workspaceId,
            tag: trimmed,
            tagId: tag.id,
          })
        } else {
          await withAdminDb(async (tx) => {
            await tx.query(
              `delete from public.contact_tags
               where contact_id = $1 and tag_id = (select id from public.tags where workspace_id = $2 and name = $3)`,
              [ctx.contact.id, ctx.workspaceId, trimmed],
            )
          })
          await logActivity(ctx.workspaceId, ctx.contact.id, 'tag_removed', {
            workspaceId: ctx.workspaceId,
            tag: trimmed,
          })
        }
      }

      return {
        status: 'continue',
        next: await nextNode(ctx.definition, node.id),
        result: { tags: names },
      }
    }

    case 'update_contact': {
      const fields = (config.fields ?? {}) as Record<string, string>
      const assignments: string[] = []
      const params: unknown[] = [ctx.contact.id]

      const columnMap: Record<string, string> = {
        firstName: 'first_name',
        lastName: 'last_name',
        phone: 'phone',
        company: 'company',
        status: 'status',
      }

      for (const [key, value] of Object.entries(fields)) {
        if (key === 'customFields') {
          params.push(JSON.stringify(value))
          assignments.push(`custom_fields = custom_fields || $${params.length}::jsonb`)
          continue
        }
        const column = columnMap[key]
        if (!column) continue
        params.push(value)
        assignments.push(`${column} = $${params.length}`)
      }

      if (assignments.length > 0) {
        await withAdminDb((tx) =>
          tx.query(
            `update public.contacts set ${assignments.join(', ')}, updated_at = now() where id = $1`,
            params,
          ),
        )
        await logActivity(ctx.workspaceId, ctx.contact.id, 'updated', {
          workspaceId: ctx.workspaceId,
          fields: Object.keys(fields),
        })
      }

      return {
        status: 'continue',
        next: await nextNode(ctx.definition, node.id),
        result: { updated: Object.keys(fields) },
      }
    }

    case 'add_to_segment':
    case 'remove_from_segment': {
      const segmentId = String(config.segmentId ?? '')
      if (segmentId) {
        await withAdminDb(async (tx) => {
          const segment = await one<{ name: string }>(
            tx,
            'select name from public.segments where id = $1 and workspace_id = $2',
            [segmentId, ctx.workspaceId],
          )
          if (node.type === 'add_to_segment') {
            await tx.query(
              `insert into public.segment_memberships (workspace_id, segment_id, contact_id, added_by)
               values ($1,$2,$3,'workflow') on conflict (segment_id, contact_id) do nothing`,
              [ctx.workspaceId, segmentId, ctx.contact.id],
            )
          } else {
            await tx.query(
              `delete from public.segment_memberships
               where segment_id = $1 and contact_id = $2`,
              [segmentId, ctx.contact.id],
            )
          }

          await recordEvent(tx, {
            workspaceId: ctx.workspaceId,
            contactId: ctx.contact.id,
            eventType: node.type === 'add_to_segment' ? 'segment_added' : 'segment_removed',
            metadata: { segmentId, segmentName: segment?.name ?? segmentId },
          })
        })

        await queueEventWebhooks(ctx.workspaceId, 'segment.contact_added', {
          contactId: ctx.contact.id,
          segmentId,
        })
      }

      return {
        status: 'continue',
        next: await nextNode(ctx.definition, node.id),
        result: { segmentId },
      }
    }

    case 'webhook': {
      const url = String(config.url ?? '')
      if (url) {
        const response = await fetch(url, {
          method: String(config.method ?? 'POST').toUpperCase(),
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            event: 'workflow.node.webhook',
            workflowId: ctx.workflowId,
            runId: ctx.runId,
            contact: {
              id: ctx.contact.id,
              email: ctx.contact.email,
              firstName: ctx.contact.first_name,
              lastName: ctx.contact.last_name,
            },
            data: config.body ?? {},
          }),
          signal: AbortSignal.timeout(10_000),
        }).catch((error) => ({ ok: false, status: 0, text: async () => String(error) }))

        return {
          status: 'continue',
          next: await nextNode(ctx.definition, node.id),
          result: { status: response.status, ok: response.ok },
        }
      }

      return { status: 'continue', next: await nextNode(ctx.definition, node.id), result: {} }
    }

    default:
      return {
        status: 'failed',
        error: `Unsupported node type "${node.type}"`,
      }
  }
}

function evaluateCondition(
  ctx: RunContext,
  config: Record<string, any>,
): boolean {
  const field = String(config.field ?? 'tag')
  const operator = String(config.operator ?? 'equals')
  const expected = String(config.value ?? '')

  const tags: string[] = (ctx.context.tags as string[]) ?? []

  const actual = (() => {
    switch (field) {
      case 'tag':
        return tags
      case 'email':
        return ctx.contact.email
      case 'first_name':
        return ctx.contact.first_name ?? ''
      case 'last_name':
        return ctx.contact.last_name ?? ''
      case 'company':
        return ctx.contact.company ?? ''
      case 'status':
        return ctx.contact.status
      case 'opened':
        return ctx.contact.attributes?.opened ?? 0
      case 'clicked':
        return ctx.contact.attributes?.clicked ?? 0
      case 'purchased':
        return ctx.contact.custom_fields?.purchased ?? false
      default:
        return (ctx.contact.custom_fields?.[field] as string) ?? ''
    }
  })()

  const asArray = Array.isArray(actual) ? actual : [actual]

  switch (operator) {
    case 'contains':
      return asArray.some((item) =>
        String(item).toLowerCase().includes(expected.toLowerCase()),
      )
    case 'not_contains':
      return !asArray.some((item) =>
        String(item).toLowerCase().includes(expected.toLowerCase()),
      )
    case 'equals':
      return asArray.some(
        (item) => String(item).toLowerCase() === expected.toLowerCase(),
      )
    case 'not_equals':
      return !asArray.some(
        (item) => String(item).toLowerCase() === expected.toLowerCase(),
      )
    case 'greater_than':
      return Number(actual) > Number(expected)
    case 'less_than':
      return Number(actual) < Number(expected)
    default:
      return false
  }
}

async function completeRun(runId: string, reason?: string): Promise<void> {
  const result = await withAdminDb(async (tx) => {
    const run = await one<Record<string, any>>(
      tx,
      'select * from public.workflow_runs where id = $1',
      [runId],
    )
    if (!run) return null

    await tx.query(
      `update public.workflow_runs
       set status = 'completed', completed_at = now()
       where id = $1`,
      [runId],
    )
    await tx.query(
      `update public.workflow_enrollments
       set status = 'completed', completed_at = now(), next_run_at = null
       where id = $1`,
      [run.enrollment_id],
    )

    await recordEvent(tx, {
      workspaceId: run.workspace_id,
      contactId: run.contact_id,
      eventType: 'workflow_completed',
      workflowId: run.workflow_id,
      metadata: reason ? { reason } : {},
    })

    return { workspaceId: run.workspace_id as string, contactId: run.contact_id as string }
  })

  if (result) {
    await queueEventWebhooks(result.workspaceId, 'workflow.run.completed', { runId })
  }
}

async function failRun(runId: string, error: string): Promise<void> {
  await withAdminDb(async (tx) => {
    const run = await one<{ enrollment_id: string }>(
      tx,
      'select enrollment_id from public.workflow_runs where id = $1',
      [runId],
    )
    await tx.query(
      `update public.workflow_runs
       set status = 'failed', error = $2, completed_at = now()
       where id = $1`,
      [runId, error.slice(0, 2000)],
    )
    if (run?.enrollment_id) {
      await tx.query(
        `update public.workflow_enrollments
         set status = 'failed', completed_at = now(), next_run_at = null
         where id = $1`,
        [run.enrollment_id],
      )
    }
  })
}

/** Job handler for suspended runs. */
export async function processWorkflowStep(input: {
  runId: string
  /** The node to continue at. Null means the graph ended at the previous step. */
  nodeId: string | null
  goalEvent?: string
}): Promise<void> {
  const loaded = await loadRun(input.runId)
  if (!loaded) return
  if (loaded.run.status === 'completed' || loaded.run.status === 'failed') return

  const workflow = await withAdminDb(async (tx) =>
    one<{ status: string }>(tx, 'select status from public.workflows where id = $1', [
      loaded.run.workflow_id,
    ]),
  )
  if (workflow?.status !== 'active') return

  // The previous node had no successor, so waiting out its delay ends the run.
  if (!input.nodeId) {
    await completeRun(input.runId)
    return
  }

  if (input.goalEvent) {
    const reached = goalReached(loaded, String(input.goalEvent))
    const branch = reached ? 'reached' : 'timeout'
    const next = nextNode(loaded.definition, input.nodeId, branch)
    if (next) {
      await advanceRun(input.runId, next)
      return
    }
  }

  await advanceRun(input.runId, input.nodeId)
}

function goalReached(
  loaded: { run: Record<string, any>; definition: WorkflowDefinition },
  eventName: string,
): boolean {
  const context = (loaded.run.context ?? {}) as Record<string, unknown>
  return Boolean(context[`goal_${eventName}`])
}

function toMilliseconds(amount: number, unit: string): number {
  const value = Number.isFinite(amount) ? amount : 1
  switch (unit) {
    case 'minutes':
      return value * 60_000
    case 'hours':
      return value * 3_600_000
    case 'days':
      return value * 86_400_000
    case 'weeks':
      return value * 604_800_000
    default:
      return value * 3_600_000
  }
}

/** Activity rows for automation side effects. */
async function logActivity(
  workspaceId: string,
  contactId: string,
  eventType: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const { recordEvent } = await import('@/lib/domain/activity')
  await withAdminDb((tx) =>
    recordEvent(tx, {
      workspaceId,
      contactId,
      eventType: eventType as never,
      metadata,
    }),
  )
}
