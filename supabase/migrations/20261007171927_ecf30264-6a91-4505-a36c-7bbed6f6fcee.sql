CREATE OR REPLACE FUNCTION public.lumail_exec(p_role text, p_claims jsonb, p_sql text, p_returns boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
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
    -- The caller wraps row-returning statements so they yield (rows jsonb, n bigint).
    execute p_sql into out_rows, n;
  else
    execute p_sql;
    get diagnostics n = row_count;
  end if;

  return jsonb_build_object('rows', coalesce(out_rows, '[]'::jsonb), 'count', coalesce(n, 0));
end;
$function$;
revoke execute on function public.lumail_exec(text, jsonb, text, boolean) from public, anon, authenticated;