create or replace function public.wake_job_runner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://project--acb833d5-fbcf-4f6f-aa44-688d9e5e9e11.lovable.app/api/public/jobs/tick',
    headers := jsonb_build_object('Content-Type','application/json','x-lumail-secret',(select value from public.app_private_settings where key='job_secret')),
    body := '{}'::jsonb);
  return null;
end $$;
revoke execute on function public.wake_job_runner() from public, anon, authenticated;
create trigger scheduled_jobs_wake after insert on public.scheduled_jobs
for each statement execute function public.wake_job_runner();