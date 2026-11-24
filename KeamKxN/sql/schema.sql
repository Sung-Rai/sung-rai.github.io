-- Local fixture for the audited KeamKxN baseline BEFORE migration 001.
-- Use only on a new disposable Supabase project. See README.md for details.
-- Requires Supabase's anon/authenticated roles and auth.uid().

create table public.players (
  id uuid primary key default gen_random_uuid(),
  stable_key text not null unique,
  display_name text not null,
  default_rating integer not null default 50,
  constraint players_default_rating_range check (default_rating between 0 and 100),
  created_at timestamptz not null default now()
);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  played_at date not null default current_date,
  title text,
  winning_team text not null check (winning_team in ('A', 'B')),
  notes text,
  source text not null default 'manual',
  created_at timestamptz not null default now()
);

create table public.game_players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  player_id uuid not null references public.players(id),
  team text not null check (team in ('A', 'B')),
  role text not null check (role in ('Top', 'Jun', 'Mid', 'Adc', 'Sup')),
  champion text,
  kills int check (kills is null or kills >= 0),
  deaths int check (deaths is null or deaths >= 0),
  assists int check (assists is null or assists >= 0),
  created_at timestamptz not null default now(),

  unique (game_id, player_id),
  unique (game_id, team, role)
);

create table public.game_bans (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  team text check (team in ('A', 'B')),
  champion text not null,
  ban_order int,
  created_at timestamptz not null default now()
);

create table public.admin_users (
  user_id uuid primary key
);

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

revoke all on function public.is_admin() from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;

grant usage on schema public to anon, authenticated;
revoke all on public.admin_users, public.players, public.games,
  public.game_players, public.game_bans from public, anon, authenticated;
grant select, insert on public.players, public.games, public.game_players,
  public.game_bans to authenticated;
grant update on public.players to authenticated;
grant truncate on public.admin_users, public.players, public.games,
  public.game_players, public.game_bans to authenticated;

alter table public.admin_users enable row level security;
alter table public.players enable row level security;
create policy "admin players select" on public.players
  for select to authenticated using (public.is_admin());
create policy "admin players insert" on public.players
  for insert to authenticated with check (public.is_admin());

alter table public.games enable row level security;
create policy "admin games select" on public.games
  for select to authenticated using (public.is_admin());
create policy "admin games insert" on public.games
  for insert to authenticated with check (public.is_admin());

alter table public.game_players enable row level security;
create policy "admin game_players select" on public.game_players
  for select to authenticated using (public.is_admin());
create policy "admin game_players insert" on public.game_players
  for insert to authenticated with check (public.is_admin());

alter table public.game_bans enable row level security;
create policy "admin game_bans select" on public.game_bans
  for select to authenticated using (public.is_admin());
create policy "admin game_bans insert" on public.game_bans
  for insert to authenticated with check (public.is_admin());

create policy "admin players update" on public.players
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
