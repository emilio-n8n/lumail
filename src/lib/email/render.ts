import { signToken } from '@/lib/auth/crypto'

/**
 * Server-side email rendering helpers: click tracking, plain-text extraction.
 * The document itself is rendered by the browser-safe `render-document.ts`.
 */

import { escapeHtml } from './render-document'

export * from './render-document'

/**
 * Rewrites outbound links through the click tracker so every click is
 * attributable to a contact and a campaign. `mailto:` and fragment links are
 * left untouched.
 */
export function rewriteLinksForTracking(
  html: string,
  options: { baseUrl: string; messageId: string },
): string {
  return html.replace(/href="([^"]*)"/g, (match, href: string) => {
    if (!/^https?:\/\//i.test(href)) return match
    if (href.startsWith(options.baseUrl)) return match

    const token = signToken(
      { messageId: options.messageId, url: href },
      60 * 60 * 24 * 30,
    )
    return `href="${escapeHtml(`${options.baseUrl}/c/${token}`)}"`
  })
}

/** Plain-text alternative — good deliverability and accessible previews. */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}