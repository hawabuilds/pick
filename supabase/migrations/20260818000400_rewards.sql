-- Pick — rewards, learner progress and abuse controls.
--
-- Adds what the on-chain claim flow needs (which wallet, which chain, which
-- authorisation), the gates around the learner reward, and the two tables that
-- back rate limiting and abuse logging.

-- ---------------------------------------------------------------- claims

-- A claim is 'available' once the backend decides it is owed, 'pending' from the
-- moment a transaction is broadcast, and 'confirmed' when it lands. 'failed' is
-- terminal for a reverted transaction and lets the player retry.
alter table public.claims drop constraint if exists claims_status_check;
alter table public.claims add constraint claims_status_check
  check (status in ('available', 'pending', 'confirmed', 'failed'));

alter table public.claims alter column status set default 'available';

alter table public.claims add column if not exists wallet text;
alter table public.claims add column if not exists chain_id integer;
alter table public.claims add column if not exists token_address text;
alter table public.claims add column if not exists authorized_at timestamptz;
alter table public.claims add column if not exists confirmed_at timestamptz;

create index if not exists claims_available_idx
  on public.claims (user_id)
  where status = 'available';

-- The welcome reward is once per account for good, not once per season. The
-- existing (user_id, type, season_id) index would happily allow one per season.
create unique index if not exists claims_one_welcome_per_user
  on public.claims (user_id)
  where type = 'welcome';

-- ---------------------------------------------------------------- seasons

-- Set once a finished season's leaderboard payouts have been granted. Without
-- it a re-run of the resolution job would try to pay the same season twice —
-- the unique index on claims would block the duplicates, but only by erroring.
alter table public.seasons add column if not exists paid_out_at timestamptz;

create index if not exists seasons_unpaid_idx
  on public.seasons (ends_at)
  where paid_out_at is null;

-- ---------------------------------------------------------------- learner

alter table public.learner_progress add column if not exists share_url text;
alter table public.learner_progress add column if not exists share_verified_at timestamptz;
alter table public.learner_progress add column if not exists waitlisted boolean not null default false;
alter table public.learner_progress add column if not exists rewarded_at timestamptz;

-- The learner reward goes to the first 50 new players per season, so the count
-- of rewarded rows in a season is read on every eligibility check.
create index if not exists learner_rewarded_season_idx
  on public.learner_progress (season_id)
  where rewarded = true;

-- ---------------------------------------------------------------- abuse log

create table if not exists public.abuse_events (
  id          bigint generated always as identity primary key,
  user_id     uuid references public.users (id) on delete set null,
  privy_id    text,
  kind        text not null,
  detail      jsonb not null default '{}'::jsonb,
  ip_hash     text,
  created_at  timestamptz not null default now()
);

create index if not exists abuse_events_kind_idx on public.abuse_events (kind, created_at desc);
create index if not exists abuse_events_user_idx on public.abuse_events (user_id, created_at desc);

-- ---------------------------------------------------------------- rate limits

-- Fixed-window counters. Coarse, but it survives serverless cold starts in a way
-- that in-process counters do not, and every route that mutates state uses it.
create table if not exists public.rate_limits (
  bucket        text not null,
  window_start  timestamptz not null,
  hits          integer not null default 0,
  primary key (bucket, window_start)
);

create index if not exists rate_limits_window_idx on public.rate_limits (window_start);

-- Increments the caller's counter and reports whether they are still inside the
-- allowance. The insert/on-conflict pair is atomic, so two concurrent requests
-- cannot both read the pre-increment value and both be let through.
create or replace function public.consume_rate_limit(
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz;
  v_hits integer;
begin
  v_window := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limits as rl (bucket, window_start, hits)
  values (p_bucket, v_window, 1)
  on conflict (bucket, window_start)
    do update set hits = rl.hits + 1
  returning rl.hits into v_hits;

  return v_hits <= p_limit;
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer) from public;

-- Old windows are dead weight; the resolution cron sweeps them.
create or replace function public.prune_rate_limits(p_older_than interval default '1 day')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.rate_limits where window_start < now() - p_older_than;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.prune_rate_limits(interval) from public;

-- ---------------------------------------------------------------- RLS

alter table public.abuse_events enable row level security;
alter table public.rate_limits  enable row level security;

-- No policies: both tables are service-role only. Players never read them.
