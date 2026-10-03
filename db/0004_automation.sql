-- ============================================================================
-- Automations: enrollments, runs, node runs and the job queue.
--
-- Converted from the PGlite migration of the same name. Identity now comes from
-- Supabase Auth, so every `references public.users` points at `auth.users`, and
-- `public.current_user_id()` resolves through `auth.uid()`.
--
-- Apply with the Supabase CLI (`supabase db push`) or the dashboard SQL editor.
-- Never edit an applied migration; append a new file.
-- ============================================================================
-- ============================================================================
-- 0004 — Automation: workflow definitions (DAG), runs, and the job queue
-- ============================================================================

create type public.workflow_status as enum ('draft', 'active', 'paused', 'archived');

create type public.run_status as enum ('running', 'waiting', 'completed', 'failed', 'cancelled');

create type public.job_status as enum ('pending', 'processing', 'completed', 'failed', 'cancelled');

-- ----------------------------------------------------------------------------
-- workflows — \`definition\` stores the DAG:
--   { "nodes": [{ id, type, config, position }], "edges": [{ id, source, target }] }
-- ----------------------------------------------------------------------------
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

create index workflows_workspace_idx
  on public.workflows (workspace_id, status, updated_at desc);

-- ----------------------------------------------------------------------------
-- workflow_enrollments — one open enrollment per (workflow, contact)
-- ----------------------------------------------------------------------------
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

create unique index workflow_enrollments_open_idx
  on public.workflow_enrollments (workflow_id, contact_id)
  where completed_at is null;
create index workflow_enrollments_due_idx
  on public.workflow_enrollments (status, next_run_at)
  where completed_at is null;

-- ----------------------------------------------------------------------------
-- workflow_runs — one execution of the DAG for one contact
-- ----------------------------------------------------------------------------
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

create index workflow_runs_workspace_idx
  on public.workflow_runs (workspace_id, workflow_id, started_at desc);

-- ----------------------------------------------------------------------------
-- workflow_node_runs — audit trail per node execution
-- ----------------------------------------------------------------------------
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

create index workflow_node_runs_run_idx
  on public.workflow_node_runs (run_id, started_at);

-- ----------------------------------------------------------------------------
-- scheduled_jobs — the asynchronous queue backing campaign sends, workflow
-- delays, retries and webhook delivery.
-- ----------------------------------------------------------------------------
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

create index scheduled_jobs_due_idx
  on public.scheduled_jobs (run_at)
  where status = 'pending';

do $$
declare
  tenant_table text;
begin
  foreach tenant_table in array (
    array[
      'workflows',
      'workflow_enrollments',
      'workflow_runs',
      'workflow_node_runs',
      'scheduled_jobs'
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
end $$;