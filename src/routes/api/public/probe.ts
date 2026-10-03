import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/public/probe')({
  server: {
    handlers: {
      GET: async () => {
        const names = Object.keys(process.env).filter((k) => /SUPA|DATABASE|PG/.test(k))
        let db: unknown = null
        const url = process.env['SUPABASE_DB_URL']
        if (url) {
          try {
            const postgres = (await import('postgres')).default
            const sql = postgres(url, { max: 1, prepare: false })
            db = await sql`select current_user, (select rolbypassrls from pg_roles where rolname = current_user) as bypass, pg_has_role(current_user, 'authenticated', 'member') as can_auth`
            await sql.end()
          } catch (e) {
            db = String(e)
          }
        }
        return Response.json({ names, db })
      },
    },
  },
})
