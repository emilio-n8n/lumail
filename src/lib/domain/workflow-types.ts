/**
 * Automation vocabulary. Pure data — safe to import from the browser, and
 * shared with the MCP tool definitions so an agent and the UI agree on names.
 */

import type { WorkflowNodeType } from './types'

export const WORKFLOW_TRIGGERS = [
  'contact_created',
  'tag_added',
  'segment_added',
  'email_opened',
  'link_clicked',
  'custom_event',
  'webhook',
] as const

export type WorkflowTrigger = (typeof WORKFLOW_TRIGGERS)[number]

export const TRIGGER_LABELS: Record<WorkflowTrigger, string> = {
  contact_created: 'Contact created',
  tag_added: 'Tag added',
  segment_added: 'Added to segment',
  email_opened: 'Email opened',
  link_clicked: 'Link clicked',
  custom_event: 'Custom event',
  webhook: 'Webhook',
}

export const WORKFLOW_NODE_TYPES: WorkflowNodeType[] = [
  'trigger',
  'wait',
  'condition',
  'send_email',
  'add_tag',
  'remove_tag',
  'update_contact',
  'add_to_segment',
  'remove_from_segment',
  'webhook',
  'goal',
  'split',
]