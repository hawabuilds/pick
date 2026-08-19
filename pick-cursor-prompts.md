# Pick — Full Build Prompt Pack for Cursor

A complete, ordered set of prompts to build the app end-to-end on **Robinhood Chain testnet**.
Paste one prompt at a time into Cursor, review + run + test the output, commit, then move to the next.
("Pick" is the working name — find/replace if it changes.)

---

## Stack (what these prompts assume)

- **Frontend:** Next.js 14 (App Router) + TypeScript + Tailwind CSS → deploy on Vercel
- **Auth + embedded wallet:** Privy (X/Twitter login, auto-provisioned embedded wallet)
- **External wallets + contract calls:** wagmi + viem + Reown AppKit (WalletConnect)
- **Backend / DB:** Supabase (Postgres + Row Level Security + Edge Functions + cron)
- **Contracts:** Foundry (Solidity) → Robinhood Chain testnet
- **Market data (resolution):** a stock API (Polygon.io, Finnhub, or Alpha Vantage) — official closing prices
- **Chain:** Robinhood Chain testnet — chainId **46630**, RPC `https://rpc.testnet.chain.robinhood.com`, explorer `explorer.testnet.chain.robinhood.com`, faucet at `faucet.testnet.chain.robinhood.com` (gives test ETH + test Stock Tokens: TSLA, AMZN, PLTR, NFLX, AMD)

## Prerequisites before you start
Node 20+, pnpm, Foundry, and accounts/keys for: Vercel, Supabase, Privy, Reown (WalletConnect Cloud), a market-data API, and a funded testnet wallet (faucet).

## Honest guardrails (keep these true through the whole build)
- **Free to play. No betting, no staking, no wagering** anywhere — it's a product principle.
- **Contracts move value → test hard on testnet and get a professional audit before mainnet.** The tax/dividend math is bug-prone; don't ship it to anything real unaudited.
- **Resolve picks off the real stock's official close**, never the on-chain token price (thin pools are manipulable).
- **Real RWA swaps need a DEX with testnet liquidity.** If none exists yet, use the quote-asset/stub path (Prompt 7) and wire real swaps later.
- Do each prompt, then actually run and test it before moving on. Don't batch.

---

## Prompt 0 — Scaffold + project rules

```
Set up a new project called "pick".

1. Scaffold Next.js 14 with the App Router, TypeScript, Tailwind CSS, and ESLint. Use pnpm.
2. Install: @privy-io/react-auth, wagmi, viem, @reown/appkit, @reown/appkit-adapter-wagmi, @supabase/supabase-js, @tanstack/react-query, zod.
3. Create this folder structure: src/app, src/components, src/lib, src/hooks, src/config, contracts/ (Foundry lives here later).
4. Create a .env.local.example with placeholders for: NEXT_PUBLIC_PRIVY_APP_ID, NEXT_PUBLIC_REOWN_PROJECT_ID, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, MARKET_DATA_API_KEY, NEXT_PUBLIC_RH_TESTNET_RPC.
5. Create src/config/chain.ts defining the Robinhood Chain testnet as a viem chain: id 46630, name "Robinhood Chain Testnet", rpc https://rpc.testnet.chain.robinhood.com, blockExplorer https://explorer.testnet.chain.robinhood.com, native currency ETH.
6. Create a PROJECT.md at the repo root AND a .cursorrules file that both contain the app spec below, so every future prompt has context.

APP SPEC:
Pick is a free-to-play prediction game on Robinhood Chain that onboards everyday users into holding real-world assets (RWA). Users log in with X (an embedded wallet is created for them). Each day they call "up" or "down" on exactly 10 of ~193 tokenized RWA stocks; the slate is submitted for the NEXT trading day and locks at market open. Correct calls earn points; a leaderboard ranks players and resets on a season cadence (start at 3-day, later daily). Top 20 earn RWA rewards; winners choose which stock to be paid in. A separate passive path: a fee-on-transfer token (3% buy/3% sell) splits tax 40% to holders as RWA dividends (passive, claim anytime), 40% to leaderboard winners, 20% to new users who complete learn-to-earn tasks ($10 to the first 50 new users per season, once per account, must share completion on X). Rewards are claimed in the Rewards tab after connecting a wallet (MetaMask, Rabby, Coinbase, WalletConnect/Reown); on claim the user picks which RWA stock to receive, then gets a shareable card. Hard rules: NO betting/staking/wagering; resolve off official closing prices; one X account per player (min account age) to fight sybil; premium clean white UI with Manrope font and Robinhood green #00C805, four bottom tabs: Play, Leaderboard, Rewards, Learn; mobile-first.

Output the scaffold, the config file, and both spec files. Do not build features yet.
```

---

## Prompt 1 — Design system + app shell (UI)

