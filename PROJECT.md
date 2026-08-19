# Pick

A free-to-play prediction game on Robinhood Chain that onboards everyday users into
holding real-world assets (RWA).

## App spec

Users log in with X; an embedded wallet is created for them. Each day they call "up" or
"down" on exactly **10** of ~194 tokenized RWA stocks. The slate is submitted for the
**next** trading day and locks at 22:00 UTC. Correct calls earn points; a leaderboard
ranks players and resets on a season cadence (3-day at launch, later daily). The top 20
earn RWA rewards, and winners choose which stock to be paid in.

A separate passive path: a fee-on-transfer token (3% buy / 3% sell) splits the tax
**40%** to holders as RWA dividends (passive, claim anytime), **40%** to leaderboard
winners, and **20%** to new users who complete learn-to-earn tasks ($10 to the first 50
new users per season, once per account, and they must share completion on X).

Rewards are claimed in Portfolio. The wallet was set up at sign-in; bringing
another (MetaMask, Rabby, Coinbase, WalletConnect/Reown) is optional. On claim
the user picks which RWA stock to receive, then gets a shareable card.

## Hard rules

- **No betting, staking, or wagering.** Anywhere. It is a product principle, not a
  feature flag.
- **Resolve picks off Robinhood's own quote for the real stock**, never the on-chain
  token price. Thin testnet pools are trivially manipulable.
- **Void, never guess.** A split, a dividend, a halt, a Chainlink disagreement or an
  untradeable spread all void the ticker rather than score it.
- **One X account per player**, with a minimum account age, to fight sybil farming.
- Premium clean white UI: Manrope font, Robinhood green `#00C805`, four bottom tabs
  (Play, Portfolio, Ranks, Learn), mobile-first.
- **No emojis in the UI.** SVG line icons only.
- Contracts move value. Test hard on testnet and get a professional audit before
  mainnet — the tax/dividend math is bug-prone.

## Stack

| Layer | Choice |
| --- | --- |
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS |
| Hosting | Vercel |
| Auth + embedded wallet | Privy (X login) |
| External wallets | wagmi 3 + viem, with Reown's WalletConnect connector |
| Database | Supabase (Postgres, RLS, Edge Functions, cron) |
| Contracts | Foundry (Solidity) |
| Prices | Robinhood `/rhj/prices`, cross-checked against Chainlink via Alchemy |
| Universe | Robinhood `/rhj/assets` — no address is ever hardcoded |

## Chain

Robinhood Chain testnet.

- chainId **46630**
- RPC `https://rpc.testnet.chain.robinhood.com`
- Explorer `https://explorer.testnet.chain.robinhood.com`
- Faucet `https://faucet.testnet.chain.robinhood.com` — test ETH plus test stock tokens
  (TSLA, AMZN, PLTR, NFLX, AMD)

## Layout

```
src/app          routes (login at /, tabs under
                 /play /portfolio /leaderboard /learn,
                 internal adoption view at /admin/metrics)
src/components   UI primitives and feature components
src/lib          data access, market data, formatting
src/hooks        React hooks
src/config       chain + app constants
supabase/        SQL migrations and seeds
contracts/       Foundry project — token, dividend tracker, claim distributor
```

## Contracts

Three contracts on the testnet, all unaudited and all documented in
[contracts/README.md](contracts/README.md):

| Contract | Role |
| --- | --- |
| `SplitTaxToken` | Fixed supply, 3% buy / 3% sell capped at 10% total, fees swapped and split 40/40/20 |
| `RWADividendTracker` | Magnified-dividend accrual; claim in the quote asset or in a tokenized stock |
| `ClaimDistributor` | Leaderboard and welcome payouts, authorised by Merkle root or EIP-712 signature |

No DEX has testnet liquidity for these tokens, so every swap goes through
`ISwapRouter` with `MockSwapRouter` behind it. Slippage bounds are
caller-supplied and marked `TODO(mainnet)`; they must come from an oracle before
real value is involved.

## Rewards

| Reward | Who gets it | Gate |
| --- | --- | --- |
| Leaderboard payout | Top 20 of a finished season | Granted by the resolution job when the season ends |
| Welcome reward ($10) | First 50 new players per season | Three lessons, one real submitted slate, an aged X account, and an X-API-verified share post |
| Holder dividends | Anyone holding the token | Passive; claimed directly from the tracker, not shown on Portfolio |

