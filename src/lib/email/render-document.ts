import type { EmailBlock, EmailDocument } from '@/lib/domain/types'

/**
 * Email document rendering.
 *
 * Output is deliberately table-based and inline-styled: that is what mail
 * clients (Gmail, Outlook) actually require. Nothing here depends on the app's
 * CSS, so a template renders identically in the editor preview, in a test send
 * and in the inbox.
 *
 * This module is browser-safe: the editor renders previews with it. Tracking
 * concerns (click rewriting, open pixels) live in `render.ts`, which is
 * server-only.
 */

export const EMAIL_MAX_WIDTH = 600

type RenderOptions = {
  /** Absolute origin used to build tracking + unsubscribe URLs. */
  baseUrl: string
  /** Token identifying the outbound message, used for open/click tracking. */
  messageId?: string | null
  unsubscribeToken?: string | null
  /** Set for the "HTML preview" pane so links stay clickable. */
  preview?: boolean
}

const INLINE = {
  body: 'margin:0;padding:0;background-color:#f4f4f1;',
  wrapper:
    'width:100%;background-color:#f4f4f1;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;',
  container:
    'max-width:600px;margin:0 auto;background-color:#ffffff;border-radius:6px;overflow:hidden;',
  content: 'padding:32px 32px 8px 32px;',
  heading: 'margin:0 0 16px 0;font-size:26px;line-height:1.25;font-weight:600;color:#17181a;letter-spacing:-0.01em;',
  text: 'margin:0 0 16px 0;font-size:15px;line-height:1.65;color:#3a3b38;',
  textSm: 'font-size:13px;line-height:1.6;color:#6a6b66;',
  button:
    'display:inline-block;padding:11px 22px;font-size:15px;font-weight:600;text-decoration:none;border-radius:5px;',
  divider: 'border:0;border-top:1px solid #e6e6e0;margin:28px 0;',
  spacer: 'display:block;font-size:0;line-height:0;',
  image: 'display:block;border:0;max-width:100%;height:auto;',
  footer: 'padding:20px 32px 28px 32px;font-size:12px;line-height:1.6;color:#8a8b85;',
  preheader:
    'display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#ffffff;',
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Only `http`, `https` and `mailto` survive. This blocks `javascript:` URLs in
 * both the preview iframe and the delivered message.
 */
export function sanitizeUrl(value: string): string {
  const trimmed = (value ?? '').trim()
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed
  if (/^[/#]/.test(trimmed)) return trimmed
  return '#'
}

function renderBlock(block: EmailBlock): string {
  switch (block.type) {
    case 'heading': {
      const size = { 1: 30, 2: 24, 3: 19 }[block.props.level]
      return `<h${block.props.level} style="${INLINE.heading.replace(
        'font-size:26px',
        `font-size:${size}px`,
      )}text-align:${block.props.align}">${block.props.text}</h>`
    }

    case 'text': {
      const size = { sm: 13, md: 15, lg: 17 }[block.props.size]
      return `<p style="${INLINE.text.replace(
        'font-size:15px',
        `font-size:${size}px`,
      )}text-align:${block.props.align}">${block.props.text}</p>`
    }

    case 'image': {
      const src = sanitizeUrl(block.props.src)
      const width =
        block.props.width === 'full' ? 'width:100%;' : 'max-width:100%;'
      const img = `<img src="${escapeHtml(src)}" alt="${escapeHtml(
        block.props.alt,
      )}" style="${INLINE.image}${width}" />`
      if (block.props.href) {
        return `<a href="${escapeHtml(sanitizeUrl(block.props.href))}" target="_blank" rel="noopener">${img}</a>`
      }
      return `<div style="margin:0 0 20px 0">${img}</div>`
    }

    case 'button': {
      const styles = {
        primary: `${INLINE.button}background-color:#17181a;color:#ffffff;`,
        outline: `${INLINE.button}background-color:transparent;color:#17181a;border:1px solid #17181a;`,
        ghost: `${INLINE.button}background-color:transparent;color:#4a4b47;padding-left:0;`,
      }[block.props.variant]

      return `<div style="text-align:${block.props.align};margin:0 0 24px 0">
        <a href="${escapeHtml(sanitizeUrl(block.props.href))}" style="${styles}" target="_blank" rel="noopener">${escapeHtml(
          block.props.label,
        )}</a>
      </div>`
    }

    case 'divider':
      return `<hr style="${INLINE.divider}" />`

    case 'spacer':
      return `<div style="${INLINE.spacer}height:${Math.max(
        0,
        Math.min(200, block.props.height ?? 24),
      )}px">&nbsp;</div>`

    case 'columns': {
      const columns = block.props.columns ?? []
      if (columns.length === 0) return ''
      const width = Math.floor(100 / columns.length)
      const cells = columns
        .map(
          (column) =>
            `<td style="width:${width}%;vertical-align:top;padding:0 8px 16px 8px">${column.blocks
              .map(renderBlock)
              .join('')}</td>`,
        )
        .join('')
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%"><tr>${cells}</tr></table>`
    }

    case 'social': {
      const links = block.props.links ?? []
      if (links.length === 0) return ''
      const items = links
        .map(
          (link) =>
            `<a href="${escapeHtml(sanitizeUrl(link.href))}" style="${INLINE.textSm}color:#4a4b47;margin:0 12px;text-decoration:underline;">${escapeHtml(
              link.label,
            )}</a>`,
        )
        .join('')
      return `<div style="text-align:center;margin:8px 0 20px 0">${items}</div>`
    }

    case 'html':
      // Explicit escape hatch. Restricted to the workspace's own templates, so
      // it is trusted input — this is what the "custom HTML" block is for.
      return block.props.html ?? ''

    default:
      return ''
  }
}

export function renderDocument(
  document: EmailDocument,
  options: RenderOptions & { preheader?: string | null; blocksOverride?: EmailBlock[] },
): string {
  const blocks = options.blocksOverride ?? document?.blocks ?? []
  const body = blocks.map(renderBlock).join('\n')

  const preheader = options.preheader
    ? `<div style="${INLINE.preheader}">${escapeHtml(options.preheader)}</div>`
    : ''

  const unsubscribe =
    options.unsubscribeToken && !options.preview
      ? `<div style="${INLINE.footer}">
          <p style="margin:0 0 8px 0">
            You are receiving this because you subscribed to this list.
          </p>
          <p style="margin:0">
            <a href="${escapeHtml(
              `${options.baseUrl}/unsubscribe/${options.unsubscribeToken}`,
            )}" style="color:#8a8b85;text-decoration:underline;">Unsubscribe</a>
          </p>
        </div>`
      : ''

  const pixel =
    options.messageId && !options.preview
      ? `<img src="${escapeHtml(
          `${options.baseUrl}/o/${options.messageId}.gif`,
        )}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;" />`
      : ''

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light" />
<title>${escapeHtml(options.preheader ?? 'Message')}</title>
</head>
<body style="${INLINE.body}">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${INLINE.wrapper}">
  <tr>
    <td align="center">
      <table role="presentation" width="${EMAIL_MAX_WIDTH}" cellpadding="0" cellspacing="0" style="${INLINE.container}">
        <tr>
          <td style="${INLINE.content}">
${body}
          </td>
        </tr>
        ${unsubscribe ? `<tr><td>${unsubscribe}</td></tr>` : ''}
      </table>
      ${pixel}
    </td>
  </tr>
</table>
</body>
</html>`
}
