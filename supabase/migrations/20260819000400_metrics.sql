-- Pick — the adoption story, computed in the database.
--
-- One function, one round trip, no rows crossing the wire. Every number here is
-- a count over tables the app already writes; nothing is estimated and nothing
-- is stored twice. The on-chain half of the story (who actually holds a share
-- right now) is read from the chain by the caller and merged on top.

create or replace function public.adoption_metrics(
  p_active_days integer default 7
)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
with
-- One row per player per day they submitted a slate. Submitting is the only
-- action that means "played", so it is the definition of active throughout.
active as (
  select user_id, (submitted_at at time zone 'utc')::date as day
  from public.submissions
  group by 1, 2
),
cohort as (
  select id as user_id, (created_at at time zone 'utc')::date as signup_day
  from public.users
),
today as (
  select (now() at time zone 'utc')::date as d
),
people as (
  select
    count(*)::int as total,
    count(*) filter (where onboarded_at is not null)::int as onboarded,
    -- Unknown is its own bucket rather than being folded into either side: the
    -- percentage below is over players we actually know about.
    count(*) filter (where had_wallet_at_signup is not null)::int as wallet_known,
    count(*) filter (where had_wallet_at_signup is false)::int as new_to_crypto,
    count(distinct signup_country) filter (where signup_country is not null)::int as countries
  from public.users
),
players as (
  select
    count(distinct user_id)::int as ever,
    count(distinct user_id) filter (
      where submitted_at >= now() - interval '1 day'
    )::int as dau,
    count(distinct user_id) filter (
      where submitted_at >= now() - (p_active_days || ' days')::interval
    )::int as active_window
  from public.submissions
),
-- Retention is measured only over cohorts old enough to have had the chance,
-- so a signup from this morning cannot drag D7 down.
d1 as (
  select count(*)::int as eligible, count(a.user_id)::int as retained
  from cohort c
  cross join today t
  left join active a on a.user_id = c.user_id and a.day = c.signup_day + 1
  where c.signup_day <= t.d - 1
),
d7 as (
  select count(*)::int as eligible, count(a.user_id)::int as retained
  from cohort c
  cross join today t
  left join active a on a.user_id = c.user_id and a.day = c.signup_day + 7
  where c.signup_day <= t.d - 7
),
-- Only confirmed claims count. A pending one is a promise, not a transfer, and
-- this page exists to state what was actually delivered.
paid as (
  select
    count(*)::int as claims,
    count(distinct user_id)::int as recipients,
    coalesce(sum(amount_usd), 0)::numeric as usd,
    count(distinct stock_ticker) filter (where stock_ticker is not null)::int as tickers
  from public.claims
  where status = 'confirmed'
),
learners as (
  select
    count(*) filter (where tasks_done >= 3)::int as finished_lessons,
    count(*) filter (where rewarded)::int as rewarded
  from public.learner_progress
)
select jsonb_build_object(
  'generatedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'users', jsonb_build_object(
    'total', people.total,
    'onboarded', people.onboarded,
    'newToCrypto', people.new_to_crypto,
    'walletStatusKnown', people.wallet_known,
    'countries', people.countries
  ),
  'activity', jsonb_build_object(
    'everPlayed', players.ever,
    'dau', players.dau,
    'activeWindowDays', p_active_days,
    'activeInWindow', players.active_window
  ),
  'retention', jsonb_build_object(
    'd1Eligible', d1.eligible,
    'd1Retained', d1.retained,
    'd7Eligible', d7.eligible,
    'd7Retained', d7.retained
  ),
  'rewards', jsonb_build_object(
    'confirmedClaims', paid.claims,
    'recipients', paid.recipients,
    'usdDistributed', paid.usd,
    'distinctTickers', paid.tickers,
    'finishedLessons', learners.finished_lessons,
    'welcomeRewarded', learners.rewarded
  )
)
from people, players, d1, d7, paid, learners;
$$;

revoke all on function public.adoption_metrics(integer) from public;

-- Wallets to check on chain, so the metrics job asks about the few hundred
-- addresses that were actually paid rather than every address in the table.
create or replace function public.paid_wallets()
returns table (user_id uuid, wallet text, ticker text, chain_id integer)
language sql
security definer
set search_path = public
stable
as $$
  select distinct c.user_id, lower(c.wallet), c.stock_ticker, c.chain_id
  from public.claims c
  where c.status = 'confirmed'
    and c.wallet is not null
    and c.stock_ticker is not null;
$$;

revoke all on function public.paid_wallets() from public;

create index if not exists claims_confirmed_wallet_idx
  on public.claims (wallet)
  where status = 'confirmed';

create index if not exists submissions_user_day_idx
  on public.submissions (user_id, submitted_at);
