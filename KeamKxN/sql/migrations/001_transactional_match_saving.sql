BEGIN;

-- Preserve the audited function body and membership mechanism.
ALTER FUNCTION public.is_admin() SET search_path = '';

ALTER TABLE public.game_players ALTER COLUMN role DROP NOT NULL;
ALTER TABLE public.games ADD COLUMN role_revision integer NOT NULL DEFAULT 0;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON
  public.admin_users, public.players, public.games, public.game_players, public.game_bans
FROM PUBLIC, anon, authenticated;

DROP POLICY "admin players insert" ON public.players;
DROP POLICY "admin games insert" ON public.games;
DROP POLICY "admin game_players insert" ON public.game_players;
DROP POLICY "admin game_bans insert" ON public.game_bans;

-- Existing admin-only UPDATE policy still applies to rating edits.
GRANT UPDATE (default_rating) ON public.players TO authenticated;

CREATE FUNCTION public.save_completed_game(
  game jsonb, roster jsonb, bans jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  saved_id uuid;
BEGIN
  IF public.is_admin() IS NOT TRUE THEN
    RAISE EXCEPTION 'Administrator access required.' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(game) IS DISTINCT FROM 'object'
     OR jsonb_typeof(roster) IS DISTINCT FROM 'array'
     OR jsonb_typeof(bans) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid match payload.' USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(roster) <> 10 OR (
    SELECT count(*) FROM jsonb_to_recordset(roster) AS p(team text) WHERE p.team = 'A'
  ) <> 5 OR (
    SELECT count(*) FROM jsonb_to_recordset(roster) AS p(team text) WHERE p.team = 'B'
  ) <> 5 THEN
    RAISE EXCEPTION 'A match requires five players on each team.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(roster) AS p(
      player_id uuid, stable_key text, display_name text, champion text
    )
    WHERE nullif(btrim(p.champion), '') IS NULL
      OR (p.player_id IS NULL AND (
        p.stable_key IS NULL OR p.stable_key !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
        OR nullif(btrim(p.display_name), '') IS NULL
      ))
  ) OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset(bans) AS b(champion text)
    WHERE nullif(btrim(b.champion), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Each player needs a valid identity and each pick or ban needs a champion.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.players (stable_key, display_name)
  SELECT p.stable_key, btrim(p.display_name)
  FROM jsonb_to_recordset(roster) AS p(player_id uuid, stable_key text, display_name text)
  WHERE p.player_id IS NULL
  ORDER BY p.stable_key
  ON CONFLICT (stable_key) DO NOTHING;

  INSERT INTO public.games (played_at, title, winning_team, notes, source)
  VALUES (
    coalesce((game->>'played_at')::date, current_date), game->>'title',
    game->>'winning_team', game->>'notes', coalesce(game->>'source', 'manual')
  )
  RETURNING id INTO saved_id;

  INSERT INTO public.game_players (
    game_id, player_id, team, role, champion, kills, deaths, assists
  )
  SELECT saved_id, coalesce(p.player_id, existing.id), p.team, p.role,
    p.champion, p.kills, p.deaths, p.assists
  FROM jsonb_to_recordset(roster) AS p(
    player_id uuid, stable_key text, team text, role text,
    champion text, kills integer, deaths integer, assists integer
  )
  LEFT JOIN public.players AS existing
    ON p.player_id IS NULL AND existing.stable_key = p.stable_key;

  INSERT INTO public.game_bans (game_id, team, champion, ban_order)
  SELECT saved_id, b.team, b.champion, b.ban_order
  FROM jsonb_to_recordset(bans) AS b(team text, champion text, ban_order integer);

  RETURN saved_id;
END;
$$;

CREATE FUNCTION public.update_match_roles(
  match_id uuid, expected_revision integer, assignments jsonb
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  current_revision integer;
BEGIN
  IF public.is_admin() IS NOT TRUE THEN
    RAISE EXCEPTION 'Administrator access required.' USING ERRCODE = '42501';
  END IF;

  SELECT g.role_revision INTO current_revision
  FROM public.games AS g WHERE g.id = match_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match no longer exists.' USING ERRCODE = '22023';
  END IF;
  IF expected_revision IS DISTINCT FROM current_revision THEN
    RAISE EXCEPTION 'Roles changed since you opened this match. Refresh stats and try again.'
      USING ERRCODE = '40001';
  END IF;

  IF jsonb_typeof(assignments) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid role assignments.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(assignments) <> (
    SELECT count(*) FROM public.game_players AS p WHERE p.game_id = match_id
  ) OR jsonb_array_length(assignments) <> (
    SELECT count(DISTINCT a.id)
    FROM jsonb_to_recordset(assignments) AS a(id uuid, role text)
    JOIN public.game_players AS p ON p.id = a.id AND p.game_id = match_id
  ) THEN
    RAISE EXCEPTION 'Supply exactly one role assignment for each participant in this match.'
      USING ERRCODE = '22023';
  END IF;

  -- Clear before applying the final assignments so a swap satisfies uniqueness.
  UPDATE public.game_players SET role = NULL WHERE game_id = match_id AND role IS NOT NULL;
  UPDATE public.game_players AS p SET role = a.role
  FROM jsonb_to_recordset(assignments) AS a(id uuid, role text)
  WHERE p.game_id = match_id AND p.id = a.id AND a.role IS NOT NULL;

  UPDATE public.games SET role_revision = current_revision + 1 WHERE id = match_id;
  RETURN current_revision + 1;
END;
$$;

REVOKE ALL ON FUNCTION public.save_completed_game(jsonb, jsonb, jsonb),
  public.update_match_roles(uuid, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_completed_game(jsonb, jsonb, jsonb),
  public.update_match_roles(uuid, integer, jsonb) TO authenticated;

-- Fail the migration if inherited or column-level grants leave a write bypass.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM unnest(ARRAY['anon', 'authenticated']) AS r(client)
    CROSS JOIN unnest(ARRAY[
      'public.admin_users', 'public.players', 'public.games',
      'public.game_players', 'public.game_bans'
    ]) AS t(name)
    JOIN pg_catalog.pg_attribute AS a ON a.attrelid = t.name::regclass
    WHERE a.attnum > 0 AND NOT a.attisdropped AND (
      has_table_privilege(r.client, t.name, 'DELETE,TRUNCATE')
      OR has_column_privilege(r.client, t.name, a.attname, 'INSERT')
      OR (has_column_privilege(r.client, t.name, a.attname, 'UPDATE')
        AND (r.client, t.name, a.attname::text) <>
          ('authenticated', 'public.players', 'default_rating'))
    )
  ) THEN
    RAISE EXCEPTION 'Unexpected effective client write grants. Review privileges before migrating.';
  END IF;
END;
$$;

COMMIT;
