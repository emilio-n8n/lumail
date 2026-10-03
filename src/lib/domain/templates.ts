import { many, one, withAuthenticatedDb } from '@/integrations/database/client'
import { requireWorkspaceMember } from '@/integrations/database/auth-runtime'
import { NotFoundError } from '@/lib/auth/session'
import { renderDocument } from '@/lib/email/render'
import { mapTemplate } from './mappers'
import type { EmailDocument, EmailTemplate, TemplateCategory } from './types'

export const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  'newsletter',
  'welcome',
  'product_update',
  'transactional',
  'promotion',
  'onboarding',
]

export async function listTemplates(
  query: { category?: string | null; search?: string | null } = {},
): Promise<EmailTemplate[]> {
  const { userId, workspaceId } = await requireWorkspaceMember()

  return withAuthenticatedDb({ userId, workspaceId }, async (tx) => {
    const params: unknown[] = [workspaceId]
    const filters = ['t.workspace_id = $1']

    if (query.category) {
      params.push(query.category)
      filters.push(`t.category = $${params.length}::public.template_category`)
    }
    if (query.search) {
      params.push(`%${query.search.toLowerCase()}%`)
      const p = `$${params.length}`
      filters.push(`(lower(t.name) like ${p} or lower(t.subject) like ${p})`)
    }

    const rows = await many<Record<string, any>>(
      tx,
      `select t.* from public.templates t
       where ${filters.join(' and ')}
       order by t.updated_at desc`,
      params,
    )
    return rows.map(mapTemplate)
  })
}

export async function getTemplate(id: string): Promise<EmailTemplate> {
  const { userId, workspaceId } = await requireWorkspaceMember()
  return withAuthenticatedDb({ userId, workspaceId }, async (tx) => {
    const row = await one<Record<string, any>>(
      tx,
      'select * from public.templates where id = $1',
      [id],
    )
    if (!row) throw new NotFoundError('Template not found')
    return mapTemplate(row)
  })
}

export type TemplateInput = {
  name: string
  category?: TemplateCategory
  subject?: string
  preheader?: string | null
  html?: string
  document?: EmailDocument
  isTransactional?: boolean
}

export async function createTemplate(input: TemplateInput): Promise<EmailTemplate> {
  const { userId, workspaceId } = await requireWorkspaceMember()

  return withAuthenticatedDb({ userId, workspaceId }, async (tx) => {
    const document = input.document ?? { blocks: [] }
    const html =
      input.html ??
      renderDocument(document, {
        baseUrl: process.env.APP_URL ?? 'http://localhost:3000',
        preview: true,
        preheader: input.preheader,
      })

    const row = await one<Record<string, any>>(
      tx,
      `
      insert into public.templates (
        workspace_id, name, category, subject, preheader, html, document, is_transactional, created_by
      )
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      returning *
      `,
      [
        workspaceId,
        input.name,
        input.category ?? 'newsletter',
        input.subject ?? '',
        input.preheader ?? null,
        html,
        JSON.stringify(document),
        input.isTransactional ?? false,
        userId,
      ],
    )
    return mapTemplate(row!)
  })
}

export async function updateTemplate(
  id: string,
  patch: Partial<TemplateInput>,
): Promise<EmailTemplate> {
  const { userId, workspaceId } = await requireWorkspaceMember()

  return withAuthenticatedDb({ userId, workspaceId }, async (tx) => {
    const current = await one<Record<string, any>>(
      tx,
      'select * from public.templates where id = $1',
      [id],
    )
    if (!current) throw new NotFoundError('Template not found')

    const document = patch.document ?? current.document
    const html =
      patch.html ??
      (patch.document
        ? renderDocument(document, {
            baseUrl: process.env.APP_URL ?? 'http://localhost:3000',
            preview: true,
            preheader: patch.preheader ?? current.preheader,
          })
        : current.html)

    const row = await one<Record<string, any>>(
      tx,
      `
      update public.templates set
        name = coalesce($2, name),
        category = coalesce($3, category),
        subject = coalesce($4, subject),
        preheader = coalesce($5, preheader),
        html = $6,
        document = $7,
        is_transactional = coalesce($8, is_transactional),
        updated_at = now()
      where id = $1
      returning *
      `,
      [
        id,
        patch.name ?? null,
        patch.category ?? null,
        patch.subject ?? null,
        patch.preheader ?? null,
        html,
        JSON.stringify(document),
        patch.isTransactional ?? null,
      ],
    )
    return mapTemplate(row!)
  })
}

export async function deleteTemplate(id: string): Promise<void> {
  const { userId, workspaceId } = await requireWorkspaceMember()
  await withAuthenticatedDb({ userId, workspaceId }, (tx) =>
    tx.query('delete from public.templates where id = $1', [id]),
  )
}

export async function duplicateTemplate(id: string): Promise<EmailTemplate> {
  const source = await getTemplate(id)
  return createTemplate({
    name: `${source.name} (copy)`,
    category: source.category,
    subject: source.subject,
    preheader: source.preheader,
    html: source.html,
    document: source.document,
    isTransactional: source.isTransactional,
  })
}

/** Creates a campaign pre-filled from a template — no editor round-trip. */
export async function createCampaignFromTemplate(
  templateId: string,
  campaignName?: string,
) {
  const { createCampaign } = await import('./campaigns')
  const template = await getTemplate(templateId)

  return createCampaign({
    name: campaignName ?? template.name,
    subject: template.subject,
    preheader: template.preheader,
    templateId: template.id,
    html: template.html,
    document: template.document,
  })
}

export function emptyDocument(): EmailDocument {
  return {
    blocks: [
      {
        id: 'block_heading_1',
        type: 'heading',
        props: { level: 1, text: 'A clear, specific subject line', align: 'left' },
      },
      {
        id: 'block_text_1',
        type: 'text',
        props: {
          text: 'Hi {{firstName}},<br><br>Write the part that matters most first. Everything else is optional.',
          align: 'left',
          size: 'md',
        },
      },
      {
        id: 'block_button_1',
        type: 'button',
        props: {
          label: 'Read more',
          href: 'https://example.com',
          align: 'left',
          variant: 'primary',
        },
      },
    ],
  }
}