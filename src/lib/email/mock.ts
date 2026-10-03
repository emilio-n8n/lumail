import type { EmailProvider, OutboundEmail, ProviderHealth, SendContext, SendResult } from './provider'
import { enqueueJob } from '@/lib/jobs/queue'

/**
 * Development email provider.
 *
 * Nothing leaves the machine. Instead it schedules jobs that emulate a real
 * mailbox lifecycle — accepted → delivered → (opened) → (clicked) — plus the
 * unhappy paths (bounce, complaint, unsubscribe) at realistic rates. Because the
 * emulation runs through the ordinary job queue, campaigns animate live in the
 * dashboard and the analytics funnel fills in exactly as it would in production.
 *
 * Deterministic mode is used by the seeder to build 90 days of history quickly.
 */

export const MOCK_ENGINE = {
  deliveryDelayMs: [600, 4_000],
  openRate: 0.42,
  openDelayMs: [8_000, 240_000],
  clickRate: 0.36,
  clickDelayMs: [12_000, 360_000],
  bounceRate: 0.014,
  complaintRate: 0.003,
  unsubscribeRate: 0.006,
} as const

function randomInt(range: readonly [number, number]): number {
  const [min, max] = range
  return Math.floor(min + Math.random() * (max - min))
}

export class MockProvider implements EmailProvider {
  readonly name = 'mock'

  async health(): Promise<ProviderHealth> {
    return {
      name: this.name,
      live: true,
      detail:
        'Simulation mode — delivery, opens, clicks, bounces and unsubscribes are emulated locally.',
    }
  }

  async send(_email: OutboundEmail, context: SendContext): Promise<SendResult> {
    const providerMessageId = `mock_${context.messageId.slice(0, 12)}`

    const roll = Math.random()
    if (roll < MOCK_ENGINE.bounceRate) {
      await enqueueJob({
        workspaceId: context.workspaceId,
        kind: 'mock_bounce',
        runAt: new Date(Date.now() + randomInt([3_000, 20_000])),
        payload: { messageId: context.messageId, reason: '550 5.1.1 mailbox unavailable' },
      })
      return { provider: this.name, providerMessageId, accepted: [], rejected: [_email.to] }
    }

    if (roll < MOCK_ENGINE.bounceRate + MOCK_ENGINE.complaintRate) {
      await enqueueJob({
        workspaceId: context.workspaceId,
        kind: 'mock_complaint',
        runAt: new Date(Date.now() + randomInt([5_000, 30_000])),
        payload: { messageId: context.messageId },
      })
    }

    const deliveredAt = Date.now() + randomInt(MOCK_ENGINE.deliveryDelayMs)
    await enqueueJob({
      workspaceId: context.workspaceId,
      kind: 'mock_delivered',
      runAt: new Date(deliveredAt),
      payload: { messageId: context.messageId, providerMessageId },
    })

    if (Math.random() < MOCK_ENGINE.openRate) {
      const openedAt = deliveredAt + randomInt(MOCK_ENGINE.openDelayMs)
      await enqueueJob({
        workspaceId: context.workspaceId,
        kind: 'mock_opened',
        runAt: new Date(openedAt),
        payload: { messageId: context.messageId },
      })

      if (Math.random() < MOCK_ENGINE.clickRate) {
        await enqueueJob({
          workspaceId: context.workspaceId,
          kind: 'mock_clicked',
          runAt: new Date(openedAt + randomInt(MOCK_ENGINE.clickDelayMs)),
          payload: { messageId: context.messageId },
        })
      }
    }

    if (Math.random() < MOCK_ENGINE.unsubscribeRate) {
      await enqueueJob({
        workspaceId: context.workspaceId,
        kind: 'mock_unsubscribed',
        runAt: new Date(deliveredAt + randomInt([60_000, 900_000])),
        payload: { messageId: context.messageId },
      })
    }

    return {
      provider: this.name,
      providerMessageId,
      accepted: [_email.to],
      rejected: [],
    }
  }
}

/**
 * Immediate mode used by the seeder: applies the full lifecycle synchronously
 * with a caller-supplied timestamp so history can be backdated.
 */
export function simulateInstantOutcome(options: {
  messageId: string
  deliveredAt: Date
  openedAt?: Date | null
  clickedAt?: Date | null
  bouncedAt?: Date | null
  unsubscribedAt?: Date | null
}): {
  delivered: boolean
  opened: boolean
  clicked: boolean
  bounced: boolean
  unsubscribed: boolean
} {
  const bounced = Boolean(options.bouncedAt)
  const delivered = Boolean(options.deliveredAt) && !bounced
  const opened = Boolean(options.openedAt) && delivered
  const clicked = Boolean(options.clickedAt) && opened
  const unsubscribed = Boolean(options.unsubscribedAt)

  return { delivered, opened, clicked, bounced, unsubscribed }
}

export function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}