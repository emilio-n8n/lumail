<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Lumail architecture rules
- All SQL goes through the `lumail_exec` RPC (service role only) via `src/integrations/database/driver.ts`; direct TCP to the database is unavailable on the hosted runtime.
- Row-returning statements are wrapped client-side into a JSON-aggregating CTE before `lumail_exec`; data-modifying CTEs must stay at top level.
- Identity lives in Lovable Cloud auth (`auth.users` + `public.profiles`); `public.memberships` is the only authorization table.
- Server-function modules live in `src/rpc/`, never `src/server/` (the build forbids client imports from any `server/` folder).
- Background jobs run via `/api/public/jobs/tick`, woken by a statement trigger on `scheduled_jobs` plus an hourly cron backstop and the open dashboard; there is no in-process timer on serverless.
- The tick secret lives in `public.app_private_settings` (service role only) so the database scheduler and server share it without exposing it.
- The assistant uses the Lovable AI Gateway (Responses API) and falls back to the deterministic router when no key is present.