Both claim paths sign an EIP-712 authorisation server-side for one specific
wallet and amount, so the client can only relay a claim, never invent one.

Claiming is gasless where sponsorship is configured: the reward is delivered to
an ERC-4337 smart account owned by the player's embedded wallet, and Alchemy's
gas manager settles the fee. Someone who has never used crypto is never asked to
hold ETH, approve a transaction or understand what either is. The bundler and
paymaster are reached only through `/api/aa/rpc`, which rate-limits and refuses
to sponsor anything that is not a call to `ClaimDistributor`. Without
sponsorship the flow falls back to a connected wallet paying its own fee.

## Measuring adoption

`/admin/metrics`, behind an allowlist of X handles, is where the product's own
claim is checked: how many people signed up, how many had never held a wallet
before, how many countries, whether they came back on day 1 and day 7, what was
paid out, and how much real-world value is sitting in wallets players control.

The two halves come from different places on purpose. Supabase says who signed
up and what we paid; the chain says what is still held. Only the second is
evidence of ownership, so balances are read from Robinhood Chain rather than
inferred from our own claim records. Exports as JSON or CSV, and
`pnpm verify:metrics` prints the same numbers from the command line.

## Scheduled jobs

Two Vercel Cron routes, both idempotent and both safe to hit manually:

| Route | Schedule (UTC) | What it does |
| --- | --- | --- |
| `/api/cron/resolve` | `0 22 * * 1-5` | Snapshots every token's quote, scores the slate that snapshot completes, updates streaks, settles finished seasons, then locks tomorrow's board and opens the next |
| `/api/cron/slate` | `30 22 * * 1-5` | The catch-up run: the same job again, a no-op when the first succeeded |

`CRON_SECRET` must be set in production; without it the routes refuse to run
outside development.

A call resolves on **this snapshot versus the previous trading day's snapshot**,
both the mid of Robinhood's own bid/ask at 22:00 UTC. A ticker is voided rather
than guessed at when a corporate action landed in the window, when it was
halted, when its Chainlink feed disagrees beyond tolerance, or when the spread
is too wide to call mid a price. If fewer than seven of a player's ten calls are
scoreable, the whole slate voids and their streak is preserved.

## Running locally

```bash
pnpm install
cp .env.local.example .env.local   # fill in what you have
pnpm dev
```

The app runs with **no keys configured**. Without `NEXT_PUBLIC_PRIVY_APP_ID` it uses a
local demo login, and without Supabase credentials it reads and writes a browser-local
slate so the full pick-10-and-submit loop is still exercisable. Both fallbacks announce
themselves in the UI and are development-only.

## Build status

- [x] Prompt 0 — scaffold, chain config, spec files
- [x] Prompt 1 — design system + app shell
- [x] Prompt 2 — Privy auth + embedded wallet
- [x] Prompt 3 — Supabase schema + RLS
- [x] Prompt 4 — Play tab
- [x] Prompt 5 — resolution engine
- [x] Prompt 6 — Leaderboard tab
- [x] Prompt 7 — contracts
- [x] Prompt 8 — wallet connect + Rewards claim flow
- [x] Prompt 9 — Learn tab rewards
- [x] Prompt 10 — share cards + X intents
- [x] Prompt 11 — anti-sybil, deadlines, scheduling
- [x] Prompt 12 — deploy prep ([DEPLOY.md](./DEPLOY.md))
- [x] Prompt 13 — full ~194-token universe, resolved off Robinhood quotes
- [x] Prompt 14 — stock detail with a real chart and clickable news
- [x] Prompt 15 — Holdings: what the player actually owns, read from the chain
- [x] Prompt 16 — guided first run, in the Learn tab, ending on what they own
- [x] Prompt 17 — gasless claims through a sponsored smart account
- [x] Prompt 18 — the adoption view at `/admin/metrics`

Prompt 12 is prepared rather than executed: deploying needs your Vercel,
Supabase, Privy, Alchemy and X accounts. `DEPLOY.md` is the runbook and carries
the smoke-test checklist.
