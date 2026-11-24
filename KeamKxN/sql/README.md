# Read-only Supabase permissions audit

The checked-in schema describes an earlier setup. It grants public writes, and it lacks the `is_admin` function called by the website. The deployed database is authoritative. Run the following in the project's Supabase **SQL Editor** with your existing dashboard access. The transaction is read-only and the queries inspect metadata. They do not read player or match rows.

```sql
begin read only;

select n.nspname as schema_name, c.relname as table_name,
       c.relrowsecurity as rls_enabled, c.relforcerowsecurity as force_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('players', 'games', 'game_players', 'game_bans');

select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('players', 'games', 'game_players', 'game_bans')
order by tablename, cmd, policyname;

select r.role_name, t.table_name,
       has_table_privilege(r.role_name, 'public.' || t.table_name, 'SELECT') as can_select,
       has_any_column_privilege(r.role_name, 'public.' || t.table_name, 'INSERT') as can_insert,
       has_any_column_privilege(r.role_name, 'public.' || t.table_name, 'UPDATE') as can_update,
       has_table_privilege(r.role_name, 'public.' || t.table_name, 'DELETE') as can_delete
from (values ('anon'), ('authenticated')) as r(role_name)
cross join (values ('players'), ('games'), ('game_players'), ('game_bans')) as t(table_name);

select n.nspname as schema_name, p.oid::regprocedure as signature,
       p.prosecdef as security_definer, p.proconfig as settings,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f'
order by signature;

select pg_get_functiondef(p.oid)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'is_admin' and p.prokind = 'f';

rollback;
```

- For each match table, check whether both an effective insert grant and an applicable permissive `INSERT` or `ALL` policy allow writes by `anon`, ordinary `authenticated` users, or `PUBLIC`. Also inspect restrictive policies. With RLS disabled, table and column grants control access directly.
- Check whether `is_admin` derives approval from the signed-in user's verified identity and a server-controlled source. Inspect any callable write functions, especially `SECURITY DEFINER` functions, for paths around table policies.
- The SQL Editor's owner session can bypass RLS. Confirm behavior in a disposable environment with anonymous, ordinary authenticated, and admin sessions before enabling any new write path.

Review the function bodies privately. If sharing audit results, summarize which roles can write and redact account identifiers, embedded values, keys and connection strings. The preview feature needs no database migration or policy change.
