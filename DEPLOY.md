# Deploying Pick to testnet

Everything below targets Robinhood Chain **testnet** (chainId 46630) with mock
tokens. Nothing here is safe for mainnet — see
[contracts/README.md](contracts/README.md#before-mainnet).

Work through it in order. Steps 1–3 can be done in parallel; step 4 needs all of
them.

---

## 1. Contracts

```bash
pnpm contracts:install
cd contracts
forge test          # must be green before anything is deployed
```

Fund a deployer address from the [faucet](https://faucet.testnet.chain.robinhood.com),
then:

```bash
export PRIVATE_KEY=0x...
export TRUSTED_SIGNER=0x...   # address of CLAIM_SIGNER_PRIVATE_KEY, see step 3

forge script script/Deploy.s.sol:Deploy \
  --rpc-url rh_testnet --broadcast \
  --verify --verifier blockscout \
  --verifier-url https://explorer.testnet.chain.robinhood.com/api
```

Keep the printed addresses. They also land in `contracts/deployments/46630.json`.

> The `TRUSTED_SIGNER` must be the address derived from the private key the app
> will sign claims with. Get this wrong and every claim reverts with
> `InvalidSignature`.

Claim swaps are bounded by a Chainlink price floor. On testnet the router is a
fixed-rate mock, so leaving the feeds unset is fine and the deploy logs which
tokens ended up without one. Against a real router, set a feed per reward token
and turn the guard on — see [Price feeds](contracts/README.md#price-feeds):

```bash
export CHAINLINK_FEED_TSLA=0x...   # from Chainlink's directory for this chain
export SEQUENCER_UPTIME_FEED=0x...
export ORACLE_REQUIRED=true
```

## 2. Supabase

Create a project, then run the migrations in order in the SQL editor:

1. `supabase/migrations/20260818000100_init.sql`
2. `supabase/migrations/20260818000200_rls.sql`
3. `supabase/migrations/20260818000300_results.sql`
4. `supabase/migrations/20260818000400_rewards.sql`
5. `supabase/migrations/20260819000100_snapshots.sql`
6. `supabase/migrations/20260819000200_rest_resolution.sql`
7. `supabase/migrations/20260819000300_onboarding.sql`
8. `supabase/migrations/20260819000400_metrics.sql`

Then seed the stock universe, an active season and an open slate:

```bash
pnpm seed
```

## 3. Third-party keys

| Service | What you need | Without it |
| --- | --- | --- |
| [Privy](https://dashboard.privy.io) | App ID + app secret, X login enabled | The app runs in demo mode with a fake local user |
| [Reown](https://dashboard.reown.com) | Project ID | MetaMask, Rabby and Coinbase still work; QR-scanning phone wallets do not |
| [Alchemy](https://www.alchemy.com) | Robinhood Chain mainnet RPC URL | Prices fall back to the public RPC, which is rate limited |
| [Alchemy](https://dashboard.alchemy.com/gas-manager) | Testnet bundler URL + a gas policy | Claiming falls back to a connected wallet that has to hold testnet ETH |
| [X](https://developer.x.com) | App-only bearer token | Learner rewards cannot be granted and account ages cannot be checked |

Generate the claim signer key with any wallet, or:

```bash
cast wallet new
```

Its **address** goes to the deploy script as `TRUSTED_SIGNER`; its **private
key** goes to Vercel as `CLAIM_SIGNER_PRIVATE_KEY` and nowhere else.

## 4. Vercel

```bash
vercel link
vercel --prod
```

Set every variable from [`.env.local.example`](.env.local.example) in the Vercel
project. The ones that are easy to miss:

- `CRON_SECRET` — without it the cron routes refuse to run in production.
- `CLAIM_SIGNER_PRIVATE_KEY` — server-side only, never `NEXT_PUBLIC_`.
- `NEXT_PUBLIC_REWARD_TOKENS` — the JSON map of ticker to token address. If it
  is missing, the stock picker falls back to showing tickers that cannot
  actually be paid out.
- `ALLOW_UNVERIFIED_SHARE` — must be `false` in production, or the learner
  reward is farmable with any URL.
- `CHAINLINK_SEQUENCER_UPTIME_FEED` — unset today because Chainlink has not
  published one for chain 4663. Set it the moment one exists: a snapshot taken
  during a sequencer outage would score a slate off stale prices.
- `CROSS_CHECK_TOLERANCE_BPS` — how far Chainlink may sit from the Robinhood mid
  before a ticker is voided. Run `pnpm verify:feeds` against production before
  changing it: set too tight, it voids healthy tickers every day.
- `NEWS_ENABLED` / `NEWS_API_KEY` — optional, and the only non-partner data
  source in the app. Leave unset and the detail sheet shows "No recent news".
- `NEXT_PUBLIC_AA_ENABLED` / `ALCHEMY_TESTNET_RPC_URL` / `ALCHEMY_GAS_POLICY_ID`
  — all three or none. With them, claiming costs the player nothing and asks
  them to approve nothing, which is the difference between onboarding someone
  who has never used crypto and losing them at the gas step. Put a spend cap on
  the policy: the proxy only sponsors calls to the claim contract, but a cap is
  what limits the damage if that check is ever wrong.
- `ADMIN_X_HANDLES` / `ADMIN_API_TOKEN` — who can open `/admin/metrics`. With
  neither set the page 404s in production, which is the safe default.

`vercel.json` already registers the cron jobs:

| Route | Schedule (UTC) | Does |
| --- | --- | --- |
| `/api/cron/ticks` | `*/5 13-21 * * 1-5` | Samples every quoted price for the detail-sheet chart, and prunes samples older than three days. Display only — it never touches scoring |
| `/api/cron/resolve` | `0 22 * * 1-5` | Snapshots every token's Robinhood quote, scores the slate that snapshot completes, pays finished seasons, locks tomorrow's board and opens the next |
| `/api/cron/slate` | `30 22 * * 1-5` | The catch-up run. Same job; a no-op when the first one succeeded |

The tick job needs a paid Vercel plan for the sub-daily schedule. Dropping it
costs nothing but the 1D chart: every other timeframe is drawn from the daily
snapshots.

22:00 UTC is 17:00 in New York under EST and 18:00 under EDT, so it is always at
least an hour past the close with post-close prints in. Both runs are idempotent:
once a date has a full set of snapshot rows the prices are frozen, so a retry
reuses the original snapshot rather than re-quoting at different prices, and
cannot double-score or double-pay.

---

## Smoke test

Run this against the deployed URL with a fresh X account and a funded testnet
wallet. It is the full loop from Prompt 12.

- [ ] **Log in with X.** A brand-new account lands on the Learn tab, not the
      dashboard, and is greeted by name. The other tabs are usable right away,
      and a reload does not drag you back.
- [ ] **Check the profile.** The menu shows your handle and an embedded wallet
      address.
- [ ] **Pick ten.** The Play tab lists the universe; search works; picking an
      eleventh is refused. The submit bar enables at exactly ten.
- [ ] **Submit.** The share card appears with your ten calls. "Share on X" opens
      an intent with the text prefilled and a link that unfurls to the card
      image.
- [ ] **Check the image.** Open `/api/share-image?type=picks&picks=TSLA:up,AMZN:down`
      directly. It should return a branded PNG, not an error.
- [ ] **Check the prices.** `pnpm verify:feeds` should price all ~194 tokens and
      report only a handful of cross-check breaches, if any.
- [ ] **Confirm the lock.** Reload after 22:00 UTC; picks are read-only and a
      second submission returns "Calls are locked."
- [ ] **Resolve.** Either wait for the cron or trigger it manually:
      `curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/resolve`.
      The response lists resolved slates and any payouts.
- [ ] **Leaderboard.** Your row appears at your rank and is highlighted. Paging
      loads more rows.
- [ ] **Lessons.** "Start" opens the first, a wrong answer is rejected, and a
      right one leads straight into the next. After the third, the tab offers
      "See what you own".
- [ ] **Learner reward.** After all three lessons, a submitted slate and a
      verified share post, `$10` appears on Portfolio. A second attempt is
      refused.
- [ ] **Connect a wallet.** The sheet lists MetaMask, Rabby, Coinbase Wallet and
      WalletConnect. Connecting on the wrong network offers "Switch network".
- [ ] **Claim.** Choose a stock, confirm, and watch the transaction land. With
      sponsorship on, there is no wallet prompt and no fee at any point. The
      item moves to History with a working explorer link, and the claim share
      card appears.
- [ ] **Claim again.** The same reward cannot be claimed twice — the contract
      reverts with `AlreadyClaimed` even if the API is called directly.
- [ ] **Holdings.** The claimed stock appears on "What you own" with the right
      quantity, a live value and an "earned" tag, read from the chain.
- [ ] **Metrics.** `/admin/metrics` opens for an allowlisted handle and 404s for
      anyone else. The counts are non-zero, and both exports download.
      `pnpm verify:metrics` prints the same numbers from the command line.

### If something fails

| Symptom | Usually means |
| --- | --- |
| Claims disabled, "not configured yet" | `CLAIM_SIGNER_PRIVATE_KEY` or `NEXT_PUBLIC_CLAIM_DISTRIBUTOR_ADDRESS` is unset |
| Claim reverts `InvalidSignature` | `TRUSTED_SIGNER` on-chain does not match the deployed signer key |
| Claim reverts `TokenNotAllowlisted` | The token is in `NEXT_PUBLIC_REWARD_TOKENS` but was never allowlisted on the distributor |
| Claim reverts `PriceFeedMissing` | `ORACLE_REQUIRED=true` but that token has no `CHAINLINK_FEED_<SYMBOL>` configured |
| Claim reverts `StalePrice` | The feed has not published inside `CHAINLINK_MAX_AGE`; over a long market close, raise it |
| Claim reverts `SequencerGracePeriod` | The L2 sequencer restarted recently; wait out `SEQUENCER_GRACE_PERIOD` |
| Resolution reports `tickersMissing` | Market data key is missing, rate limited, or the day was a holiday |
| Leaderboard empty after resolve | No season covers the slate date; check `active_season` |
| Everything reads as sample data | Supabase or Privy is not configured, so the app fell back to demo mode |
