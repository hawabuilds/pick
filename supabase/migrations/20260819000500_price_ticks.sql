-- Pick — intraday price history for the stock detail chart.
--
-- Daily snapshots are the settlement record and they are deliberately one row
-- per trading day, which draws nothing on a 1D chart. This table is the other
-- half: the same Robinhood `/rhj/prices` mid, sampled through the session, so a
-- player can see the shape of the day their call is riding on.
--
-- Display only. Nothing here is ever scored, and resolution never reads it — a
-- tick is a sample taken whenever the job happened to run, while a snapshot is
-- taken at one fixed instant and is the only price a call is settled against.

create table if not exists public.price_ticks (
  ticker      text        not null references public.stocks (ticker),
  captured_at timestamptz not null default now(),
  -- Mid of the Robinhood bid/ask: the raw underlying share price, not adjusted
  -- by the token multiplier. Same basis as price_snapshots.price so the two can
  -- be drawn on one axis.
  price       numeric(20, 8) not null check (price > 0),
  primary key (ticker, captured_at)
);

-- The primary key already serves "one ticker over a time range", which is the
-- only read. This is for the prune, which deletes by age across every ticker
-- and so cannot use an index led by ticker.
create index if not exists price_ticks_age_idx
  on public.price_ticks (captured_at);

alter table public.price_ticks enable row level security;

drop policy if exists ticks_read on public.price_ticks;
create policy ticks_read on public.price_ticks
  for select to authenticated using (true);

/**
 * Ticks exist to draw one day. Keeping more would grow without limit — 194
 * tickers every five minutes is roughly 15k rows a day — for a window nothing
 * reads. Longer timeframes come from price_snapshots, which is small and
 * permanent because it is the settlement record.
 */
create or replace function public.prune_price_ticks(p_keep_days integer default 3)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.price_ticks
  where captured_at < now() - make_interval(days => greatest(p_keep_days, 1));

  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.prune_price_ticks(integer) from public;
