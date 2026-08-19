-- Pick — core schema.
--
-- Auth is Privy, not Supabase Auth, so `users.privy_id` is the subject we match
-- JWT claims against. See 20260818000200_rls.sql for the policies that use it.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- users

create table if not exists public.users (
  id                    uuid primary key default gen_random_uuid(),
  privy_id              text not null unique,
  x_id                  text unique,
  handle                text,
  display_name          text,
  pfp_url               text,
  embedded_wallet       text unique,
  connected_wallet      text unique,
  x_account_created_at  timestamptz,
  created_at            timestamptz not null default now()
);

create index if not exists users_handle_idx on public.users (lower(handle));

-- ---------------------------------------------------------------- stocks

create table if not exists public.stocks (
  ticker            text primary key,
  name              text not null,
  rh_token_address  text,
  active            boolean not null default true,
  sort              integer not null default 0
);

create index if not exists stocks_active_sort_idx on public.stocks (active, sort);

-- ---------------------------------------------------------------- slates

-- One row per trading day the picks are FOR. `locks_at` is that day's market
-- open in US/Eastern; nothing may be written to picks for the slate after it.
create table if not exists public.daily_slates (
  slate_date  date primary key,
  tickers     text[] not null,
  locks_at    timestamptz not null,
  resolved    boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint daily_slates_tickers_not_empty
    check (coalesce(array_length(tickers, 1), 0) >= 10)
);

create index if not exists daily_slates_open_idx
  on public.daily_slates (locks_at)
  where resolved = false;

-- ---------------------------------------------------------------- picks

create table if not exists public.picks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  slate_date  date not null references public.daily_slates (slate_date) on delete cascade,
  ticker      text not null references public.stocks (ticker),
  direction   text not null check (direction in ('up', 'down')),
  created_at  timestamptz not null default now(),
  unique (user_id, slate_date, ticker)
);

create index if not exists picks_slate_idx on public.picks (slate_date);
create index if not exists picks_user_slate_idx on public.picks (user_id, slate_date);

-- A slate is exactly ten calls. Enforced in the database so a bug in the app,
-- or a direct API call, cannot produce a nine- or eleven-pick submission.
create or replace function public.enforce_pick_rules()
returns trigger
language plpgsql
as $$
declare
  slate       public.daily_slates%rowtype;
  pick_count  integer;
begin
  select * into slate
  from public.daily_slates
  where slate_date = new.slate_date;

  if not found then
    raise exception 'no slate for %', new.slate_date;
  end if;

  if now() >= slate.locks_at then
    raise exception 'slate % locked at %', new.slate_date, slate.locks_at;
  end if;

  if not (new.ticker = any (slate.tickers)) then
    raise exception '% is not on the % slate', new.ticker, new.slate_date;
  end if;

  select count(*) into pick_count
  from public.picks
  where user_id = new.user_id
    and slate_date = new.slate_date
    and (tg_op = 'INSERT' or id <> new.id);

  if pick_count >= 10 then
    raise exception 'already have 10 picks for %', new.slate_date;
  end if;

  return new;
end;
$$;

drop trigger if exists picks_enforce_rules on public.picks;
create trigger picks_enforce_rules
  before insert or update on public.picks
  for each row execute function public.enforce_pick_rules();

-- ---------------------------------------------------------------- submissions

create table if not exists public.submissions (
  user_id       uuid not null references public.users (id) on delete cascade,
  slate_date    date not null references public.daily_slates (slate_date) on delete cascade,
  submitted_at  timestamptz not null default now(),
  counted       boolean not null default false,
  primary key (user_id, slate_date)
);

create index if not exists submissions_slate_idx on public.submissions (slate_date)
  where counted = true;

-- A submission only counts with exactly ten picks recorded before the lock.
create or replace function public.enforce_submission_rules()
returns trigger
language plpgsql
as $$
declare
  slate       public.daily_slates%rowtype;
  pick_count  integer;
begin
  if new.counted is not true then
    return new;
  end if;

  select * into slate
  from public.daily_slates
  where slate_date = new.slate_date;

  if not found then
    raise exception 'no slate for %', new.slate_date;
  end if;

  if new.submitted_at >= slate.locks_at then
    raise exception 'submission for % arrived after lock', new.slate_date;
  end if;

  select count(*) into pick_count
  from public.picks
  where user_id = new.user_id and slate_date = new.slate_date;

  if pick_count <> 10 then
    raise exception 'expected 10 picks for %, found %', new.slate_date, pick_count;
  end if;

  return new;
end;
$$;

drop trigger if exists submissions_enforce_rules on public.submissions;
create trigger submissions_enforce_rules
  before insert or update on public.submissions
  for each row execute function public.enforce_submission_rules();

-- ---------------------------------------------------------------- scoring

create table if not exists public.scores (
  user_id        uuid not null references public.users (id) on delete cascade,
  slate_date     date not null references public.daily_slates (slate_date) on delete cascade,
  correct_count  integer not null default 0 check (correct_count between 0 and 10),
  points         integer not null default 0,
  created_at     timestamptz not null default now(),
  primary key (user_id, slate_date)
);

create index if not exists scores_slate_idx on public.scores (slate_date);

create table if not exists public.streaks (
  user_id           uuid primary key references public.users (id) on delete cascade,
  current           integer not null default 0,
  longest           integer not null default 0,
  last_played_date  date,
  freezes_left      integer not null default 1
);

-- ---------------------------------------------------------------- seasons

create table if not exists public.seasons (
  id         bigint generated always as identity primary key,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  cadence    text not null default '3day' check (cadence in ('3day', 'daily')),
  constraint seasons_window check (ends_at > starts_at)
);

create index if not exists seasons_window_idx on public.seasons (starts_at, ends_at);

-- ---------------------------------------------------------------- rewards

create table if not exists public.claims (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users (id) on delete cascade,
  type          text not null check (type in ('leaderboard', 'welcome')),
  amount_usd    numeric(12, 2) not null check (amount_usd > 0),
  stock_ticker  text references public.stocks (ticker),
  tx_hash       text unique,
  status        text not null default 'pending' check (status in ('pending', 'confirmed')),
  season_id     bigint references public.seasons (id),
  created_at    timestamptz not null default now()
);

create index if not exists claims_user_idx on public.claims (user_id, created_at desc);

-- One leaderboard payout and one welcome reward per user per season.
create unique index if not exists claims_one_per_type_per_season
  on public.claims (user_id, type, season_id)
  where season_id is not null;

create table if not exists public.learner_progress (
  user_id       uuid primary key references public.users (id) on delete cascade,
  tasks_done    integer not null default 0 check (tasks_done between 0 and 3),
  shared_on_x   boolean not null default false,
  rewarded      boolean not null default false,
  reward_slate  date,
  season_id     bigint references public.seasons (id),
  updated_at    timestamptz not null default now()
);
