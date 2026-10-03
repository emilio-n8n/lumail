import { many, one, withAuthenticatedDb, withAdminDb } from '@/integrations/database/client'
import { requireWorkspaceMember } from '@/integrations/database/auth-runtime'
import { NotFoundError } from '@/lib/auth/session'
import type { AppRole } from '@/lib/auth/session'
import type { InviteRow, JsonObject } from './types'

export type WorkspaceSummary = {
  id: string
  name: string
  slug: string
  timezone: string
  role: AppRole
  isCurrent: boolean
  memberCount: number
}

export async function listUserWorkspaces(): Promise<WorkspaceSummary[]> {
  const session = await (async () => {
    const { resolveSession } = await import('@/lib/auth/session')
    return resolveSession()
  })()
  if (!session) return []

  return withAdminDb(async (tx) => {
    const rows = await many<Record<string, any>>(
      tx,
      `
      select w.*, m.role,
        (select count(*)::int from public.memberships mm where mm.workspace_id = w.id) as member_count
      from public.workspaces w
      join public.memberships m on m.workspace_id = w.id
      where m.user_id = $1
      order by m.created_at asc
      `,
      [session.user.id],
    )

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      timezone: row.timezone,
      role: row.role as AppRole,
      isCurrent: row.id === session.workspaceId,
      memberCount: Number(row.member_count),
    }))
  })
}

export async function createWorkspace(input: { name: string; slug?: string }) {
  const session = await (async () => {
    const { resolveSession } = await import('@/lib/auth/session')
    return resolveSession()
  })()
  if (!session) throw new NotFoundError('Not authenticated')

  return withAdminDb(async (tx) => {
    const base =
      input.slug?.trim() ||
      input.name
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 32) ||
      'workspace'

    let slug = base
    let counter = 1
    for (;;) {
      const clash = await one<{ id: string }>(
        tx,
        'select id from public.workspaces where slug = $1',
        [slug],
      )
      if (!clash) break
      counter += 1
      slug = `${base}-${counter}`
    }

    const workspace = await one<{ id: string; name: string; slug: string; timezone: string }>(
      tx,
      `insert into public.workspaces (name, slug) values ($1,$2) returning id, name, slug, timezone`,
      [input.name.trim(), slug],
    )

    await tx.query(
      `insert into public.memberships (workspace_id, user_id, role) values ($1,$2,'owner')`,
      [workspace!.id, session.user.id],
    )

    return workspace!
  })
}

export type WorkspacePatch = {
  name?: string
  timezone?: string
  fromName?: string | null
  settings?: JsonObject
}

export type WorkspaceRow = {
  id: string
  name: string
  slug: string
  timezone: string
  fromName: string | null
  settings: JsonObject
}

export async function updateWorkspace(patch: WorkspacePatch): Promise<WorkspaceRow> {
  const { userId, workspaceId } = await requireWorkspaceMember(['owner', 'admin'])

  const updated = await withAuthenticatedDb(
    { userId, workspaceId },
    async (tx) =>
      one<WorkspaceRow>(
        tx,
        `
        update public.workspaces set
          name = coalesce($2, name),
          timezone = coalesce($3, timezone),
          from_name = coalesce($4, from_name),
          settings = coalesce($5, settings),
          updated_at = now()
        where id = $1
        returning id, name, slug, timezone, from_name as "fromName", settings
        `,
        [
          workspaceId,
          patch.name ?? null,
          patch.timezone ?? null,
          patch.fromName ?? null,
          patch.settings ? JSON.stringify(patch.settings) : null,
        ],
      ),
  )

  if (!updated) throw new Error('Workspace not found')
  return updated
}

export type SenderIdentity = {
  fromEmail: string
  fromName: string
  replyTo: string
}

/**
 * Resolves the From/Reply-To identity for outbound mail: the workspace default
 * domain if verified, otherwise the configured fallback.
 */
export async function resolveSender(
  workspaceId: string,
  explicit?: { fromEmail?: string | null; fromName?: string | null; replyTo?: string | null },
): Promise<SenderIdentity> {
  return withAdminDb(async (tx) => {
    const fallbackDomain =
      process.env.SENDING_DOMAIN ?? 'lumail.email'

    const workspace = await one<{ from_name: string | null; settings: any }>(
      tx,
      'select from_name, settings from public.workspaces where id = $1',
      [workspaceId],
    )

    const domain = await one<{ name: string }>(
      tx,
      `select name from public.domains
       where workspace_id = $1 and (is_default = true or status = 'verified')
       order by is_default desc, created_at asc limit 1`,
      [workspaceId],
    )

    const fromName =
      explicit?.fromName ??
      workspace?.from_name ??
      (workspace?.settings?.fromName as string | undefined) ??
      'Lumail'

    return {
      fromEmail:
        explicit?.fromEmail ??
        `hello@${domain?.name ?? (workspace?.settings?.sendingDomain as string | undefined) ?? fallbackDomain}`,
      fromName,
      replyTo: explicit?.replyTo ?? `hello@${domain?.name ?? fallbackDomain}`,
    }
  })
}

