import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { z } from 'zod'
import { guard } from './auth'
import type { EmailDocument } from '@/lib/domain/types'

/** Campaigns and templates. Domain modules are loaded lazily (see auth.ts). */
const loadDeps = createServerOnlyFn(async () => {
  const [campaigns, templates, transactional] = await Promise.all([
    import('@/lib/domain/campaigns'),
    import('@/lib/domain/templates'),
    import('@/lib/domain/transactional'),
  ])
  return { campaigns, templates, transactional }
})

function load() {
  return loadDeps()
}

/** Campaigns + templates. */

const documentSchema: z.ZodType<EmailDocument> = z.object({
  blocks: z.array(z.any()),
})

export const campaignList = createServerFn({ method: 'GET' })
    .validator(
      z.object({
        status: z.string().nullable().optional(),
        search: z.string().nullable().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      }),
    )
    .handler(async ({ data }) => guard(async () => (await load()).campaigns.listCampaigns(data)))

export const campaignGet = createServerFn({ method: 'GET' })
    .validator(z.object({ id: z.string().uuid() }))
    .handler(async ({ data }) => guard(async () => (await load()).campaigns.getCampaign(data.id)))

export const campaignCreate = createServerFn({ method: 'POST' })
    .validator(
      z.object({
        name: z.string().min(1, 'Give the campaign a name'),
        subject: z.string().optional(),
        preheader: z.string().nullable().optional(),
        fromEmail: z.string().nullable().optional(),
        fromName: z.string().nullable().optional(),
        replyTo: z.string().nullable().optional(),
        templateId: z.string().uuid().nullable().optional(),
        segmentId: z.string().uuid().nullable().optional(),
        html: z.string().optional(),
        document: documentSchema.optional(),
      }),
    )
    .handler(async ({ data }) => guard(async () => (await load()).campaigns.createCampaign(data as never)))

export const campaignUpdate = createServerFn({ method: 'POST' })
    .validator(
      z.object({
        id: z.string().uuid(),
        name: z.string().optional(),
        subject: z.string().optional(),
        preheader: z.string().nullable().optional(),
        fromEmail: z.string().nullable().optional(),
        fromName: z.string().nullable().optional(),
        replyTo: z.string().nullable().optional(),
        templateId: z.string().uuid().nullable().optional(),
        segmentId: z.string().uuid().nullable().optional(),
        html: z.string().optional(),
        document: documentSchema.optional(),
        scheduledAt: z.string().nullable().optional(),
      }),
    )
    .handler(({ data }) => {
      const { id, ...patch } = data
      return guard(async () => (await load()).campaigns.updateCampaign(id, patch as never))
    })

export const campaignRemove = createServerFn({ method: 'POST' })
    .validator(z.object({ id: z.string().uuid() }))
    .handler(async ({ data }) => guard(async () => (await load()).campaigns.deleteCampaign(data.id)))

export const campaignDuplicate = createServerFn({ method: 'POST' })
    .validator(z.object({ id: z.string().uuid() }))
    .handler(async ({ data }) => guard(async () => (await load()).campaigns.duplicateCampaign(data.id)))

export const campaignSendTest = createServerFn({ method: 'POST' })
    .validator(
      z.object({
        campaignId: z.string().uuid(),
        to: z.string().email(),
      }),
    )
    .handler(async ({ data }) =>
      guard(async () => {
      const { campaigns, templates, transactional } = await load()
        const { sendTransactional } = await import(
          '@/lib/domain/transactional'
        )
        const { getCampaign } = await import('@/lib/domain/campaigns')

        const campaign = await getCampaign(data.campaignId)

        return sendTransactional({
          to: data.to,
          subject: campaign.subject || 'Lumail test',
          html: campaign.html,
          variables: { firstName: 'there' },
        })
      }),
    )

export const campaignPreviewAudience = createServerFn({ method: 'GET' })
    .validator(z.object({ segmentId: z.string().uuid().nullable() }))
    .handler(async ({ data }) => guard(async () => (await load()).campaigns.previewAudience(data.segmentId)))

export const campaignSchedule = createServerFn({ method: 'POST' })
    .validator(
      z.object({
        id: z.string().uuid(),
        scheduledAt: z.string(),
      }),
    )
    .handler(({ data }) =>
      guard(async () => {
      const { campaigns, templates, transactional } = await load()
        const when = new Date(data.scheduledAt)
        if (Number.isNaN(when.getTime())) {
          throw new Error('That schedule time is not a valid date')
        }
        const { ensureJobTicker } = await import('@/lib/jobs/ticker')
        ensureJobTicker()
        return campaigns.scheduleCampaign(data.id, when)
      }),
    )

