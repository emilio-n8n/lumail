/**
 * Open-redirect guard.
 *
 * Used wherever a URL supplied by a message or a client is used as a redirect
 * target. Only absolute http(s) URLs are allowed; protocol-relative URLs
 * (`//evil.com`), `javascript:` and `data:` schemes are rejected.
 */
/**
 * Constant-time secret comparison. Implemented by hand rather than with
 * `node:crypto` so this module stays importable from the browser bundle.
 */
export function isValidSecret(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) {
    // Still walk a fixed number of comparisons so timing does not leak length.
    let mismatch = 1
    for (let i = 0; i < expected.length; i++) mismatch |= 0
    return mismatch === 0
  }

  let mismatch = 0
  for (let i = 0; i < provided.length; i++) {
    mismatch |= provided.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return mismatch === 0
}

export function isSafeRedirect(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  if (value.startsWith('//')) return false

  return true
}