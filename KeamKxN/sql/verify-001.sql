BEGIN TRANSACTION READ ONLY;

-- Expect RLS on and no effective INSERT, DELETE or TRUNCATE for either client role.
-- Only authenticated on players should have any UPDATE grant, limited to default_rating.
SELECT r.client, t.name AS table_name, c.relrowsecurity AS rls_enabled,
  has_any_column_privilege(r.client, c.oid, 'INSERT') AS can_insert,
  has_any_column_privilege(r.client, c.oid, 'UPDATE') AS can_update,
  has_table_privilege(r.client, c.oid, 'DELETE') AS can_delete,
  has_table_privilege(r.client, c.oid, 'TRUNCATE') AS can_truncate,
  ARRAY(
    SELECT a.attname FROM pg_catalog.pg_attribute AS a
    WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      AND has_column_privilege(r.client, c.oid, a.attnum, 'UPDATE')
    ORDER BY a.attnum
  ) AS writable_columns
FROM unnest(ARRAY['anon', 'authenticated']) AS r(client)
CROSS JOIN unnest(ARRAY[
  'public.admin_users', 'public.players', 'public.games',
  'public.game_players', 'public.game_bans'
]) AS t(name)
JOIN pg_catalog.pg_class AS c ON c.oid = to_regclass(t.name)
ORDER BY t.name, r.client;

-- Expect all three functions to have an explicitly empty search_path,
-- with EXECUTE available to authenticated and denied to anon.
SELECT p.oid::regprocedure AS signature, p.prosecdef, p.proconfig,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute
FROM pg_catalog.pg_proc AS p
WHERE p.oid IN (
  to_regprocedure('public.is_admin()'),
  to_regprocedure('public.save_completed_game(jsonb,jsonb,jsonb)'),
  to_regprocedure('public.update_match_roles(uuid,integer,jsonb)')
)
ORDER BY p.oid::regprocedure::text;

-- Expect role nullable, revision integer NOT NULL with default 0,
-- and the existing player, team-role and rating constraints retained.
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND (table_name, column_name) IN
  (('game_players', 'role'), ('games', 'role_revision'), ('players', 'default_rating'));

SELECT conrelid::regclass AS table_name, conname, pg_get_constraintdef(oid) AS definition
FROM pg_catalog.pg_constraint
WHERE conname IN ('game_players_game_id_player_id_key', 'game_players_game_id_team_role_key',
                  'game_players_role_check', 'players_default_rating_range')
  AND conrelid IN ('public.game_players'::regclass, 'public.players'::regclass)
ORDER BY conname;

ROLLBACK;
