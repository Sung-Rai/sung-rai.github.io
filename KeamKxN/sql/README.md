# Transactional match saving and optional roles

## Database baseline

The deployed match tables use RLS. The `anon` role has no direct access to them.
The `authenticated` role has administrator-gated reads and inserts on all four
match tables, plus an administrator-gated update policy on `players`. The
five audited tables, including `admin_users`, have an unnecessary authenticated
`TRUNCATE` grant. The Data API exposes the `public` and `graphql_public` schemas.

`public.is_admin()` is a `postgres`-owned security-definer function. It checks
`public.admin_users.user_id` against `auth.uid()` using schema-qualified
references. The membership table has RLS, no policies, and no direct read or
row-write grants for either client role. Only authenticated clients can call
`is_admin()`.

[schema.sql](schema.sql) is a **disposable pre-migration fixture** based on
that audit. It models the relevant schema and permission behavior. It uses a
synthetic default rating of 50 and a simple membership-table primary key for
testing. The audit did not establish the production default expression or all
membership-table constraints. Apply only the versioned migration to an existing
database. A production database should never be bootstrapped from this fixture.

## Migration 001

[001_transactional_match_saving.sql](migrations/001_transactional_match_saving.sql)
changes the existing database in one transaction:

- Makes the participant role nullable while retaining its allowed values and
  per-team uniqueness. Adds a role revision to games, initially 0.
- Preserves the administrator function body and sets an empty `search_path`.
- Revokes direct client writes on the five audited tables, including
  `TRUNCATE`, and removes the superseded insert policies. Authenticated clients
  retain column-level update permission on `players.default_rating`, subject
  to the existing administrator RLS policy and the 0–100 constraint. Unexpected
  inherited or column-level write grants abort the migration.
- Adds administrator-checked functions to save a complete game and replace a
  game's roles. The save preserves legacy stable-key resolution and creates
  missing players without changing existing names or ratings. Role replacement
  locks the game and checks the revision before clearing or swapping roles.
- Retains existing player and game IDs, data, constraints, and rating defaults.

## Automated test from the repository root

Use Node.js 24 or later. The test uses a disposable in-memory PostgreSQL database
through PGlite, synthetic auth identities and jsdom. It uses no Supabase project
connection and never reads the production client configuration.

```powershell
$env:KEAMKXN_TEST_DEPS = Join-Path $env:TEMP 'keamkxn-1c1-test'
npm.cmd install --prefix $env:KEAMKXN_TEST_DEPS --no-audit --no-fund @electric-sql/pglite@0.6.0 jsdom@29
node KeamKxN/sql/test-transactional-match-saving.mjs
```

## Test the website against local Supabase on Windows

1. Install Docker Desktop and the Supabase CLI, then start Docker. From the
   repository root, make a fresh temporary copy of the website and start an
   isolated Supabase stack. Use its loopback API and Studio URLs printed by the
   CLI. Keep this project unlinked to any hosted project.

   ```powershell
   $sandbox = Join-Path $env:TEMP ("keamkxn-local-" + [guid]::NewGuid())
   New-Item -ItemType Directory -Path $sandbox
   Copy-Item -LiteralPath .\KeamKxN -Destination $sandbox -Recurse
   Set-Location $sandbox
   supabase init
   supabase start
   ```

2. Open the **local** Studio URL. Use **SQL Editor → New query** to run
   `KeamKxN/sql/schema.sql` and then `KeamKxN/sql/migrations/001_transactional_match_saving.sql`
   in separate tabs. Run `KeamKxN/sql/verify-001.sql` and check its expected results.
3. Under **Authentication → Users**, add a confirmed synthetic user such as
   `admin@example.test`, with a password used only for the local test. Copy
   its UUID. In **local** SQL Editor, use the following to make that user an
   admin and create ten synthetic players for Manual Entry.

   ```sql
   INSERT INTO public.admin_users (user_id)
   VALUES ('REPLACE_WITH_LOCAL_USER_UUID'::uuid);

   INSERT INTO public.players (stable_key, display_name)
   SELECT 'local-player-' || n, 'Local Player ' || n
   FROM generate_series(1, 10) AS players(n);
   ```

4. Edit **only the temporary copy** of `KeamKxN/js/supabaseClient.js`.
   Replace `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` with the local
   Supabase API URL and its publishable or anon key from `supabase status`.
   In the temporary `KeamKxN/js/auth.js`, map `admin` to the synthetic email.
   Confirm the API URL is loopback, then serve the temporary copy.

   ```powershell
   py -m http.server 8000 --bind 127.0.0.1
   ```

5. Open `http://127.0.0.1:8000/KeamKxN/`. Sign in as `admin`, then use
   **Add Game** to select ten different players and unique champions. Use
   **Unassigned** in one or more role selectors. Save and open **Stats**.
   Confirm all ten participants appear and the general appearance and champion
   counts include unassigned players.
6. Open **Edit roles** in that match's header. Assign, clear and swap roles in the dialog. To test a
   stale edit, open the editor for the same match in two tabs before saving
   in either. Save in the first tab, then submit from the second. Refresh the
   second tab after the stale-edit error. Try two players with the same role on
   one team and check that the entire edit is rejected.
7. Generate teams and submit a result with the prefilled roles. Verify an
   intended rating edit still saves. In **Import**, submit synthetic games
   first as an array and then as an object containing a `games` array. For a
   partial-batch check, make the second match invalid and verify the reported
   saved count before retrying only the failed portion.

   In another PowerShell window, use this synthetic payload. Copy the first
   output to **Import** and then repeat with the second output.

   ```powershell
   $champions = 'Ahri','Ashe','Bard','Braum','Diana','Garen','Jinx','Lux','Nami','Vex'
   $sample = @{
     title = 'Local JSON test'
     winningTeam = 'A'
     players = @(1..10 | ForEach-Object {
       @{
         name = "Local Player $_"
         stableKey = "local-player-$_"
         team = if ($_ -le 5) { 'A' } else { 'B' }
         champion = $champions[$_ - 1]
       }
     })
   }
   ConvertTo-Json -InputObject @($sample) -Depth 6
   ConvertTo-Json -InputObject @{ games = @($sample) } -Depth 6
   ```

8. Stop the HTTP server with **Ctrl+C**. From the temporary project directory,
   run `supabase stop` to stop the local stack.

## Deployment and recovery

Production rollout requires a separate approval. Rehearse it on a disposable
Supabase stack first, including the API's function exposure and administrator
access. Capture a backup or verified restore point and schedule a short window
without match writes. Apply migration 001 once. Run the read-only
[verify-001.sql](verify-001.sql), verify the two RPC functions are exposed to
the Data API, then publish the matching website revision. The old frontend
uses direct inserts, so its save actions fail closed between these steps.
Refresh cached tabs and confirm the updated frontend loads before resuming saves.

If migration 001 errors before commit, PostgreSQL rolls back the DDL and grants.
If the migration succeeds but the frontend has a problem, pause match and role
writes and fix forward while retaining the secured grants. In an approved
incident response, an owner can temporarily revoke authenticated execution of
the two new write functions while leaving reads and the rating grant available.
Keep the nullable role column and revision while resolving frontend issues.
Restoring the old site alone does not restore its match-save capability. Once
matches contain null roles, reinstating the old `NOT NULL` rule would require
explicit data reconciliation. Preserve the backup and existing assignments,
and review any restore or reverse migration separately.
