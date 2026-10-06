create extension if not exists pg_cron;
create extension if not exists pg_net;
create table public.app_private_settings (
  key text primary key,
  value text not null,
  created_at timestamptz not null default now()
);
grant all on public.app_private_settings to service_role;
alter table public.app_private_settings enable row level security;
insert into public.app_private_settings (key, value)
values ('job_secret', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;