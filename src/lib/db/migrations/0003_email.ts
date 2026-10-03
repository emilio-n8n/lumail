/**
 * 0003_email
 *
 * Raw SQL migration. Applied verbatim inside a single transaction by
 * `src/lib/db/migrate.ts`. Never edit an applied migration — append a new file.
 */
export default `-- ============================================================================
-- 0003 — Email assets: templates, campaigns, recipients, message ledger
-- ============================================================================

create type public.template_category as enum (
  'newsletter',
  'welcome',
  'product_update',
  'transactional',
  'promotion',
  'onboarding'
);

create type public.campaign_status as enum (
  'draft',
  'scheduled',
  'sending',
  'sent',
  'paused',
  'cancelled'
);

create type public.message_status as enum (
  'queued',
  'sent',
  'delivered',
  'opened',
  'clicked',
  'bounced',
  'complained',
  'unsubscribed',
  'failed'
);

-- ----------------------------------------------------------------------------
-- templates — reusable block documents rendered to HTML at send time
-- ----------------------------------------------------------------------------
create table public.templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  category public.template_category not null default 'newsletter',
  subject text not null default '',
  preheader text,
  html text not null default '',
  document jsonb not null default '{"blocks":[]}'::jsonb,
  is_transactional boolean not null default false,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index templates_workspace_idx
  on public.templates (workspace_id, category, updated_at desc);

-- ----------------------------------------------------------------------------
-- campaigns
-- ----------------------------------------------------------------------------
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  subject text not null default '',
  preheader text,
  from_email text,
  from_name text,
  reply_to text,
  template_id uuid references public.templates (id) on delete set null,
  segment_id uuid references public.segments (id) on delete set null,
  html text not null default '',
  document jsonb not null default '{"blocks":[]}'::jsonb,
  status public.campaign_status not null default 'draft',
  scheduled_at timestamptz,
  started_at timestamptz,
  sent_at timestamptz,
  completed_at timestamptz,
  recipients_count integer not null default 0,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index campaigns_workspace_idx
  on public.campaigns (workspace_id, status, created_at desc);

-- ----------------------------------------------------------------------------
-- campaign_recipients — resolved audience snapshot at send time
-- ----------------------------------------------------------------------------
create table public.campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  message_id uuid,
  status public.message_status not null default 'queued',
  created_at timestamptz not null default now(),
  unique (campaign_id, contact_id)
);

create index campaign_recipients_workspace_idx
  on public.campaign_recipients (workspace_id, campaign_id);

-- ----------------------------------------------------------------------------
-- email_messages — one row per outbound message (campaign, workflow or
-- transactional). Shared by tracking pixels, click redirection and logs.
-- ----------------------------------------------------------------------------
create table public.email_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  campaign_id uuid references public.campaigns (id) on delete cascade,
  workflow_id uuid,
  workflow_run_id uuid,
  template_id uuid references public.templates (id) on delete set null,
  kind text not null default 'campaign' check (kind in ('campaign', 'workflow', 'transactional')),
  to_email text not null,
  to_name text,
  from_email text not null,
  from_name text,
  reply_to text,
  subject text not null,
  html text not null default '',
  text_body text,
  status public.message_status not null default 'queued',
  provider text,
  provider_message_id text,
  unsubscribe_token text,
  metadata jsonb not null default '{}'::jsonb,
  error text,
  attempts integer not null default 0,
  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  first_opened_at timestamptz,
  first_clicked_at timestamptz,
  bounced_at timestamptz,
  created_at timestamptz not null default now()
);

create index email_messages_workspace_idx
  on public.email_messages (workspace_id, created_at desc);
create index email_messages_campaign_idx
  on public.email_messages (workspace_id, campaign_id, status);
create index email_messages_contact_idx
  on public.email_messages (contact_id, created_at desc);
create index email_messages_workflow_idx
  on public.email_messages (workspace_id, workflow_id, created_at desc);

do $$
declare
  tenant_table text;
begin
  foreach tenant_table in array (
    array['templates', 'campaigns', 'campaign_recipients', 'email_messages']
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
