/**
 * 0002_contacts
 *
 * Raw SQL migration. Applied verbatim inside a single transaction by
 * `src/lib/db/migrate.ts`. Never edit an applied migration — append a new file.
 */
export default `-- ============================================================================
-- 0002 — People: contacts, tags, custom fields, activity and segments
-- ============================================================================

create type public.contact_status as enum (
  'subscribed',
  'unsubscribed',
  'bounced',
  'complained',
  'archived'
);

-- ----------------------------------------------------------------------------
-- tags
-- ----------------------------------------------------------------------------
create table public.tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  color text not null default 'neutral',
  created_at timestamptz not null default now(),
  unique (workspace_id, name)
);

-- ----------------------------------------------------------------------------
-- contacts — emails are stored lower-cased; uniqueness is scoped to workspace
-- ----------------------------------------------------------------------------
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null,
  first_name text,
  last_name text,
  phone text,
  company text,
  status public.contact_status not null default 'subscribed',
  source text,
  custom_fields jsonb not null default '{}'::jsonb,
  attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_activity_at timestamptz,
  unsubscribed_at timestamptz,
  bounced_at timestamptz,
  unique (workspace_id, email)
);

create index contacts_workspace_created_idx
  on public.contacts (workspace_id, created_at desc);
create index contacts_status_idx
  on public.contacts (workspace_id, status);
create index contacts_last_activity_idx
  on public.contacts (workspace_id, last_activity_at desc nulls last);
create index contacts_email_trgm_idx
  on public.contacts (workspace_id, lower(email) text_pattern_ops);

-- ----------------------------------------------------------------------------
-- contact_tags (many-to-many)
-- ----------------------------------------------------------------------------
create table public.contact_tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (contact_id, tag_id)
);

create index contact_tags_tag_idx on public.contact_tags (workspace_id, tag_id);

-- ----------------------------------------------------------------------------
-- custom field definitions
-- ----------------------------------------------------------------------------
create table public.custom_field_definitions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,48}$'),
  label text not null,
  field_type text not null default 'text'
    check (field_type in ('text', 'number', 'date', 'boolean', 'select')),
  options jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (workspace_id, key)
);

-- ----------------------------------------------------------------------------
-- contact_events — the unified activity stream behind analytics, the contact
-- timeline, segment conditions and the workflow trigger engine.
-- ----------------------------------------------------------------------------
create type public.event_type as enum (
  'created',
  'updated',
  'tag_added',
  'tag_removed',
  'segment_added',
  'segment_removed',
  'queued',
  'sent',
  'delivered',
  'opened',
  'clicked',
  'bounced',
  'complained',
  'unsubscribed',
  'purchased',
  'workflow_enrolled',
  'workflow_completed',
  'custom'
);

create table public.contact_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete cascade,
  event_type public.event_type not null,
  campaign_id uuid,
  message_id uuid,
  workflow_id uuid,
  node_id text,
  url text,
  ip text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index contact_events_workspace_time_idx
  on public.contact_events (workspace_id, occurred_at desc);
create index contact_events_contact_idx
  on public.contact_events (contact_id, occurred_at desc);
create index contact_events_type_idx
  on public.contact_events (workspace_id, event_type, occurred_at desc);

-- ----------------------------------------------------------------------------
-- segments — dynamic definitions evaluated on read
-- ----------------------------------------------------------------------------
create table public.segments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  description text,
  match_mode text not null default 'all' check (match_mode in ('all', 'any')),
  conditions jsonb not null default '[]'::jsonb,
  include_manually_added boolean not null default true,
  cached_count integer,
  last_calculated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index segments_workspace_idx on public.segments (workspace_id, name);

-- ----------------------------------------------------------------------------
-- segment_memberships — explicit membership for "add to segment" actions
-- ----------------------------------------------------------------------------
create table public.segment_memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  segment_id uuid not null references public.segments (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  added_by text not null default 'manual',
  created_at timestamptz not null default now(),
  unique (segment_id, contact_id)
);

create index segment_memberships_contact_idx
  on public.segment_memberships (workspace_id, contact_id);

-- ----------------------------------------------------------------------------
-- Grants + row level security for every workspace-scoped table in this file.
-- Explicit table list keeps the policy surface auditable.
-- ----------------------------------------------------------------------------
do $$
declare
  tenant_table text;
begin
  foreach tenant_table in array (
    array[
      'tags',
      'contacts',
      'contact_tags',
      'custom_field_definitions',
      'contact_events',
      'segments',
      'segment_memberships'
    ]
  ) loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', tenant_table);
    execute format('grant all on public.%I to service_role', tenant_table);
    execute format('alter table public.%I enable row level security', tenant_table);

    execute format(
      'create policy %I on public.%I for select to authenticated using (public.can_read_workspace(workspace_id))',
      tenant_table || '_select', tenant_table
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.can_write_workspace(workspace_id))',
      tenant_table || '_insert', tenant_table
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.can_write_workspace(workspace_id)) with check (public.can_write_workspace(workspace_id))',
      tenant_table || '_update', tenant_table
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.can_write_workspace(workspace_id))',
      tenant_table || '_delete', tenant_table
    );
  end loop;
end $$;`
