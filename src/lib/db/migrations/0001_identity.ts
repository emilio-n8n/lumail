/**
 * 0001_identity
 *
 * Raw SQL migration. Applied verbatim inside a single transaction by
 * `src/lib/db/migrate.ts`. Never edit an applied migration — append a new file.
 *
 * Ordering matters: tables are created first, then the authorisation helper
 * functions (Postgres validates SQL function bodies at creation time), and only
 * then grants and row level security policies.
 */
export default `-- ============================================================================
-- 0001 — Identity, tenancy and authorisation primitives
-- ============================================================================

-- Roles used by the data layer. All NOLOGIN: the application connects once and
-- assumes a role per request so that PostgreSQL itself enforces tenant isolation.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

grant usage on schema public to anon, authenticated, service_role;

-- Authorisation state lives in a dedicated table (public.memberships), never on
-- the profile row.
create type public.app_role as enum ('owner', 'admin', 'member');

create type public.invite_status as enum ('pending', 'accepted', 'revoked', 'expired');

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

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

create table public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  full_name text,
  avatar_color text not null default 'citron',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  role public.app_role not null default 'member',
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  user_agent text,
  ip text
);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null,
  role public.app_role not null default 'member',
  token_hash text not null unique,
  status public.invite_status not null default 'pending',
  invited_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz
);

create index memberships_user_idx on public.memberships (user_id);
create index sessions_user_idx on public.sessions (user_id);
create index invites_workspace_idx on public.invites (workspace_id, status);

-- ----------------------------------------------------------------------------
-- Session claims + authorisation helpers
--
-- The server layer issues these per request/transaction so policies can resolve
-- the caller without ever trusting the client. All helpers are SECURITY DEFINER
-- and owned by the database superuser so that membership lookups never recurse
-- back into the memberships policies.
-- ----------------------------------------------------------------------------
create or replace function public.current_user_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid;
$$;

create or replace function public.current_workspace_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.workspace_id', true), '')::uuid;
$$;

create or replace function public.current_workspace_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.workspace_id = public.current_workspace_id()
      and m.user_id = public.current_user_id()
  );
$$;

create or replace function public.has_workspace_role(_workspace_id uuid, _roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.workspace_id = _workspace_id
      and m.user_id = public.current_user_id()
      and m.role = any (_roles)
  );
$$;

create or replace function public.can_read_workspace(_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_workspace_id() is not distinct from _workspace_id
    and public.current_workspace_access();
$$;

create or replace function public.can_write_workspace(_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_workspace_role(
    _workspace_id,
    array['owner', 'admin', 'member']::public.app_role[]
  );
$$;

create or replace function public.can_admin_workspace(_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_workspace_role(
    _workspace_id,
    array['owner', 'admin']::public.app_role[]
  );
$$;

-- ----------------------------------------------------------------------------
-- Grants + row level security
-- ----------------------------------------------------------------------------

-- workspaces --------------------------------------------------------------
grant select, insert, update, delete on public.workspaces to authenticated;
grant all on public.workspaces to service_role;

alter table public.workspaces enable row level security;

create policy workspaces_select on public.workspaces
  for select to authenticated
  using (public.has_workspace_role(id, array['owner', 'admin', 'member']::public.app_role[]));

create policy workspaces_insert on public.workspaces
  for insert to authenticated
  with check (true);

create policy workspaces_update on public.workspaces
  for update to authenticated
  using (public.can_admin_workspace(id))
  with check (public.can_admin_workspace(id));

create policy workspaces_delete on public.workspaces
  for delete to authenticated
  using (public.has_workspace_role(id, array['owner']::public.app_role[]));

-- users -------------------------------------------------------------------
grant select, insert, update, delete on public.users to authenticated;
grant all on public.users to service_role;

alter table public.users enable row level security;

create policy users_select_self on public.users
  for select to authenticated
  using (id = public.current_user_id());

create policy users_update_self on public.users
  for update to authenticated
  using (id = public.current_user_id())
  with check (id = public.current_user_id());

-- memberships -------------------------------------------------------------
grant select, insert, update, delete on public.memberships to authenticated;
grant all on public.memberships to service_role;

alter table public.memberships enable row level security;

create policy memberships_select on public.memberships
  for select to authenticated
  using (public.can_read_workspace(workspace_id));

create policy memberships_insert on public.memberships
  for insert to authenticated
  with check (public.can_admin_workspace(workspace_id));

create policy memberships_update on public.memberships
  for update to authenticated
  using (public.can_admin_workspace(workspace_id))
  with check (public.can_admin_workspace(workspace_id));

create policy memberships_delete on public.memberships
  for delete to authenticated
  using (public.can_admin_workspace(workspace_id));

-- sessions ----------------------------------------------------------------
grant select, insert, update, delete on public.sessions to authenticated;
grant all on public.sessions to service_role;

alter table public.sessions enable row level security;

create policy sessions_select_self on public.sessions
  for select to authenticated
  using (user_id = public.current_user_id());

create policy sessions_insert_self on public.sessions
  for insert to authenticated
  with check (user_id = public.current_user_id());

create policy sessions_update_self on public.sessions
  for update to authenticated
  using (user_id = public.current_user_id())
  with check (user_id = public.current_user_id());

create policy sessions_delete_self on public.sessions
  for delete to authenticated
  using (user_id = public.current_user_id());

-- invites -----------------------------------------------------------------
grant select, insert, update, delete on public.invites to authenticated;
grant all on public.invites to service_role;

alter table public.invites enable row level security;

create policy invites_select on public.invites
  for select to authenticated
  using (
    public.can_admin_workspace(workspace_id)
    or email = (select u.email from public.users u where u.id = public.current_user_id())
  );

create policy invites_insert on public.invites
  for insert to authenticated
  with check (public.can_admin_workspace(workspace_id));

create policy invites_update on public.invites
  for update to authenticated
  using (public.can_admin_workspace(workspace_id))
  with check (public.can_admin_workspace(workspace_id));

create policy invites_delete on public.invites
  for delete to authenticated
  using (public.can_admin_workspace(workspace_id));
`