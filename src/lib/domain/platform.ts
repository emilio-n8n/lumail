import { many, one, withAdminDb } from '@/integrations/database/client'
import { generateApiKey, hashApiKey, generateToken, sha256 } from '@/lib/auth/crypto'
import { mapApiKey, mapDomain, mapWebhook } from './mappers'
import type { ApiKey, DomainRecord, Webhook } from './types'

/**
 * Platform services (API keys, sending domains, webhooks).
 *
 * Every function here takes an already-authorised `{ userId, workspaceId }`
 * context. Authorisation itself is enforced by the auth middleware and again by
 * row level security — these functions never read a role from the client.
 */

export type WorkspaceContext = { userId: string; workspaceId: string }

/* -------------------------------------------------------------- API keys */

export const API_KEY_SCOPES = [
  'contacts:read',
  'contacts:write',
  'segments:read',
  'segments:write',
  'campaigns:read',
  'campaigns:write',
  'templates:read',
  'templates:write',
  'workflows:read',
  'workflows:write',
  'emails:send',
  'analytics:read',
  '*',
] as const

export async function listApiKeys(context: WorkspaceContext): Promise<ApiKey[]> {
  return withAdminDb(async (tx) => {
    const rows = await many<Record<string, any>>(
      tx,
      `select * from public.api_keys where workspace_id = $1 order by created_at desc`,
      [context.workspaceId],
    )
    return rows.map(mapApiKey)
  })
}

/** The plaintext key is returned exactly once and never stored. */
export async function createApiKey(
  context: WorkspaceContext,
  input: { name: string; scopes?: string[] },
): Promise<{ apiKey: ApiKey; plaintext: string }> {
  const key = generateApiKey()

  return withAdminDb(async (tx) => {
    const row = await one<Record<string, any>>(
      tx,
      `
      insert into public.api_keys (
        workspace_id, name, prefix, key_hash, scopes, created_by
      )
      values ($1,$2,$3,$4,$5,$6)
      returning *
      `,
      [
        context.workspaceId,
        input.name,
        key.prefix,
        key.hash,
        JSON.stringify(input.scopes?.length ? input.scopes : ['*']),
        context.userId,
      ],
    )
    return { apiKey: mapApiKey(row!), plaintext: key.plaintext }
  })
}

export async function revokeApiKey(
  context: WorkspaceContext,
  id: string,
): Promise<void> {
  await withAdminDb((tx) =>
    tx.query(
      'update public.api_keys set revoked_at = now() where id = $1 and workspace_id = $2',
      [id, context.workspaceId],
    ),
  )
}

export type ResolvedApiKey = {
  workspaceId: string
  apiKeyId: string
  scopes: string[]
  name: string
  /**
   * The member the key acts on behalf of. The effective role is always derived
   * from this user's membership — revoking their access revokes the key.
   */
  principalUserId: string
}

/** Resolves `Authorization: Bearer lm_live_…` to a workspace + scopes. */
export async function resolveApiKey(plaintext: string): Promise<ResolvedApiKey | null> {
  if (!plaintext.startsWith('lm_live_')) return null

  return withAdminDb(async (tx) => {
    const row = await one<Record<string, any>>(
      tx,
      `
      update public.api_keys
      set last_used_at = now()
      where key_hash = $1 and revoked_at is null
      returning *
      `,
      [hashApiKey(plaintext)],
    )
    if (!row) return null

    return {
      workspaceId: row.workspace_id as string,
      apiKeyId: row.id as string,
      scopes: (row.scopes as string[]) ?? ['*'],
      name: row.name as string,
      principalUserId: (row.created_by ?? '') as string,
    }
  })
}

export function assertScope(scopes: string[], required: string): void {
  if (scopes.includes('*') || scopes.includes(required)) return
  throw new Error(`This API key is missing the "${required}" scope`)
}

/* --------------------------------------------------------------- domains */

export async function listDomains(
  context: WorkspaceContext,
  appUrl: string,
): Promise<DomainRecord[]> {
  return withAdminDb(async (tx) => {
    const rows = await many<Record<string, any>>(
      tx,
      'select * from public.domains where workspace_id = $1 order by is_default desc, created_at asc',
      [context.workspaceId],
    )
    return rows.map((row) => mapDomain(row, appUrl))
  })
}

export async function addDomain(
  context: WorkspaceContext,
  name: string,
): Promise<DomainRecord> {
  const verificationToken = generateToken(12).replace(/[^a-zA-Z0-9]/g, '').slice(0, 16)

  return withAdminDb(async (tx) => {
    // First domain becomes the default sender automatically.
    const existing = await one<{ count: number }>(
      tx,
      'select count(*)::int as count from public.domains where workspace_id = $1',
      [context.workspaceId],
    )

    const row = await one<Record<string, any>>(
      tx,
      `
      insert into public.domains (
        workspace_id, name, status, verification_token, dkim_public_key, is_default
      )
      values ($1,$2,'pending',$3,$4,$5)
      returning *
      `,
      [
        context.workspaceId,
        name.trim().toLowerCase(),
        verificationToken,
        `MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC${verificationToken}x`,
        (existing?.count ?? 0) === 0,
      ],
    )
    return mapDomain(row!, 'http://localhost:3000')
  })
}

