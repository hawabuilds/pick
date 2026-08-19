# Supabase

## Apply the migrations

With the Supabase CLI linked to your project:

```bash
supabase db push
```

Or paste the files in `migrations/` into the SQL editor in order:

1. `20260818000100_init.sql` — tables, constraints, triggers, indexes
2. `20260818000200_rls.sql` — RLS policies, `active_season`, `leaderboard`
3. `20260818000300_results.sql` — `slate_results` and streak bookkeeping
4. `20260818000400_rewards.sql` — claim lifecycle, learner gates, rate limits
5. `20260819000100_snapshots.sql` — `price_snapshots`, plus 8-decimal results and
   the `void` outcome
6. `20260819000200_rest_resolution.sql` — REST quote fields on snapshots, the
   Chainlink cross-check columns, void reasons, and the 7-of-10 slate rule
7. `20260819000300_onboarding.sql` — first-run state and the three columns the
   adoption story is told from
8. `20260819000400_metrics.sql` — `adoption_metrics()` and `paid_wallets()`
9. `20260819000500_price_ticks.sql` — intraday samples for the detail chart, and
   the prune that keeps them to one session's worth
10. `20260819000600_stock_comments.sql` — per-ticker comment threads on stock
    detail sheets

Then seed stocks, a season, and both slates:

```bash
pnpm seed
```

## How auth fits

Authentication is Privy, not Supabase Auth. The policies resolve the caller
through `app.current_user_id()`, which matches `users.privy_id` against the
`sub` claim of the request JWT. Two ways to satisfy that:

1. **Server-side (what the app does today).** API routes verify the Privy access
   token, then read and write with the service role key, which bypasses RLS. The
   policies are the second line of defence rather than the first.
2. **Direct from the browser.** Mint a Supabase-signed JWT whose `sub` is the
   Privy DID and hand it to `createClient`. Then the policies apply directly.

## Invariants enforced in the database

These are not just app-level checks, because a slate that is not exactly ten
calls corrupts scoring:

- `picks_enforce_rules` — rejects an eleventh pick, a pick for a ticker that is
  not on the slate, and any pick written at or after `locks_at`.
- `submissions_enforce_rules` — a submission may only be `counted` when exactly
  ten picks exist and it arrived before the lock.
- `claims_one_per_type_per_season` — one leaderboard payout per player per
  season, which also makes granting payouts idempotent.
- `claims_one_welcome_per_user` — the welcome reward is once per account for
  good, not once per season.
- `users.x_id` and `users.connected_wallet` are unique — one X identity and one
  external wallet per player, which is what stops one person running several
  accounts into the same payout address.

## Rewards and abuse controls

A claim moves `available → pending → confirmed`, with `failed` returning it to
the available list so a reverted transaction can be retried. `seasons.paid_out_at`
marks a season settled so a re-run of the resolution job cannot try to pay it
twice.

`rate_limits` holds fixed-window counters, incremented through
`consume_rate_limit(bucket, limit, window_seconds)`. The insert/on-conflict pair
inside that function is what makes it atomic — two concurrent requests cannot
both read the pre-increment value and both be let through. The counters live in
Postgres rather than in memory because the API routes run on serverless
functions, where an in-process counter resets on exactly the cold start a burst
causes. `prune_rate_limits` sweeps old windows, called by the resolution job.

`abuse_events` records rejected claims, submissions after the lock, duplicate
identities and failed share verifications. IP addresses are hashed before they
are stored.

## Prices: two tables, one basis

`price_snapshots` is the settlement record: one row per ticker per trading day,
read at 22:00 UTC, and the only price a call is ever scored against.
`price_ticks` is the chart: the same Robinhood mid sampled through the session,
kept for three days and pruned by `prune_price_ticks`.

They are separate tables on purpose. A tick is whatever the price was when the
job happened to run, and treating one as a snapshot would settle a call against
an arbitrary moment. Both store the raw underlying share price, so they share an
axis and the chart cannot tell a different story from the result.

## Resolution

`slate_results` holds one row per ticker per resolved slate: the close, the prior
close, the resulting direction, and which provider supplied them. Scores are
derived from it, so if a provider revises a close or a player disputes a call,
the exact inputs are still there. A close that exactly matches the prior close is
recorded as `flat` and scores nothing for either direction.

Seasons are contiguous — each starts where the last ended — so a job that runs
late cannot leave a gap in which scores belong to no season and silently drop off
the leaderboard.

## Metrics

`adoption_metrics(p_active_days)` returns the whole internal dashboard as one
jsonb value: signups, how many were new to crypto, countries, daily actives, D1
and D7 retention, and what has been paid out. It is one round trip and no rows
cross the wire, which matters because retention is a cohort join over every user
and every submission.

Retention counts only cohorts old enough to have had the chance — a player who
signed up this morning is not in the D7 denominator, so the number cannot be
dragged down by recent growth.

`paid_wallets()` lists the wallet and ticker of every confirmed claim, which is
the input to the on-chain half: the app reads those balances directly, because
only the chain can say what is still held. Both functions are definer-rights and
revoked from `public`; they are reached through the service role behind the
admin gate.

## Testing RLS

```sql
-- as an authenticated user whose sub is some other player's DID
select * from picks;  -- returns only their own rows
```

The `leaderboard` view is intentionally definer-rights: the board is public, and
it exposes only handle, display name, avatar, and points.
