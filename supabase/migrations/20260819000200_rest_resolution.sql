-- Pick — settle on Robinhood's own prices across the full RWA universe.
--
-- The snapshot moves from Chainlink to Robinhood's `/rhj/prices` REST feed. Two
-- reasons: it covers all ~194 tokenized assets rather than the ~34 with a
-- Chainlink feed, and it is the same price Robinhood itself quotes, which is the
-- price a player sees. Chainlink stays as an integrity anchor on the tickers it
-- covers — if the two disagree beyond tolerance, the ticker is voided rather
-- than scored on a number we cannot corroborate.

-- ------------------------------------------------------------------ stocks

-- The universe is now built from `/rhj/assets` rather than a hand-typed list,
-- so the table carries what that registry returns.
alter table public.stocks
  add column if not exists logo_url   text,
  -- Shares represented by one token. Rises as dividends are reinvested. Used
  -- for display and for valuing holdings, never applied to a REST price, which
  -- is already the raw underlying share price.
  add column if not exists multiplier numeric(30, 18) not null default 1;

-- --------------------------------------------------------- price_snapshots

-- Chainlink is no longer the settlement source, so a snapshot row can exist
-- without one. The columns stay, now as corroboration rather than truth.
alter table public.price_snapshots
  alter column round_id        drop not null,
  alter column feed_updated_at drop not null,
  alter column block_number    drop not null;

alter table public.price_snapshots
  -- The quote as taken. Settlement uses mid, but bid and ask are kept so a
  -- disputed call can be re-examined against the spread that produced it.
  add column if not exists bid             numeric(20, 8),
  add column if not exists ask             numeric(20, 8),
  add column if not exists spread_bps      numeric(12, 4),
  -- Robinhood's own timestamp for the quote, distinct from when we stored it.
  add column if not exists generated_at    timestamptz,
  -- A halted ticker has no meaningful price, so it is voided for the slate.
  add column if not exists is_trading_halt boolean not null default false,
  -- Multiplier at snapshot time. A change between two snapshots means a
  -- corporate action landed in the window and the raw prices are not comparable.
  add column if not exists multiplier      numeric(30, 18) not null default 1,
  add column if not exists source          text not null default 'robinhood',
  -- Chainlink cross-check, present only for covered tickers.
  add column if not exists chainlink_price numeric(20, 8),
  add column if not exists cross_check_bps numeric(12, 4),
  add column if not exists cross_check_ok  boolean;

alter table public.price_snapshots
  drop constraint if exists price_snapshots_source_check;

alter table public.price_snapshots
  add constraint price_snapshots_source_check
  check (source in ('robinhood', 'chainlink'));

comment on column public.price_snapshots.price is
  'Settlement price: mid of the Robinhood bid/ask, raw underlying share price, '
  'not multiplier-adjusted.';

-- ----------------------------------------------------------- slate_results

-- Why a ticker scored nothing. Without it a void is indistinguishable from a
-- bug, and voids are the one outcome players will question.
alter table public.slate_results
  add column if not exists void_reason text;

alter table public.slate_results
  drop constraint if exists slate_results_void_reason_check;

alter table public.slate_results
  add constraint slate_results_void_reason_check
  check (
    void_reason is null or void_reason in (
      'corporate_action',
      'trading_halt',
      'cross_check',
      'missing_price',
      'wide_spread'
    )
  );

alter table public.slate_results
  drop constraint if exists slate_results_source_check;

-- ------------------------------------------------------------------ scores

-- A slate with too many voided tickers is not a fair round. The score row
-- records how many of the ten were actually scoreable, and whether the slate
-- was voided outright, so the leaderboard and the streak logic agree on why.
alter table public.scores
  add column if not exists valid_count integer not null default 10
    check (valid_count between 0 and 10),
  add column if not exists voided      boolean not null default false;

comment on column public.scores.voided is
  'True when fewer than 7 of the 10 tickers were scoreable. Points are zero and '
  'the streak is preserved rather than broken.';
