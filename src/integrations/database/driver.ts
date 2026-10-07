/**
 * Postgres driver for Lovable Cloud.
 *
 * Every statement is sent to the `public.lumail_exec` database function over
 * the Data API using the server-only service key. The function switches to the
 * requested role (`authenticated` → row level security applies, `service_role`
 * → system work) and installs the caller's JWT claims before running the
 * statement, so `auth.uid()` and every policy in `db/` behave exactly as they
 * would behind PostgREST.
 *
 * Each statement is its own transaction: there is no long-lived connection in
 * the Worker runtime. Code that needs atomicity keeps it inside one statement
 * (CTEs, `insert … on conflict`, `update … returning`).
 */

export type QueryResult<T> = {
  rows: T[]
  affectedRows?: number
}

export type Tx = {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>
  exec(sql: string): Promise<unknown>
}

export type DbRole = 'authenticated' | 'service_role'

export type DbClaims = {
  sub: string | null
  role: DbRole
  app_metadata: { workspace_id: string | null }
}

export class DatabaseError extends Error {
  code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.name = 'DatabaseError'
    this.code = code
  }
}

/* ------------------------------------------------------------ parameters */

function quote(value: string): string {
  return `'${value.replace(/\u0000/g, '').replace(/'/g, "''")}'`
}

function arrayElement(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  const text =
    typeof value === 'object' && !(value instanceof Date)
      ? JSON.stringify(value)
      : value instanceof Date
        ? value.toISOString()
        : String(value)
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** Renders one bound parameter as a SQL literal. */
export function literal(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new DatabaseError('Non-finite number parameter')
    return String(value)
  }
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value instanceof Date) return quote(value.toISOString())
  if (Array.isArray(value)) return quote(`{${value.map(arrayElement).join(',')}}`)
  if (typeof value === 'object') return quote(JSON.stringify(value))
  return quote(String(value))
}

/** Replaces `$1…$n` placeholders with literals, outside quoted strings. */
export function inlineParams(sql: string, params: unknown[]): string {
  if (!params.length) return sql
  let out = ''
  let i = 0
  while (i < sql.length) {
    const ch = sql[i]!
    if (ch === "'") {
      const end = findQuoteEnd(sql, i)
      out += sql.slice(i, end)
      i = end
      continue
    }
    if (ch === '"') {
      const end = sql.indexOf('"', i + 1)
      const stop = end === -1 ? sql.length : end + 1
      out += sql.slice(i, stop)
      i = stop
      continue
    }
    if (ch === '$') {
      const m = /^\$(\d+)/.exec(sql.slice(i))
      if (m) {
        const index = Number(m[1]) - 1
        if (index < 0 || index >= params.length) {
          throw new DatabaseError(`Missing parameter $${m[1]}`)
        }
        out += literal(params[index])
        i += m[0].length
        continue
      }
      const tag = /^\$([A-Za-z_]*)\$/.exec(sql.slice(i))
      if (tag) {
        const close = sql.indexOf(tag[0], i + tag[0].length)
        const stop = close === -1 ? sql.length : close + tag[0].length
        out += sql.slice(i, stop)
        i = stop
        continue
      }
    }
    out += ch
    i += 1
  }
  return out
}

function findQuoteEnd(sql: string, start: number): number {
  let i = start + 1
  while (i < sql.length) {
    if (sql[i] === "'") {
      if (sql[i + 1] === "'") {
        i += 2
        continue
      }
      return i + 1
    }
    i += 1
  }
  return sql.length
}

function stripLeadingComments(sql: string): string {
  let s = sql.trimStart()
  for (;;) {
    if (s.startsWith('--')) {
      const nl = s.indexOf('\n')
      s = nl === -1 ? '' : s.slice(nl + 1).trimStart()
    } else if (s.startsWith('/*')) {
      const end = s.indexOf('*/')
      s = end === -1 ? '' : s.slice(end + 2).trimStart()
    } else return s
  }
}

function returnsRows(sql: string): boolean {
  const head = stripLeadingComments(sql)
  if (/^(select|with|values|table|show|explain)\b/i.test(head)) return true
  return /\breturning\b/i.test(sql)
}

/**
 * Index just past the CTE list of a statement that starts with WITH, i.e. the
 * start of its main statement. Skips quoted strings and comments.
 */
function mainStatementStart(sql: string): number {
  let depth = 0
  let sawParen = false
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]
    if (ch === "'" || ch === '"') {
      const quote = ch
      i++
      while (i < sql.length) {
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) i++
          else break
        }
        i++
      }
      continue
    }
    if (ch === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++
      continue
    }
    if (ch === '/' && sql[i + 1] === '*') {
      i = sql.indexOf('*/', i + 2) + 1
      if (i <= 0) return -1
      continue
    }
    if (ch === '(') {
      depth++
      sawParen = true
    } else if (ch === ')') {
      depth--
      if (depth === 0 && sawParen) {
        const rest = sql.slice(i + 1)
        const next = rest.match(/^\s*(\S)/)
        if (next && next[1] !== ',') return i + 1
      }
    }
  }
  return -1
}

/**
 * Wraps a row-returning statement so the database returns it as one JSON
 * array. Data-modifying CTEs must sit at the top level, so a statement that
 * already starts with WITH gets the wrapper appended to its own CTE list.
 */
function wrapForRows(sql: string): string {
  const body = sql.trim().replace(/;\s*$/, '')
  const tail =
    " select coalesce(jsonb_agg(to_jsonb(__lumail_q)), '[]'::jsonb) as rows, count(*) as n from __lumail_q"
  const head = stripLeadingComments(body)
  if (/^with\b/i.test(head)) {
    const split = mainStatementStart(body)
    if (split > 0) {
      return `${body.slice(0, split)}, __lumail_q as (${body.slice(split)})${tail}`
    }
  }
  return `with __lumail_q as (${body})${tail}`
}

/* -------------------------------------------------------------- transport */

async function callExec(
  role: DbRole,
  claims: DbClaims,
  sql: string,
  wantsRows: boolean,
): Promise<{ rows: unknown[]; count: number }> {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new DatabaseError('Database is not configured')

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: key,
  }
  if (!key.startsWith('sb_')) headers['Authorization'] = `Bearer ${key}`

  const response = await fetch(`${url}/rest/v1/rpc/lumail_exec`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      p_role: role,
      p_claims: claims,
      p_sql: wantsRows ? wrapForRows(sql) : sql,
      p_returns: wantsRows,
    }),
  })

  const text = await response.text()
  if (!response.ok) {
    let message = text
    let code: string | undefined
    try {
      const parsed = JSON.parse(text) as { message?: string; code?: string; details?: string }
      message = parsed.message ?? text
      code = parsed.code
    } catch {
      /* not json */
    }
    throw new DatabaseError(message, code)
  }
  const parsed = JSON.parse(text) as { rows: unknown[]; count: number }
  return parsed
}

/** Builds a statement runner bound to one role and set of claims. */
export function createTx(role: DbRole, claims: DbClaims): Tx {
  return {
    async query<U>(sql: string, params: unknown[] = []) {
      const statement = inlineParams(sql, params)
      const result = await callExec(role, claims, statement, returnsRows(sql))
      return { rows: result.rows as U[], affectedRows: result.count }
    },
    async exec(sql: string) {
      return callExec(role, claims, sql, false)
    },
  }
}
