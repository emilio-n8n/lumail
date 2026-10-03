import {
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
  createHash,
} from 'node:crypto'

const SCRYPT_KEYLEN = 64
const SCRYPT_COST = 16_384

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex')
  return `scrypt$${SCRYPT_COST}$${salt}$${derived}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, cost, salt, expected] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !expected) return false

  const derived = scryptSync(password, salt, expected.length / 2)
  const expectedBuffer = Buffer.from(expected, 'hex')
  if (derived.length !== expectedBuffer.length) return false
  return timingSafeEqual(derived, expectedBuffer)
}

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function newId(): string {
  return randomUUID()
}

/**
 * Purpose-scoped HMAC token. Used for unsubscribe links and open/click
 * tracking, where a receiver must not be able to forge an identity.
 */
export function signToken(payload: Record<string, unknown>, ttlSeconds: number): string {
  const secret = process.env.APP_SECRET ?? 'lumail-development-secret'
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds }),
  ).toString('base64url')
  const signature = createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${signature}`
}

export function verifyToken<T = Record<string, unknown>>(token: string): T | null {
  const [body, signature] = token.split('.')
  if (!body || !signature) return null

  const secret = process.env.APP_SECRET ?? 'lumail-development-secret'
  const expected = createHmac('sha256', secret).update(body).digest('base64url')
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  try {
    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      exp?: number
    }
    if (decoded.exp && decoded.exp * 1000 < Date.now()) return null
    return decoded as T
  } catch {
    return null
  }
}

const API_KEY_PREFIX = 'lm_live'

export function generateApiKey(): { plaintext: string; hash: string; prefix: string } {
  const secret = randomBytes(24).toString('base64url')
  const plaintext = `${API_KEY_PREFIX}_${secret}`
  return {
    plaintext,
    hash: sha256(plaintext),
    prefix: plaintext.slice(0, 12),
  }
}

export function hashApiKey(plaintext: string): string {
  return sha256(plaintext)
}