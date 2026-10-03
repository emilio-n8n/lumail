grant authenticated to service_role;

create or replace function public.lumail_exec(
  p_role text,
  p_claims jsonb,
  p_sql text,
  p_returns boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  r record;
  out_rows jsonb := '[]'::jsonb;
  n bigint := 0;
begin
  perform set_config('request.jwt.claims', coalesce(p_claims, '{}'::jsonb)::text, true);
  perform set_config('app.user_id', coalesce(p_claims ->> 'sub', ''), true);
  perform set_config('app.workspace_id', coalesce(p_claims -> 'app_metadata' ->> 'workspace_id', ''), true);
  if p_role = 'authenticated' then
    set local role authenticated;
  end if;

  if p_returns then
    for r in execute p_sql loop
      out_rows := out_rows || jsonb_build_array(to_jsonb(r));
      n := n + 1;
    end loop;
  else
    execute p_sql;
    get diagnostics n = row_count;
  end if;

  return jsonb_build_object('rows', out_rows, 'count', n);
end;
$$;

revoke all on function public.lumail_exec(text, jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.lumail_exec(text, jsonb, text, boolean) to service_role;