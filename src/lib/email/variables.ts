import type { Contact } from '@/lib/domain/types'

/**
 * Template variables.
 *
 * The registry is the single source of truth for the dashboard's variable
 * picker, the API docs, the MCP tool descriptions and the prompt given to the
 * AI assistant — so an agent composing an email picks from exactly the same list
 * a human sees.
 */
export type EmailVariable = {
  key: string
  label: string
  group: 'contact' | 'company' | 'custom' | 'system'
  description: string
  example: string
}

export const EMAIL_VARIABLES: EmailVariable[] = [
  {
    key: 'firstName',
    label: 'First name',
    group: 'contact',
    description: "The contact's first name. Falls back to the part before @ in the email when no name is set.",
    example: 'Emilio',
  },
  {
    key: 'lastName',
    label: 'Last name',
    group: 'contact',
    description: "The contact's last name.",
    example: 'Costa',
  },
  {
    key: 'email',
    label: 'Email address',
    group: 'contact',
    description: "The contact's email address.",
    example: 'emilio@example.com',
  },
  {
    key: 'phone',
    label: 'Phone',
    group: 'contact',
    description: "The contact's phone number, when known.",
    example: '+1 555 0100',
  },
  {
    key: 'company',
    label: 'Company',
    group: 'company',
    description: "The contact's company.",
    example: 'Northwind',
  },
  {
    key: 'createdAt',
    label: 'Subscribed since',
    group: 'system',
    description: "Date the contact was added, formatted for humans.",
    example: 'March 4, 2025',
  },
  {
    key: 'unsubscribeUrl',
    label: 'Unsubscribe link',
    group: 'system',
    description: 'Signed one-click unsubscribe URL for this contact.',
    example: 'https://app.example.com/unsubscribe/…',
  },
  {
    key: 'currentYear',
    label: 'Current year',
    group: 'system',
    description: 'The year the message is sent.',
    example: '2026',
  },
]

export const VARIABLE_TOKEN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g

function humanDate(value: string | Date | null | undefined): string {
  if (!value) return ''
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

/**
 * Missing variables resolve to an empty string rather than leaking the raw
 * `{{token}}` into a customer's inbox.
 */
export function interpolate(
  input: string,
  values: Record<string, string>,
): string {
  return input.replace(VARIABLE_TOKEN, (match, key: string) => {
    const value = values[key]
    return value === undefined || value === null ? '' : value
  })
}

export function contactVariables(
  contact: Pick<
    Contact,
    'email' | 'firstName' | 'lastName' | 'phone' | 'company' | 'createdAt' | 'customFields'
  >,
  extra: Record<string, string> = {},
): Record<string, string> {
  const custom: Record<string, string> = {}
  for (const [key, value] of Object.entries(contact.customFields ?? {})) {
    custom[key] = value === null || value === undefined ? '' : String(value)
  }

  const name = contact.firstName?.trim()
  const fallbackName = contact.email.split('@')[0]

  return {
    firstName: name || fallbackName,
    lastName: contact.lastName ?? '',
    email: contact.email,
    phone: contact.phone ?? '',
    company: contact.company ?? '',
    createdAt: humanDate(contact.createdAt),
    currentYear: String(new Date().getFullYear()),
    ...custom,
    ...extra,
  }
}

export function unknownVariables(input: string): string[] {
  const found = new Set<string>()
  for (const match of input.matchAll(VARIABLE_TOKEN)) {
    found.add(match[1]!)
  }
  return [...found]
}