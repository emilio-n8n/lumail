-- ============================================================================
-- Platform: API keys, sending domains and webhook endpoints.
--
-- Converted from the PGlite migration of the same name. Identity now comes from
-- Supabase Auth, so every `references public.users` points at `auth.users`, and
-- `public.current_user_id()` resolves through `auth.uid()`.
--
-- Apply with the Supabase CLI (`supabase db push`) or the dashboard SQL editor.
-- Never edit an applied migration; append a new file.
-- ============================================================================
-- ============================================================================
-- 0005 — Platform: sending domains, API keys, outbound webhooks
-- ============================================================================

create type public.domain_status as enum ('pending', 'verified', 'failed');

-- ----------------------------------------------------------------------------
-- domains — SPF / DKIM / DMARC verification records
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- api_keys — only a SHA-256 hash is stored; the plaintext is shown once.
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- webhooks — signed outbound event delivery
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- webhook_deliveries — per-attempt log
-- ----------------------------------------------------------------------------
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

create index webhook_deliveries_webhook_idx
  on public.webhook_deliveries (webhook_id, created_at desc);

-- ----------------------------------------------------------------------------
-- Grants + RLS. Platform resources are workspace-admin managed: members may
-- read them, only owner/admin may mutate them.
-- ----------------------------------------------------------------------------
do $$
declare
  admin_table text;
  read_tables text[] := array[
    'domains',
    'api_keys',
    'webhooks',
    'webhook_deliveries'
  ];
begin
  foreach admin_table in array read_tables loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', admin_table);
    execute format('grant all on public.%I to service_role', admin_table);
    execute format('alter table public.%I enable row level security', admin_table);

    execute format(
      'create policy %I on public.%I for select to authenticated using (public.can_read_workspace(workspace_id))',
      admin_table || '_select', admin_table
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.can_admin_workspace(workspace_id))',
      admin_table || '_insert', admin_table
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.can_admin_workspace(workspace_id)) with check (public.can_admin_workspace(workspace_id))',
      admin_table || '_update', admin_table
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.can_admin_workspace(workspace_id))',
      admin_table || '_delete', admin_table
    );
  end loop;
end $$;