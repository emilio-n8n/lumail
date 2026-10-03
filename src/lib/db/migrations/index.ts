import migration0001 from './0001_identity'
import migration0002 from './0002_contacts'
import migration0003 from './0003_email'
import migration0004 from './0004_automation'
import migration0005 from './0005_platform'

export type Migration = {
  id: string
  sql: string
}

/**
 * Ordered, append-only migration list. Never edit an applied migration —
 * add a new one instead.
 */
export const migrations: Migration[] = [
  { id: '0001_identity', sql: migration0001 },
  { id: '0002_contacts', sql: migration0002 },
  { id: '0003_email', sql: migration0003 },
  { id: '0004_automation', sql: migration0004 },
  { id: '0005_platform', sql: migration0005 },
]