alter function public.current_user_id() set search_path = public;
do $$
declare f text;
begin
  foreach f in array array[
    'public.current_workspace_id()', 'public.current_workspace_access()',
    'public.has_workspace_role(uuid, public.app_role[])', 'public.can_read_workspace(uuid)',
    'public.can_write_workspace(uuid)', 'public.can_admin_workspace(uuid)', 'public.handle_new_user()'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
  end loop;
end $$;
revoke execute on function public.handle_new_user() from authenticated;