```
Build the UI shell and design system for Pick, mobile-first, matching this design language:
- Theme: premium white. Background near-white with a faint green radial glow. Cards are white with a hairline border rgba(11,15,12,0.09), radius ~16-20px, soft shadows.
- Font: Manrope (weights 400-800) via next/font. Ink #0B0F0C, muted #5C665F, faint #8A938C.
- Accent: Robinhood green #00C805 (deep variant #068A3A for text on white), red #FF5A52 for "down"/losses.
- Tabular figures for all numbers.
- Logo: a green rounded-square tile with a white arrow, next to the wordmark "Pick".

Create:
1. A responsive app layout: full-bleed on phones, centered ~430px "app" frame on desktop (min-width 600px), with a fixed bottom tab bar.
2. Bottom TabBar with four tabs (Play, Leaderboard, Rewards, Learn) and line-icon SVGs; active tab in green.
3. Reusable components: Card, Sheet (bottom sheet), Modal (centered), Button (primary dark, green, ghost), StockCard (ticker bold, company name, colored sparkline, price, % change, Up/Down buttons), SearchBar, SegmentedToggle (grid/list), Avatar, ShareCard.
4. Route the four tabs as client components with placeholder content for now.
5. Respect safe-area insets on the tab bar and any fixed bars; support prefers-reduced-motion.

Use Tailwind + a small set of CSS variables for the tokens. No emojis anywhere — use SVG line icons.
Acceptance: it looks clean and premium on a 390px-wide phone, tabs switch, and the components are reusable.
```
Reference: your existing `tell-preview.html` is the visual source of truth — tell Cursor to match it.

---

## Prompt 2 — Auth + embedded wallet (Privy)

```
Integrate Privy for auth and embedded wallets.
1. Wrap the app in PrivyProvider configured for: login method = Twitter (X) only; create an embedded wallet automatically on first login; appId from NEXT_PUBLIC_PRIVY_APP_ID.
2. Build the login screen (unauthenticated state): the premium white hero with the Pick logo top-left, headline "Making RWA global for all", a one-line subtitle, and a "Join us" button.
3. "Join us" opens a centered modal "Log in or create an account" with a "Continue with X" button (primary) and "Create an account" — both call Privy login. Include a small terms/privacy line (link to /terms and /privacy).
4. On successful login, route to the dashboard (the 4-tab shell). Show the user's X display name and pfp; a profile avatar top-right opens a menu with "Log out".
5. Create src/hooks/useUser.ts exposing the Privy user, X handle, display name, pfp, and embedded wallet address.
6. On first login, upsert the user into Supabase (we'll define the table next) — stub the call for now behind src/lib/user.ts.
Acceptance: I can log in with X, land on the dashboard, see my pfp/name, and log out.
```

---

## Prompt 3 — Database schema (Supabase)

```
Design and create the Supabase Postgres schema for Pick as SQL migrations, with Row Level Security.

Tables:
- users: id (uuid, pk), x_id (unique), handle, display_name, pfp_url, embedded_wallet, connected_wallet, x_account_created_at, created_at.
- stocks: ticker (pk), name, rh_token_address, active (bool), sort.  (~193 rows; seed with the testnet stock tokens TSLA/AMZN/PLTR/NFLX/AMD plus others as placeholders.)
- daily_slates: slate_date (pk, the trading day the picks are FOR), tickers (text[]), locks_at (timestamptz = market open), resolved (bool).
- picks: id, user_id (fk), slate_date (fk), ticker, direction ('up'|'down'), created_at. Constraints: unique(user_id, slate_date, ticker); a user may have at most 10 rows per (user_id, slate_date); a submission is only "counted" when exactly 10 exist and it's locked in.
- submissions: user_id, slate_date, submitted_at, counted (bool). One per user per slate.
- scores: user_id, slate_date, correct_count, points; unique(user_id, slate_date).
- streaks: user_id (pk), current, longest, last_played_date.
- seasons: id, starts_at, ends_at, cadence ('3day'|'daily').
- leaderboard is a view: sum points per user within the active season, ranked.
- claims: id, user_id, type ('leaderboard'|'welcome'), amount_usd, stock_ticker, tx_hash, status ('pending'|'confirmed'), created_at.
- learner_progress: user_id (pk), tasks_done (int), shared_on_x (bool), rewarded (bool), reward_slate.

RLS: users can read/write only their own picks/submissions/claims/progress; leaderboard + slates + stocks are readable by all authenticated users; service role bypasses for cron.
Add helpful indexes. Output the migration SQL and a seed script for stocks + one open daily_slate.
Acceptance: migrations apply cleanly; RLS prevents reading another user's picks.
```

---

## Prompt 4 — Play tab: daily slate, pick 10, submit

