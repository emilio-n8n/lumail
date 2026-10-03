grant usage on schema public to anon, authenticated, service_role;

create type public.app_role as enum ('owner', 'admin', 'member');
create type public.invite_status as enum ('pending', 'accepted', 'revoked', 'expired');

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}$'),
  timezone text not null default 'UTC',
  from_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  settings jsonb not null default '{}'::jsonb
);
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  avatar_color text not null default 'citron',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz
);
create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.app_role not null default 'member',
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);
create table public.invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null,
  role public.app_role not null default 'member',
  token_hash text not null unique,
  status public.invite_status not null default 'pending',
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz
);
create index memberships_user_idx on public.memberships (user_id);
create index invites_workspace_idx on public.invites (workspace_id, status);

create or replace function public.current_user_id()
returns uuid language sql stable as $$ select auth.uid(); $$;

create or replace function public.current_workspace_id()
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    nullif(auth.jwt() -> 'app_metadata' ->> 'workspace_id', '')::uuid,
    (select m.workspace_id from public.memberships m where m.user_id = auth.uid() order by m.created_at asc limit 1)
  );
$$;

create or replace function public.current_workspace_access()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m where m.workspace_id = public.current_workspace_id() and m.user_id = auth.uid());
$$;

create or replace function public.has_workspace_role(_workspace_id uuid, _roles public.app_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m where m.workspace_id = _workspace_id and m.user_id = auth.uid() and m.role = any (_roles));
$$;

