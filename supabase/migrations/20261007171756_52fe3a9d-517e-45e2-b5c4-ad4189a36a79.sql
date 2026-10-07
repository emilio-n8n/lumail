CREATE OR REPLACE FUNCTION public.lumail_exec(p_role text, p_claims jsonb, p_sql text, p_returns boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  out_rows jsonb := '[]'::jsonb;
  n bigint := 0;
  body text := regexp_replace(p_sql, ';\s*$', '');
begin
  perform set_config('request.jwt.claims', coalesce(p_claims, '{}'::jsonb)::text, true);
  perform set_config('app.user_id', coalesce(p_claims ->> 'sub', ''), true);
  perform set_config('app.workspace_id', coalesce(p_claims -> 'app_metadata' ->> 'workspace_id', ''), true);
  if p_role = 'authenticated' then
    set local role authenticated;
  end if;

  if p_returns then
    -- A CTE wrapper accepts both plain reads and INSERT/UPDATE/DELETE ... RETURNING.
    execute 'with q as (' || body || ') select coalesce(jsonb_agg(to_jsonb(q)), ''[]''::jsonb), count(*) from q'
      into out_rows, n;
  else
    execute body;
    get diagnostics n = row_count;
  end if;

  return jsonb_build_object('rows', out_rows, 'count', n);
end;
$function$;
revoke execute on function public.lumail_exec(text, jsonb, text, boolean) from public, anon, authenticated;