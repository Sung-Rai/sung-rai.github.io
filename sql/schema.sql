-- KeamKxN game stats schema
-- Run this once in Supabase SQL Editor.

create extension if not exists pgcrypto;

-- --------------------
-- Tables
-- --------------------

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  stable_key text not null unique,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  played_at date not null default current_date,
  title text,
  winning_team text not null check (winning_team in ('A', 'B')),
  notes text,
  source text not null default 'manual',
  created_at timestamptz not null default now()
);

create table if not exists public.game_players (
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

create table if not exists public.game_bans (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  team text check (team in ('A', 'B')),
  champion text not null,
  ban_order int,
  created_at timestamptz not null default now()
);

-- --------------------
-- Row Level Security
-- --------------------

alter table public.players enable row level security;
alter table public.games enable row level security;
alter table public.game_players enable row level security;
alter table public.game_bans enable row level security;

-- IMPORTANT:
-- These policies allow public read + public insert.
-- This is fine for a small trusted/private group MVP,
-- but anyone with the project URL/key could insert data.
-- For production, replace "anon" with "authenticated" and add Supabase Auth.

drop policy if exists "public players select" on public.players;
drop policy if exists "public players insert" on public.players;
drop policy if exists "public players update" on public.players;

create policy "public players select"
on public.players
for select
to anon, authenticated
using (true);

create policy "public players insert"
on public.players
for insert
to anon, authenticated
with check (true);

create policy "public players update"
on public.players
for update
to anon, authenticated
using (true)
with check (true);


drop policy if exists "public games select" on public.games;
drop policy if exists "public games insert" on public.games;

create policy "public games select"
on public.games
for select
to anon, authenticated
using (true);

create policy "public games insert"
on public.games
for insert
to anon, authenticated
with check (true);


drop policy if exists "public game_players select" on public.game_players;
drop policy if exists "public game_players insert" on public.game_players;

create policy "public game_players select"
on public.game_players
for select
to anon, authenticated
using (true);

create policy "public game_players insert"
on public.game_players
for insert
to anon, authenticated
with check (true);


drop policy if exists "public game_bans select" on public.game_bans;
drop policy if exists "public game_bans insert" on public.game_bans;

create policy "public game_bans select"
on public.game_bans
for select
to anon, authenticated
using (true);

create policy "public game_bans insert"
on public.game_bans
for insert
to anon, authenticated
with check (true);

-- Explicit privileges.
grant usage on schema public to anon, authenticated;

grant select, insert, update on public.players to anon, authenticated;
grant select, insert on public.games to anon, authenticated;
grant select, insert on public.game_players to anon, authenticated;
grant select, insert on public.game_bans to anon, authenticated;