```
Build the Play tab against the Supabase schema.
1. Header: "Hello, {display_name}". Below it a search bar ("Search 193 RWA stocks") that filters live by ticker/name, and a grid/list layout toggle.
2. Load the active daily_slate's stocks and render StockCards (grid default). Tapping a card (not the buttons) opens a stock detail bottom sheet with a price chart (timeframe tabs) and a "Latest news" list — pull price history + headlines from the market-data API; if unavailable, show a graceful placeholder.
3. Up/Down on a card records a pick locally. Enforce EXACTLY 10 selections: a sticky bottom bar shows "x/10"; it's disabled until 10, then becomes "Lock in tomorrow's calls". Tapping a selected direction again frees the slot. Block an 11th selection with a subtle nudge.
4. On submit: write the 10 picks + a submission row to Supabase (only if not past locks_at), mark counted=true, and show a share card of the 10 picks (Prompt 10).
5. If the user already submitted for the next slate, show a read-only "locked" state with their picks and a countdown to resolution.
Acceptance: I can pick exactly 10, submit, see them persisted, and can't submit after lock or submit a partial slate.
```

---

## Prompt 5 — Resolution engine (scheduled)

```
Build the resolution job as a Supabase Edge Function (or Vercel Cron route) that runs after US market close.
1. For each daily_slate where locks_at has passed and resolved=false: fetch the OFFICIAL closing price and prior close for each ticker from the market-data API. Determine up/down per stock (close vs prior close). Do NOT use any on-chain token price.
2. Score every user's picks: 1 point per correct call; write scores rows; update streaks (increment if they submitted a counted slate, reset on a missed day; allow one streak-freeze per user).
3. Recompute the leaderboard view for the active season.
4. Mark the slate resolved=true. Handle non-trading days/holidays (skip; don't create or resolve a slate).
5. Create the NEXT trading day's slate (pick the day's tickers) so the Play tab always has an open slate.
Add a second scheduled job that creates the daily slate and sets locks_at to the next market open (US/Eastern).
Acceptance: after a slate's date passes, scores + leaderboard update correctly and a new open slate exists.
```

---

## Prompt 6 — Leaderboard tab

```
Build the Leaderboard tab.
1. Header "Leaderboard" + season reset countdown.
2. Rows from the leaderboard view: rank number, profile image (X pfp), display name, @handle beneath, and points on the right — nothing else. Highlight the current user's own row.
3. Support the season cadence (3-day at launch, switchable to daily) and show which season/window is active.
4. Paginate or virtualize for large boards.
Acceptance: the board reflects resolved scores and my row is highlighted at my rank.
```

---

## Prompt 7 — Smart contracts (Foundry)

```
In contracts/, set up Foundry and implement the token + rewards contracts for Robinhood Chain testnet (chainId 46630). Use Solidity ^0.8.20 and OpenZeppelin.

Contracts:
1. SplitTaxToken (ERC20, Ownable, ReentrancyGuard): fixed supply, no mint after deploy; 3% buy / 3% sell fee with a MAX_TOTAL_FEE_BPS hard cap (<=10%) so it can't become a honeypot; fee exemptions; AMM-pair detection for buy/sell. On swapback, swap collected fees to a quote token and split 40/40/20 into (a) the dividend tracker, (b) a leaderboard vault address, (c) a learner vault address.
2. RWADividendTracker: magnified-dividend accounting (the established Dividend-Paying Token pattern — base it on an audited implementation, don't hand-roll the magnitude math). Holders accrue quote-denominated dividends by balance; claim() pays quote; claimAsRWA(token, minOut) swaps into an ALLOWLISTED testnet stock token (TSLA/AMZN/PLTR/NFLX/AMD) at claim. Exclude pairs, the token contract, and the vaults from dividends.
3. ClaimDistributor: lets the backend authorize leaderboard payouts and the $10 welcome reward via a Merkle root (per season) OR an EIP-712 signature from a trusted signer; users claim their entry, choosing which allowlisted RWA stock to receive; emits events; prevents double-claim.

Also: full Foundry tests (fee math, split correctness, dividend accrual/claim, double-claim protection, cap enforcement); a deploy script; and verify on Blockscout (chain-id 46630, --verifier blockscout).

IMPORTANT: If a DEX with testnet liquidity for these tokens isn't available, abstract every swap behind an ISwapRouter interface and provide a MockSwapRouter for tests + testnet, with real slippage guards (amountOutMinimum from an oracle) marked as TODO for mainnet. Add a top-of-file note that this is unaudited and must be audited before mainnet.
Acceptance: forge test passes; contracts deploy to RH testnet and verify; a manual test claim works with the mock router.
```
Your earlier `SplitTaxToken.sol` skeleton is the starting point — tell Cursor to build on it and add the tests + distributor.

---

## Prompt 8 — Wallet connect + Rewards tab claim flow