create or replace function public.can_read_workspace(_workspace_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_workspace_id() is not distinct from _workspace_id and public.current_workspace_access();
$$;

create or replace function public.can_write_workspace(_workspace_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_workspace_role(_workspace_id, array['owner', 'admin', 'member']::public.app_role[]);
$$;

create or replace function public.can_admin_workspace(_workspace_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_workspace_role(_workspace_id, array['owner', 'admin']::public.app_role[]);
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

grant select, insert, update, delete on public.workspaces to authenticated;
grant all on public.workspaces to service_role;
alter table public.workspaces enable row level security;
create policy workspaces_select on public.workspaces for select to authenticated
  using (public.has_workspace_role(id, array['owner', 'admin', 'member']::public.app_role[]));
create policy workspaces_insert on public.workspaces for insert to authenticated with check (true);
create policy workspaces_update on public.workspaces for update to authenticated
  using (public.can_admin_workspace(id)) with check (public.can_admin_workspace(id));
create policy workspaces_delete on public.workspaces for delete to authenticated
  using (public.has_workspace_role(id, array['owner']::public.app_role[]));

grant select, insert, update, delete on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy profiles_select_shared on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1 from public.memberships mine
      join public.memberships theirs on theirs.workspace_id = mine.workspace_id
      where mine.user_id = auth.uid() and theirs.user_id = profiles.id
    )
  );
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

grant select, insert, update, delete on public.memberships to authenticated;
grant all on public.memberships to service_role;
alter table public.memberships enable row level security;
create policy memberships_select on public.memberships for select to authenticated using (public.can_read_workspace(workspace_id));
create policy memberships_insert on public.memberships for insert to authenticated with check (public.can_admin_workspace(workspace_id));
create policy memberships_update on public.memberships for update to authenticated using (public.can_admin_workspace(workspace_id)) with check (public.can_admin_workspace(workspace_id));
create policy memberships_delete on public.memberships for delete to authenticated using (public.can_admin_workspace(workspace_id));

grant select, insert, update, delete on public.invites to authenticated;
grant all on public.invites to service_role;
alter table public.invites enable row level security;
create policy invites_select on public.invites for select to authenticated
  using (public.can_admin_workspace(workspace_id) or email = (select p.email from public.profiles p where p.id = auth.uid()));
create policy invites_insert on public.invites for insert to authenticated with check (public.can_admin_workspace(workspace_id));
create policy invites_update on public.invites for update to authenticated using (public.can_admin_workspace(workspace_id)) with check (public.can_admin_workspace(workspace_id));
create policy invites_delete on public.invites for delete to authenticated using (public.can_admin_workspace(workspace_id));

-- contacts ------------------------------------------------------------------
create type public.contact_status as enum ('subscribed', 'unsubscribed', 'bounced', 'complained', 'archived');

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  color text not null default 'neutral',
  created_at timestamptz not null default now(),
  unique (workspace_id, name)
);
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
create index contacts_workspace_created_idx on public.contacts (workspace_id, created_at desc);
create index contacts_status_idx on public.contacts (workspace_id, status);
create index contacts_last_activity_idx on public.contacts (workspace_id, last_activity_at desc nulls last);
create index contacts_email_trgm_idx on public.contacts (workspace_id, lower(email) text_pattern_ops);
create table public.contact_tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (contact_id, tag_id)
);
create index contact_tags_tag_idx on public.contact_tags (workspace_id, tag_id);
create table public.custom_field_definitions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,48}$'),
  label text not null,
  field_type text not null default 'text' check (field_type in ('text', 'number', 'date', 'boolean', 'select')),
  options jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (workspace_id, key)
);
create type public.event_type as enum (
  'created', 'updated', 'tag_added', 'tag_removed', 'segment_added', 'segment_removed',
  'queued', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained', 'unsubscribed',
  'purchased', 'workflow_enrolled', 'workflow_completed', 'custom'
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
create index contact_events_workspace_time_idx on public.contact_events (workspace_id, occurred_at desc);
create index contact_events_contact_idx on public.contact_events (contact_id, occurred_at desc);
create index contact_events_type_idx on public.contact_events (workspace_id, event_type, occurred_at desc);
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
create table public.segment_memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  segment_id uuid not null references public.segments (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  added_by text not null default 'manual',
  created_at timestamptz not null default now(),
  unique (segment_id, contact_id)
);
create index segment_memberships_contact_idx on public.segment_memberships (workspace_id, contact_id);

-- email ---------------------------------------------------------------------
create type public.template_category as enum ('newsletter', 'welcome', 'product_update', 'transactional', 'promotion', 'onboarding');
create type public.campaign_status as enum ('draft', 'scheduled', 'sending', 'sent', 'paused', 'cancelled');
create type public.message_status as enum ('queued', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained', 'unsubscribed', 'failed');

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
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index templates_workspace_idx on public.templates (workspace_id, category, updated_at desc);
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
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index campaigns_workspace_idx on public.campaigns (workspace_id, status, created_at desc);
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
create index campaign_recipients_workspace_idx on public.campaign_recipients (workspace_id, campaign_id);
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
create index email_messages_workspace_idx on public.email_messages (workspace_id, created_at desc);
create index email_messages_campaign_idx on public.email_messages (workspace_id, campaign_id, status);
create index email_messages_contact_idx on public.email_messages (contact_id, created_at desc);
create index email_messages_workflow_idx on public.email_messages (workspace_id, workflow_id, created_at desc);

-- automation ----------------------------------------------------------------
create type public.workflow_status as enum ('draft', 'active', 'paused', 'archived');
create type public.run_status as enum ('running', 'waiting', 'completed', 'failed', 'cancelled');
create type public.job_status as enum ('pending', 'processing', 'completed', 'failed', 'cancelled');

create table public.workflows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  description text,
  status public.workflow_status not null default 'draft',
  trigger jsonb not null default '{"type":"contact_created"}'::jsonb,
  definition jsonb not null default '{"nodes":[],"edges":[]}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activated_at timestamptz,
  last_run_at timestamptz,
  runs_count integer not null default 0
);
create index workflows_workspace_idx on public.workflows (workspace_id, status, updated_at desc);
create table public.workflow_enrollments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  workflow_id uuid not null references public.workflows (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  status public.run_status not null default 'waiting',
  current_node_id text,
  next_run_at timestamptz,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create unique index workflow_enrollments_open_idx on public.workflow_enrollments (workflow_id, contact_id) where completed_at is null;
create index workflow_enrollments_due_idx on public.workflow_enrollments (status, next_run_at) where completed_at is null;
create table public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  workflow_id uuid not null references public.workflows (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  enrollment_id uuid references public.workflow_enrollments (id) on delete set null,
  status public.run_status not null default 'running',
  current_node_id text,
  context jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create index workflow_runs_workspace_idx on public.workflow_runs (workspace_id, workflow_id, started_at desc);
create table public.workflow_node_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  workflow_id uuid not null references public.workflows (id) on delete cascade,
  run_id uuid not null references public.workflow_runs (id) on delete cascade,
  node_id text not null,
  node_type text not null,
  status public.run_status not null default 'running',
  result jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create index workflow_node_runs_run_idx on public.workflow_node_runs (run_id, started_at);
create table public.scheduled_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces (id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  run_at timestamptz not null default now(),
  status public.job_status not null default 'pending',
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index scheduled_jobs_due_idx on public.scheduled_jobs (run_at) where status = 'pending';

-- platform ------------------------------------------------------------------
create type public.domain_status as enum ('pending', 'verified', 'failed');

create table public.domains (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  status public.domain_status not null default 'pending',
  dkim_selector text not null default 'lm',
  dkim_public_key text not null default '',
  verification_token text not null default '',
  is_default boolean not null default false,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);
create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  prefix text not null,
  key_hash text not null unique,
  scopes jsonb not null default '["*"]'::jsonb,
  last_used_at timestamptz,
  last_used_ip text,
  revoked_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index api_keys_workspace_idx on public.api_keys (workspace_id, created_at desc);
create table public.webhooks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  url text not null,
  secret text not null,
  events jsonb not null default '["*"]'::jsonb,
  is_active boolean not null default true,
  description text,
  last_status integer,
  last_delivery_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index webhooks_workspace_idx on public.webhooks (workspace_id, created_at desc);
create table public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  webhook_id uuid not null references public.webhooks (id) on delete cascade,
  event text not null,
  payload jsonb not null default '{}'::jsonb,
  status public.job_status not null default 'pending',
  attempts integer not null default 0,
  response_code integer,
  response_body text,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index webhook_deliveries_webhook_idx on public.webhook_deliveries (webhook_id, created_at desc);

-- grants + RLS for tenant tables -------------------------------------------
do $$
declare
  t text;
  w text;
begin
  foreach t in array array[
    'tags', 'contacts', 'contact_tags', 'custom_field_definitions', 'contact_events', 'segments', 'segment_memberships',
    'templates', 'campaigns', 'campaign_recipients', 'email_messages',
    'workflows', 'workflow_enrollments', 'workflow_runs', 'workflow_node_runs', 'scheduled_jobs',
    'domains', 'api_keys', 'webhooks', 'webhook_deliveries'
  ] loop
    w := case when t in ('domains', 'api_keys', 'webhooks', 'webhook_deliveries') then 'can_admin_workspace' else 'can_write_workspace' end;
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.can_read_workspace(workspace_id))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.%I(workspace_id))', t || '_insert', t, w);
    execute format('create policy %I on public.%I for update to authenticated using (public.%I(workspace_id)) with check (public.%I(workspace_id))', t || '_update', t, w, w);
    execute format('create policy %I on public.%I for delete to authenticated using (public.%I(workspace_id))', t || '_delete', t, w);
  end loop;
end $$;