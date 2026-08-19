-- Pick — row level security and read views.
--
-- The `service_role` key bypasses RLS entirely; the scheduled resolution and
-- slate-creation jobs rely on that. Everything reaching the browser goes
-- through these policies.

create schema if not exists app;

-- Resolves the signed-in player from the JWT `sub` claim. When Supabase Auth is
-- not the issuer, mint a Supabase JWT whose `sub` is the Privy DID.
create or replace function app.current_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.id
  from public.users u
  where u.privy_id = nullif(
    current_setting('request.jwt.claims', true)::jsonb ->> 'sub',
    ''
  )
$$;

revoke all on function app.current_user_id() from public;
grant execute on function app.current_user_id() to authenticated, anon;

-- ---------------------------------------------------------------- enable RLS

alter table public.users             enable row level security;
alter table public.stocks            enable row level security;
alter table public.daily_slates      enable row level security;
alter table public.picks             enable row level security;
alter table public.submissions       enable row level security;
alter table public.scores            enable row level security;
alter table public.streaks           enable row level security;
alter table public.seasons           enable row level security;
alter table public.claims            enable row level security;
alter table public.learner_progress  enable row level security;

-- ---------------------------------------------------------------- reference data

-- Stocks, slates, and seasons are the shared board state: readable by any
-- signed-in player, writable only by the service role.
drop policy if exists stocks_read on public.stocks;
create policy stocks_read on public.stocks
  for select to authenticated using (true);

drop policy if exists slates_read on public.daily_slates;
create policy slates_read on public.daily_slates
  for select to authenticated using (true);

drop policy if exists seasons_read on public.seasons;
create policy seasons_read on public.seasons
  for select to authenticated using (true);

-- ---------------------------------------------------------------- own rows only

drop policy if exists users_read_self on public.users;
create policy users_read_self on public.users
  for select to authenticated using (id = app.current_user_id());

drop policy if exists users_update_self on public.users;
create policy users_update_self on public.users
  for update to authenticated
  using (id = app.current_user_id())
  with check (id = app.current_user_id());

drop policy if exists picks_rw_self on public.picks;
create policy picks_rw_self on public.picks
  for all to authenticated
  using (user_id = app.current_user_id())
  with check (user_id = app.current_user_id());

drop policy if exists submissions_rw_self on public.submissions;
create policy submissions_rw_self on public.submissions
  for all to authenticated
  using (user_id = app.current_user_id())
  with check (user_id = app.current_user_id());

drop policy if exists claims_read_self on public.claims;
create policy claims_read_self on public.claims
  for select to authenticated using (user_id = app.current_user_id());

drop policy if exists progress_rw_self on public.learner_progress;
create policy progress_rw_self on public.learner_progress
  for all to authenticated
  using (user_id = app.current_user_id())
  with check (user_id = app.current_user_id());

-- Scores and streaks are written by the resolution job only. A player can read
-- their own row; everyone else sees them through the leaderboard view.
drop policy if exists scores_read_self on public.scores;
create policy scores_read_self on public.scores
  for select to authenticated using (user_id = app.current_user_id());

drop policy if exists streaks_read_self on public.streaks;
create policy streaks_read_self on public.streaks
  for select to authenticated using (user_id = app.current_user_id());

-- ---------------------------------------------------------------- views

create or replace view public.active_season as
  select *
  from public.seasons
  where now() >= starts_at and now() < ends_at
  order by starts_at desc
  limit 1;

-- Deliberately a definer-rights view: the board is public by design, so it may
-- aggregate score rows that individual players cannot select directly. It
-- exposes only handle, display name, avatar, and points.
create or replace view public.leaderboard as
  select
    u.id                                                    as user_id,
    u.handle,
    u.display_name,
    u.pfp_url,
    sum(sc.points)::int                                     as points,
    count(*)::int                                           as slates_played,
    rank() over (order by sum(sc.points) desc, min(sc.created_at))::int as rank
  from public.scores sc
  join public.users u on u.id = sc.user_id
  join public.active_season s
    on sc.slate_date >= (s.starts_at at time zone 'UTC')::date
   and sc.slate_date <  (s.ends_at   at time zone 'UTC')::date
  group by u.id, u.handle, u.display_name, u.pfp_url;

grant select on public.active_season to authenticated, anon;
grant select on public.leaderboard   to authenticated, anon;
