-- ============================================================================
-- 0001 — Identity, tenancy and authorisation primitives
--
-- Identity is owned by Supabase Auth. There is no `public.users` and no
-- `public.sessions` here: `auth.users` is the identity, and sessions live in
-- Supabase Auth's own store. What this project owns is the *authorisation*
-- state — which workspaces a person belongs to, and with what role — and that
-- lives in a dedicated table (`public.memberships`), never on the profile row.
--
-- The `anon`, `authenticated` and `service_role` roles already exist in a
-- Supabase project, so they are used rather than created.
--
-- Apply with the Supabase CLI (`supabase db push`) or by pasting into the
-- dashboard SQL editor. Never edit an applied migration; append a new file.
-- ============================================================================

-- No `create extension` needed: `gen_random_uuid()` is core from Postgres 13.
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

-- Display data only. It carries no authorisation meaning: `avatar_color` and
-- `full_name` are cosmetic, roles are not stored here.
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

-- ----------------------------------------------------------------------------
-- Authorisation helpers
--
-- Every helper is SECURITY DEFINER with a pinned search_path, so membership
-- lookups never recurse back into the memberships policies. `auth.uid()` and
-- `auth.jwt()` are supplied by Supabase Auth, so the caller is identified by a
-- signed JWT rather than by anything the client can set.
-- ----------------------------------------------------------------------------

-- The workspace the caller is currently acting in. Supabase Auth puts
-- app_metadata under our control (only the service role can write it), which is
-- where a workspace switch is recorded. Falling back to the caller's first
-- membership keeps a request working when the claim is absent.
create or replace function public.current_user_id()
returns uuid
language sql
stable
as $$
  select auth.uid();
$$;

create or replace function public.current_workspace_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(auth.jwt() -> 'app_metadata' ->> 'workspace_id', '')::uuid,
    (
      select m.workspace_id
      from public.memberships m
      where m.user_id = auth.uid()
      order by m.created_at asc
      limit 1
    )
  );
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
      and m.user_id = auth.uid()
  );
$$;

-- The role check every privileged operation goes through.
create or replace function public.has_workspace_role(
  _workspace_id uuid,
  _roles public.app_role[]
)
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
      and m.user_id = auth.uid()
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

-- Keeps a profile in step with the Supabase Auth record it mirrors.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- Grants + row level security
--
-- Per table, in this order: grants, then RLS, then policies. RLS does not
-- replace grants.
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

-- profiles ----------------------------------------------------------------
grant select, insert, update, delete on public.profiles to authenticated;
grant all on public.profiles to service_role;

alter table public.profiles enable row level security;

-- A profile is readable by anyone who shares a workspace with its owner.
create policy profiles_select_shared on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1
      from public.memberships mine
      join public.memberships theirs on theirs.workspace_id = mine.workspace_id
      where mine.user_id = auth.uid() and theirs.user_id = profiles.id
    )
  );

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- There is no insert policy: profiles are created by the auth trigger, and
-- only the service role may insert directly.

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

-- invites -----------------------------------------------------------------
grant select, insert, update, delete on public.invites to authenticated;
grant all on public.invites to service_role;

alter table public.invites enable row level security;

create policy invites_select on public.invites
  for select to authenticated
  using (
    public.can_admin_workspace(workspace_id)
    or email = (select p.email from public.profiles p where p.id = auth.uid())
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