```
Wire external wallets and build the Rewards tab.
1. Configure wagmi + Reown AppKit for the Robinhood Chain testnet; support MetaMask, Rabby, Coinbase Wallet, and WalletConnect (Reown). Create a connect modal listing these.
2. Rewards tab (clean, professional, no emojis — SVG line icons only):
   - "Available to claim" balance card (sum of claimable).
   - Wallet card: connect CTA when disconnected; when connected, show name + monospace address + disconnect.
   - "Ready to claim" list: ONLY Leaderboard payout and Welcome reward (holder dividends are passive/auto — not shown here). Each with amount + Claim.
   - "History": a grouped ledger card with date, which stock it paid in, and amount.
3. Claim flow: Claim requires a connected wallet (open connect modal first if needed). Then open a bottom sheet to SEARCH/SELECT which RWA stock to receive it in; confirm calls ClaimDistributor.claim(...) (or dividendTracker.claimAsRWA for holder path) with the chosen token; on success show a flex share card ("Claimed $X in TSLA") with a "Share on X" button, and move the item into History.
4. Read claim history from chain events + the claims table.
Acceptance: connect a testnet wallet, claim a seeded leaderboard payout in a chosen stock, see the tx confirm and the item move to history.
```

---

## Prompt 9 — Learn tab + learner rewards

```
Build the Learn tab and the learner reward.
1. Learn tab: a "+$10 — earn your first real stock" hero and three short lessons (What is an RWA?, How calls & the leaderboard work, Make your first call) each with a quick check question.
2. On completing all three AND sharing completion on X (verify the post is live via the X API before rewarding), mark learner_progress. Reward: $10 in a stock the user picks (reuse the claim/stock-select flow), paid from the founder-funded learner vault, to the FIRST 50 new users per season, once per account.
3. Anti-farm gates: require an aged X account (min age), one reward per X account, and require the user to have submitted at least one real slate before the reward unlocks. Cap at 50/season; roll unspent forward.
Acceptance: a fresh eligible account can complete lessons, share, and receive a $10 stock reward exactly once; the 51st is waitlisted.
```

---

## Prompt 10 — Share cards + X intents

```
Build the two share cards.
1. Post-submit card: a branded dark card showing the user's 10 picks with up/down, plus a "Share on X" button that opens an X intent with text: "these are my 10 picks for tomorrow. Head over to pick.[tld] to play for the chance to earn some RWA." (use the final domain).
2. Post-claim card: "Claimed $X in {TICKER}" with a green check, "Share on X" (text: "I just claimed $X of {TICKER} on Pick. Play at pick.[tld] to earn RWA.").
3. For real image attachments, generate the card image server-side with @vercel/og (satori) at /api/share-image so the tweet can include a proper image, not just text.
Acceptance: sharing opens X prefilled; the OG endpoint returns a clean branded PNG of the card.
```

---

## Prompt 11 — Anti-sybil, deadlines, scheduling

```
Harden the game.
1. One X account per player: reject signups from X accounts below a minimum age; one embedded wallet per X id; one connected external wallet per user.
2. Rate-limit pick submission and reward claims.
3. Slate timing in US/Eastern: create the next slate daily, set locks_at to the next market open, resolve after close; never open slates on holidays/weekends.
4. Add basic abuse logging and a server-side check that a submission has exactly 10 picks and beat the lock.
Acceptance: a brand-new/young X account can't farm rewards; picks can't be submitted or changed after lock.
```

---

## Prompt 12 — Deploy

```
Ship it to testnet.
1. Deploy the Next.js app to Vercel; set all env vars (Privy, Reown, Supabase, market-data key, contract addresses, RH testnet RPC).
2. Run Supabase migrations + seeds on the prod project; schedule the slate-creation and resolution jobs.
3. Put the deployed contract addresses (token, dividend tracker, claim distributor, vaults) into env; confirm the frontend reads them.
4. Do a full smoke test of the loop: log in with X → pick 10 → submit → (fast-forward/resolve) → leaderboard updates → connect wallet → claim a reward in a chosen stock → share.
Acceptance: a fresh user can run the entire loop on testnet from the deployed URL.
```

---

## Suggested order & realistic sequencing
0 → 1 → 2 → 3 → 4 → 10 (share) gives you a **playable, deployable core** first.
Then 5 → 6 (resolution + leaderboard make it a real game).
Then 7 → 8 → 9 (contracts + claims + learn-to-earn) — the deep end; budget the most time here.
11 → 12 to harden and ship.

If a full day is the target, do 0-4 + 10 + 12 with stubbed scores/rewards, and treat 5-9 as the following days.

## Before mainnet (not testnet)
Professional audit of all three contracts; real DEX liquidity + oracle-based slippage guards; legal review of the reward mechanics (the passive holder-dividend path is the securities-sensitive one); and your own terms/privacy pages replacing the placeholders.
