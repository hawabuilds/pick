-- Pick — daily Chainlink price snapshots.
--
-- The game settles on one reading per token per day, taken from that token's
-- Chainlink feed on Robinhood Chain mainnet at 22:00 UTC. Storing the round id
-- and block number alongside the price is the point: anyone can re-run the same
-- `latestRoundData()` call at the same block and get the same number, so a
-- disputed call is settled by evidence rather than by trust.

create table if not exists public.price_snapshots (
  snapshot_date   date not null,
  ticker          text not null references public.stocks (ticker),
  -- Total return value of one token: the underlying share price already
  -- multiplied by the corporate-action multiplier. Chainlink publishes these at
  -- 8 decimals, so the column carries all 8.
  price           numeric(20, 8) not null check (price > 0),
  -- Chainlink round the price came from. Two consecutive snapshots sharing a
  -- round id means the feed never republished, so there is no new price
  -- information and the ticker is voided rather than scored.
  --
  -- Stored as text, not numeric: round ids are phase-encoded and run past 1e19,
  -- well beyond what a JSON number survives, and PostgREST serialises numeric as
  -- a JSON number. As text the value round-trips exactly, which matters because
  -- two ids being wrongly equal would void a ticker that did in fact move. It is
  -- an opaque identifier and is never used in arithmetic.
  round_id        text not null,
  feed_updated_at timestamptz not null,
  block_number    bigint not null,
  captured_at     timestamptz not null default now(),
  primary key (snapshot_date, ticker)
);

create index if not exists price_snapshots_ticker_idx
  on public.price_snapshots (ticker, snapshot_date desc);

alter table public.price_snapshots enable row level security;

drop policy if exists snapshots_read on public.price_snapshots;
create policy snapshots_read on public.price_snapshots
  for select to authenticated using (true);

-- ---------------------------------------------------------------- results

-- Feed prices carry 8 decimals. At 4 the numbers were rounded before they were
-- compared, which could turn a real move into a false flat on a high-priced
-- token.
alter table public.slate_results
  alter column close      type numeric(20, 8),
  alter column prev_close type numeric(20, 8);

-- 'void' is a ticker that could not be scored: the feed did not republish
-- between the two snapshots, was stale, or was paused for a corporate action.
-- It is distinct from 'flat', which means two genuinely different rounds landed
-- on the same price, and both score nothing.
alter table public.slate_results
  drop constraint if exists slate_results_direction_check;

alter table public.slate_results
  add constraint slate_results_direction_check
  check (direction in ('up', 'down', 'flat', 'void'));

-- The rounds the two prices came from, so a result can be traced back to the
-- exact snapshots that produced it without joining on dates.
alter table public.slate_results
  add column if not exists round_id      text,
  add column if not exists prev_round_id text,
  add column if not exists block_number  bigint;
