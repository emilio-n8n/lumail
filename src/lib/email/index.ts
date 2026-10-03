import { MockProvider } from './mock'
import { ResendProvider } from './resend'
import type { EmailProvider, ProviderHealth } from './provider'

/**
 * Provider selection.
 *
 * RESEND_API_KEY set → real delivery. Otherwise the simulator is used, so a
 * fresh clone is fully usable without an account. The choice is server-side
 * only; the browser never sees a provider credential.
 */

declare global {
  // eslint-disable-next-line no-var
  var __lumailProvider: EmailProvider | undefined
}

function createProvider(): EmailProvider {
  const apiKey = process.env.RESEND_API_KEY
  const domain = process.env.SENDING_DOMAIN ?? 'lumail.email'

  if (apiKey) {
    try {
      return new ResendProvider(apiKey, domain)
    } catch (error) {
      console.error(
        '[email] Resend adapter failed to initialise, falling back to the simulator:',
        (error as Error).message,
      )
    }
  }

  return new MockProvider()
}

export function getEmailProvider(): EmailProvider {
  if (!globalThis.__lumailProvider) {
    globalThis.__lumailProvider = createProvider()
  }
  return globalThis.__lumailProvider
}

export function isLiveProvider(): boolean {
  return getEmailProvider().name !== 'mock'
}

export async function providerHealth(): Promise<ProviderHealth> {
  return getEmailProvider().health()
}

export * from './provider'
export * from './mock'
export { ResendProvider } from './resend'
export { MockProvider } from './mock'