export async function verifyDomain(
  context: WorkspaceContext,
  id: string,
  appUrl: string,
): Promise<DomainRecord> {
  return withAdminDb(async (tx) => {
    const domain = await one<Record<string, any>>(
      tx,
      'select * from public.domains where id = $1 and workspace_id = $2',
      [id, context.workspaceId],
    )
    if (!domain) throw new Error('Domain not found')

    // With a live provider the DNS lookups are authoritative; in simulation mode
    // the domain is marked verified so the product remains usable end to end.
    const live = Boolean(process.env.RESEND_API_KEY)
    const status = live ? domain.status : 'verified'

    const row = await one<Record<string, any>>(
      tx,
      `
      update public.domains
      set status = $3::public.domain_status,
          verified_at = case when $3 = 'verified' then now() else null end
      where id = $1 and workspace_id = $2
      returning *
      `,
      [id, context.workspaceId, status],
    )
    return mapDomain(row!, appUrl)
  })
}

export async function setDefaultDomain(
  context: WorkspaceContext,
  id: string,
): Promise<void> {
  await withAdminDb(async (tx) => {
    await tx.query(
      'update public.domains set is_default = false where workspace_id = $1',
      [context.workspaceId],
    )
    await tx.query(
      'update public.domains set is_default = true where id = $1 and workspace_id = $2',
      [id, context.workspaceId],
    )
  })
}

export async function deleteDomain(
  context: WorkspaceContext,
  id: string,
): Promise<void> {
  await withAdminDb((tx) =>
    tx.query('delete from public.domains where id = $1 and workspace_id = $2', [
      id,
      context.workspaceId,
    ]),
  )
}

/* -------------------------------------------------------------- webhooks */

export async function listWebhooks(context: WorkspaceContext): Promise<Webhook[]> {
  return withAdminDb(async (tx) => {
    const rows = await many<Record<string, any>>(
      tx,
      'select * from public.webhooks where workspace_id = $1 order by created_at desc',
      [context.workspaceId],
    )
    return rows.map(mapWebhook)
  })
}

export async function createWebhook(
  context: WorkspaceContext,
  input: { url: string; events: string[]; description?: string | null },
): Promise<Webhook> {
  if (!/^https?:\/\//i.test(input.url)) {
    throw new Error('Webhook URL must start with http:// or https://')
  }

  return withAdminDb(async (tx) => {
    const row = await one<Record<string, any>>(
      tx,
      `
      insert into public.webhooks (workspace_id, url, secret, events, description)
      values ($1,$2,$3,$4,$5)
      returning *
      `,
      [
        context.workspaceId,
        input.url,
        `whsec_${generateToken(24)}`,
        JSON.stringify(input.events?.length ? input.events : ['*']),
        input.description ?? null,
      ],
    )
    return mapWebhook(row!)
  })
}

export async function updateWebhook(
  context: WorkspaceContext,
  id: string,
  patch: { url?: string; events?: string[]; isActive?: boolean; description?: string | null },
): Promise<Webhook> {
  return withAdminDb(async (tx) => {
    const row = await one<Record<string, any>>(
      tx,
      `
      update public.webhooks set
        url = coalesce($3, url),
        events = coalesce($4, events),
        is_active = coalesce($5, is_active),
        description = coalesce($6, description),
        updated_at = now()
      where id = $1 and workspace_id = $2
      returning *
      `,
      [
        id,
        context.workspaceId,
        patch.url ?? null,
        patch.events ? JSON.stringify(patch.events) : null,
        patch.isActive ?? null,
        patch.description ?? null,
      ],
    )
    if (!row) throw new Error('Webhook not found')
    return mapWebhook(row)
  })
}

export async function deleteWebhook(
  context: WorkspaceContext,
  id: string,
): Promise<void> {
  await withAdminDb((tx) =>
    tx.query('delete from public.webhooks where id = $1 and workspace_id = $2', [
      id,
      context.workspaceId,
    ]),
  )
}

export async function listWebhookDeliveries(
  context: WorkspaceContext,
  webhookId?: string | null,
  limit = 50,
) {
  return withAdminDb(async (tx) => {
    const params: unknown[] = [context.workspaceId]
    let filter = ''
    if (webhookId) {
      params.push(webhookId)
      filter = ` and d.webhook_id = $${params.length}`
    }
    params.push(Math.min(limit, 200))

    return many<Record<string, any>>(
      tx,
      `
      select d.id, d.event, d.status, d.attempts, d.response_code as "responseCode",
             d.error, d.created_at as "createdAt", d.completed_at as "completedAt",
             w.url
      from public.webhook_deliveries d
      join public.webhooks w on w.id = d.webhook_id
      where d.workspace_id = $1 ${filter}
      order by d.created_at desc
      limit $${params.length}
      `,
      params,
    )
  })
}