export type WorkspaceStats = {
  members: number
  api_keys: number
  webhooks: number
  domains: number
  workflows: number
}

export type WorkspaceContextResult = {
  user: { id: string; email: string; fullName: string | null; avatarColor: string } | null
  workspaceId: string
  role: AppRole
  workspaces: WorkspaceSummary[]
  stats: WorkspaceStats
}

export async function getWorkspaceContext(): Promise<WorkspaceContextResult> {
  const { userId, workspaceId, role } = await requireWorkspaceMember()

  const session = await (async () => {
    const { resolveSession } = await import('@/lib/auth/session')
    return resolveSession()
  })()

  const workspaces = await listUserWorkspaces()

  const statsRow = await withAuthenticatedDb({ userId, workspaceId }, async (tx) =>
    one<WorkspaceStats>(tx, `
      select
        (select count(*)::int from public.memberships ms where ms.user_id = $1 and ms.workspace_id = $2) as members,
        (select count(*)::int from public.api_keys k where k.workspace_id = $2 and k.revoked_at is null) as api_keys,
        (select count(*)::int from public.webhooks w where w.workspace_id = $2) as webhooks,
        (select count(*)::int from public.domains d where d.workspace_id = $2) as domains,
        (select count(*)::int from public.workflows wf where wf.workspace_id = $2) as workflows
    `, [userId, workspaceId]),
  )
  const stats: WorkspaceStats = statsRow ?? {
    members: 0,
    api_keys: 0,
    webhooks: 0,
    domains: 0,
    workflows: 0,
  }

  return {
    user: session?.user ?? null,
    workspaceId,
    role,
    workspaces,
    stats,
  }
}

export type WorkspaceMember = {
  id: string
  role: AppRole
  createdAt: string
  userId: string
  email: string
  fullName: string | null
  lastSeenAt: string | null
}

export async function listMembers(): Promise<WorkspaceMember[]> {
  const { workspaceId } = await requireWorkspaceMember()
  return withAdminDb(async (tx) =>
    many<WorkspaceMember>(
      tx,
      `
      select m.id, m.role, m.created_at as "createdAt",
             u.id as "userId", u.email, u.full_name as "fullName", u.last_seen_at as "lastSeenAt"
      from public.memberships m
      join public.users u on u.id = m.user_id
      where m.workspace_id = $1
      order by m.created_at asc
      `,
      [workspaceId],
    ),
  )
}

export async function updateMemberRole(
  memberId: string,
  role: AppRole,
): Promise<void> {
  const { workspaceId } = await requireWorkspaceMember(['owner'])
  await withAdminDb(async (tx) => {
    const target = await one<{ user_id: string }>(
      tx,
      'select user_id from public.memberships where id = $1 and workspace_id = $2',
      [memberId, workspaceId],
    )
    if (!target) throw new NotFoundError('Member not found')

    await tx.query('update public.memberships set role = $2 where id = $1', [
      memberId,
      role,
    ])
  })
}

export async function removeMember(memberId: string): Promise<void> {
  const { workspaceId } = await requireWorkspaceMember(['owner'])
  await withAdminDb(async (tx) => {
    const owners = await one<{ count: number }>(
      tx,
      `select count(*)::int as count from public.memberships where workspace_id = $1 and role = 'owner'`,
      [workspaceId],
    )
    if ((owners?.count ?? 0) <= 1) {
      throw new Error('A workspace must keep at least one owner')
    }
    await tx.query(
      'delete from public.memberships where id = $1 and workspace_id = $2',
      [memberId, workspaceId],
    )
  })
}

export async function createInvite(input: { email: string; role: AppRole }): Promise<InviteWithToken> {
  const { userId, workspaceId } = await requireWorkspaceMember(['owner', 'admin'])
  const { generateToken, sha256 } = await import('@/lib/auth/crypto')

  return withAdminDb(async (tx) => {
    const token = generateToken()
    const row = await one<Record<string, any>>(
      tx,
      `
      insert into public.invites (workspace_id, email, role, token_hash, invited_by, expires_at)
      values ($1,$2,$3,$4,$5, now() + interval '7 days')
      returning id, email, role, status, created_at as "createdAt", expires_at as "expiresAt"
      `,
      [workspaceId, input.email.toLowerCase(), input.role, sha256(token), userId],
    )
    return { invite: row as unknown as InviteRow, token }
  })
}

export type InviteWithToken = { invite: InviteRow; token: string }

export async function listInvites(): Promise<InviteRow[]> {
  const { workspaceId } = await requireWorkspaceMember()
  const rows = await withAdminDb(async (tx) =>
    many<Record<string, any>>(
      tx,
      `
      select id, email, role, status, created_at as "createdAt", expires_at as "expiresAt", accepted_at as "acceptedAt"
      from public.invites where workspace_id = $1 order by created_at desc
      `,
      [workspaceId],
    ),
  )
  return rows as InviteRow[]
}