export const campaignSend = createServerFn({ method: 'POST' })
    .validator(z.object({ id: z.string().uuid() }))
    .handler(async ({ data }) =>
      guard(async () => {
      const { campaigns, templates, transactional } = await load()
        const { ensureJobTicker } = await import('@/lib/jobs/ticker')
        ensureJobTicker()
        return campaigns.launchCampaign(data.id)
      }),
    )

export const campaignPause = createServerFn({ method: 'POST' })
    .validator(z.object({ id: z.string().uuid() }))
    .handler(async ({ data }) =>
      guard(async () => (await load()).campaigns.updateCampaign(data.id, { status: 'paused' })),
    )

export const campaignCancel = createServerFn({ method: 'POST' })
    .validator(z.object({ id: z.string().uuid() }))
    .handler(async ({ data }) => guard(async () => (await load()).campaigns.cancelCampaign(data.id)))

export const campaignStats = createServerFn({ method: 'GET' })
    .validator(z.object({ id: z.string().uuid() }))
    .handler(async ({ data }) => guard(async () => (await load()).campaigns.campaignStats(data.id)))

export const campaignServerFns = {
  list: campaignList,
  get: campaignGet,
  create: campaignCreate,
  update: campaignUpdate,
  remove: campaignRemove,
  duplicate: campaignDuplicate,
  sendTest: campaignSendTest,
  previewAudience: campaignPreviewAudience,
  schedule: campaignSchedule,
  send: campaignSend,
  pause: campaignPause,
  cancel: campaignCancel,
  stats: campaignStats,
}


export const templateList = createServerFn({ method: 'GET' })
    .validator(
      z.object({
        category: z.string().nullable().optional(),
        search: z.string().nullable().optional(),
      }),
    )
    .handler(async ({ data }) => guard(async () => (await load()).templates.listTemplates(data)))

export const templateGet = createServerFn({ method: 'GET' })
    .validator(z.object({ id: z.string().uuid() }))
    .handler(async ({ data }) => guard(async () => (await load()).templates.getTemplate(data.id)))

export const templateCreate = createServerFn({ method: 'POST' })
    .validator(
      z.object({
        name: z.string().min(1, 'Give the template a name'),
        category: z.enum([
          'newsletter',
          'welcome',
          'product_update',
          'transactional',
          'promotion',
          'onboarding',
        ]).optional(),
        subject: z.string().optional(),
        preheader: z.string().nullable().optional(),
        html: z.string().optional(),
        document: documentSchema.optional(),
        isTransactional: z.boolean().optional(),
      }),
    )
    .handler(async ({ data }) => guard(async () => (await load()).templates.createTemplate(data as never)))

export const templateUpdate = createServerFn({ method: 'POST' })
    .validator(
      z.object({
        id: z.string().uuid(),
        name: z.string().optional(),
        category: z
          .enum([
            'newsletter',
            'welcome',
            'product_update',
            'transactional',
            'promotion',
            'onboarding',
          ])
          .optional(),
        subject: z.string().optional(),
        preheader: z.string().nullable().optional(),
        html: z.string().optional(),
        document: documentSchema.optional(),
        isTransactional: z.boolean().optional(),
      }),
    )
    .handler(({ data }) => {
      const { id, ...patch } = data
      return guard(async () => (await load()).templates.updateTemplate(id, patch as never))
    })

export const templateRemove = createServerFn({ method: 'POST' })
    .validator(z.object({ id: z.string().uuid() }))
    .handler(async ({ data }) => guard(async () => (await load()).templates.deleteTemplate(data.id)))

export const templateDuplicate = createServerFn({ method: 'POST' })
    .validator(z.object({ id: z.string().uuid() }))
    .handler(async ({ data }) => guard(async () => (await load()).templates.duplicateTemplate(data.id)))

export const templateCreateCampaign = createServerFn({ method: 'POST' })
    .validator(
      z.object({
        templateId: z.string().uuid(),
        campaignName: z.string().optional(),
      }),
    )
    .handler(async ({ data }) =>
      guard(async () => (await load()).templates.createCampaignFromTemplate(data.templateId, data.campaignName)),
    )

export const templateServerFns = {
  list: templateList,
  get: templateGet,
  create: templateCreate,
  update: templateUpdate,
  remove: templateRemove,
  duplicate: templateDuplicate,
  createCampaign: templateCreateCampaign,
}
