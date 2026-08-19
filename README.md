# Pick

A free-to-play prediction game on Robinhood Chain that onboards everyday users into
holding real-world assets. Call ten stocks a day, climb the leaderboard, earn RWA.

Read [PROJECT.md](./PROJECT.md) for the full spec, the hard product rules, and the
build order. `tell-preview.html` is the original clickable prototype and the visual
source of truth (it carries the older working name "Tell").

## Quick start

```bash
pnpm install
cp .env.local.example .env.local
pnpm dev
```

Open http://localhost:3000.

**It runs with no keys.** Without `NEXT_PUBLIC_PRIVY_APP_ID` the login is faked
locally; without Supabase credentials your ten calls are kept in the browser. Prices
and the stock universe need no key at all — both come from Robinhood's public `/rhj`
endpoints. Each fallback labels itself in the UI. Fill in the env vars to replace them
one at a time — nothing else has to change.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Dev server |
| `pnpm build` | Production build |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm seed` | Seed stocks, a season, and both slates into Supabase |
| `pnpm verify:calendar` | Check trading days, holidays, DST, and slate timing |
| `pnpm verify:feeds` | Price every token, then cross-check the Chainlink-covered ones |
| `pnpm verify:resolve` | Check the feed guards and every up/down/flat/void rule |
| `pnpm verify:metrics` | Print the adoption numbers and the CSV the export serves |
| `pnpm contracts:install` | Vendor OpenZeppelin, forge-std and ds-test into `contracts/lib` |

Contracts are their own toolchain: `cd contracts && forge test` (46 tests).

## What's built

The build plan in `pick-cursor-prompts.md`, plus the RWA-focus pass that followed
it:

- **Design system and shell** — Manrope, the premium-white tokens, the 430px device
  frame, five bottom tabs, and reusable `Card` / `Sheet` / `Modal` / `Button` /
  `StockCard` / `SearchBar` / `SegmentedToggle` / `Avatar` / `ShareCard`.
- **Auth** — Privy with X as the only login method and an embedded wallet created on
  first login, behind a `Session` abstraction so the demo fallback is a drop-in.
- **Database** — migrations in `supabase/` with RLS, plus triggers that make "exactly
  ten calls, before the lock" a database invariant rather than a UI convention.
- **Play tab** — the live slate, search across all ~194 tokenized stocks, grid/list
  layouts, a stock detail sheet with a real chart and clickable news, exactly-ten
  enforcement, lock-in, and the post-submit share card.
- **Resolution engine** — two Vercel Cron routes that snapshot every token's Robinhood
  quote at 22:00 UTC, score the day against the previous snapshot, update streaks with
  a one-per-player freeze, roll seasons contiguously, and keep both slates on the
  board. A ticker is voided rather than scored when a split or dividend lands in the
  window, when it was halted, when Chainlink disagrees with the quote, or when the
  spread is untradeable; a board with fewer than seven scoreable calls voids outright
  and preserves the streak.
- **Leaderboard** — live season standings with the reset countdown, own-row
  highlighting, a pinned own-row for players ranked off the loaded page, and
  pagination.
- **Contracts** — `SplitTaxToken` (fixed supply, 3/3 fee, capped at 10%, fees
  swapped and split 40/40/20), `RWADividendTracker` (magnified-dividend accrual,
  claim in quote or in a tokenized stock) and `ClaimDistributor` (Merkle root or
  EIP-712 authorisation, one claimed-ledger across both). Foundry, 46 tests, a
  deploy script that writes its addresses out as env lines.
- **Wallet and claims** — wagmi 3 with MetaMask, Rabby, Coinbase Wallet and
  WalletConnect behind a branded connect sheet. Claiming picks a stock, gets a
  server-signed EIP-712 authorisation for that exact wallet and amount, sends
  the transaction, and moves the reward into History with an explorer link.
- **Gasless claims** — ERC-4337 through a SimpleAccount owned by the embedded
  wallet, with Alchemy's gas manager settling the fee. No ETH to hold, no fee to
  see, no prompt to approve. The bundler and paymaster are proxied server-side,
  rate limited, and will only sponsor a call to the claim contract, so the
  policy cannot be drained to fund something else.
- **Holdings** — "What you own" reads balances straight off both chains and
  values them at the live mid, because the database only knows what was paid and
  the chain knows what is still held. Each line says how it was earned.
- **Onboarding** — a brand-new account lands on the Learn tab rather than the
  dashboard, and is walked through it: a welcome, three server-graded lessons
  that lead into one another, the welcome reward, and an ending that points at
  what they now own. The tabs work from the first second, so nobody is trapped
  in a walkthrough they did not ask for.
- **Learn-to-earn** — three lessons with server-graded quick checks, and a $10
  reward gated on account age, a real submitted slate, an X-API-verified share
  post, and a per-season seat cap that rolls unspent seats forward.
- **Adoption metrics** — `/admin/metrics`, behind an X-handle allowlist: how
  many signed up, how many were new to crypto, how many countries, D1 and D7
  retention, what was paid out, and how many people hold a real-world asset
  right now, read from the chain. Exports as JSON or CSV.
- **Share cards** — `/api/share-image` renders branded PNGs with satori, and
  `/share` carries them as Open Graph so a post on X unfurls into the card.
- **Anti-sybil** — Postgres-backed rate limits on every mutating route, one X
  account and one external wallet per player, an account-age gate at signup and
  submission, and an abuse log.

## Deploying

[DEPLOY.md](./DEPLOY.md) walks through contracts, Supabase, keys and Vercel, and
ends with the full smoke-test checklist.

## Chain

Robinhood Chain testnet — chainId 46630, RPC `https://rpc.testnet.chain.robinhood.com`,
explorer `https://explorer.testnet.chain.robinhood.com`. Get test ETH and test stock
tokens (TSLA, AMZN, PLTR, NFLX, AMD) from
`https://faucet.testnet.chain.robinhood.com`.
