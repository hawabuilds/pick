# Pick contracts

Solidity for the Robinhood Chain testnet (chainId **46630**). Three contracts:

| Contract | What it does |
| --- | --- |
| `SplitTaxToken` | Fixed-supply ERC20 with a 3% buy / 3% sell fee. On swapback the collected fees are sold for the quote asset and split **40% holder dividends / 40% leaderboard vault / 20% learner vault**. |
| `RWADividendTracker` | Accrues quote-denominated dividends to holders by balance. `claim()` pays the quote asset; `claimAsRWA(token, minOut)` swaps into an allowlisted tokenized stock at claim time. |
| `ClaimDistributor` | Pays leaderboard prizes and the $10 welcome reward. The backend authorises either by publishing a per-season Merkle root or by signing an EIP-712 message. Users pick which allowlisted stock to be paid in. |

> **These contracts are unaudited.** They are written for a testnet game with
> valueless mock tokens. Do not deploy them anywhere real value exists without a
> professional audit. See [Before mainnet](#before-mainnet).

## Setup

Foundry is required. If `forge` is not on your PATH, install it from
<https://getfoundry.sh> (on Windows, the release zip at
`foundry-rs/foundry` unpacks straight into a folder you can add to PATH).

Dependencies are vendored rather than tracked as git submodules:

```bash
pnpm contracts:install    # from the repo root
```

That pins OpenZeppelin 5.7.0, forge-std 1.16.2 and ds-test into `contracts/lib`.

## Test

```bash
cd contracts
forge test          # 61 tests
forge test -vvv     # with traces
forge lint src
```

The suite covers fee maths on buys and sells, fee exemptions, the 10% fee cap
(including a fuzz test that no owner input can ever exceed it), supply
immutability, the 40/40/20 split, dividend accrual and correction on transfer,
double-claim protection on both the tracker and the distributor, Merkle proof
forgery, EIP-712 replay and expiry, and the oracle slippage floor — including
that a caller passing `minOut = 0` still cannot be sandwiched, that stale or
non-positive answers are refused, and that a sequencer outage blocks claims.

## Deploy

```bash
cd contracts
export PRIVATE_KEY=0x...          # deployer, funded from the RH testnet faucet
export LEADERBOARD_VAULT=0x...    # optional, defaults to the deployer
export LEARNER_VAULT=0x...        # optional, defaults to the deployer
export TRUSTED_SIGNER=0x...       # backend signer for EIP-712 claims

forge script script/Deploy.s.sol:Deploy \
  --rpc-url rh_testnet --broadcast \
  --verify --verifier blockscout \
  --verifier-url https://explorer.testnet.chain.robinhood.com/api
```

The script writes `contracts/deployments/46630.json` and prints the environment
variables to paste into `.env.local`. It also seeds the distributor with mock
quote tokens so a manual test claim actually pays out.

### Price feeds

Robinhood Chain publishes prices through Chainlink, and `ClaimDistributor` uses
them to bound claim swaps. Feed proxies are read from the environment and are
never hardcoded, because Chainlink's directory is the source of truth for which
feeds exist on a given chain:

| Variable | Meaning |
| --- | --- |
| `CHAINLINK_FEED_TSLA` (etc.) | Feed proxy per stock symbol. Unset means that token has no floor. |
| `CHAINLINK_FEED_QUOTE` | Optional feed for the quote asset. Unset treats it as $1. |
| `CHAINLINK_MAX_AGE` | Seconds before an answer is refused. Defaults to 4 days. |
| `SEQUENCER_UPTIME_FEED` | L2 uptime feed. Unset skips the check. |
| `SEQUENCER_GRACE_PERIOD` | Seconds to wait after a sequencer restart. Defaults to 1 hour. |
| `MAX_SLIPPAGE_BPS` | How far below the feed price a swap may land. Defaults to 100 (1%), capped at 1000. |
| `ORACLE_REQUIRED` | When true, a token with no feed cannot be claimed. **Set this on mainnet.** |

Resolve the addresses for this chain from
<https://docs.chain.link/data-feeds/price-feeds/addresses?network=robinhood>.
Feeds are confirmed on Robinhood Chain mainnet (chain 4663); whether they exist
on testnet 46630 has not been verified here, which is why an unset feed degrades
to caller-supplied `minOut` rather than reverting.

`CHAINLINK_MAX_AGE` deliberately defaults to days rather than a feed's
heartbeat. Robinhood's tokenized equity feeds are 24/5 and publish no heartbeat
while the underlying market is closed, so a tight bound would reject every claim
made over a weekend.

## Caveats you should read before touching this

**No DEX has testnet liquidity for these tokens.** Every swap therefore goes
through `ISwapRouter`, and the only implementation is `MockSwapRouter`, which
mints its own output at a fixed rate. It is a stub. When a real router exists,
write an adapter against the same interface and repoint the three contracts with
their `setSwapRouter` calls.

**`ClaimDistributor` derives its own slippage floor; `RWADividendTracker` does
not.** Claims read the reward token's Chainlink feed, convert the quote amount
into an expected output, and require the swap to land within `maxSlippageBps` of
it. A caller-supplied `minOut` can only tighten that floor, never loosen it, so
passing zero is safe. `claimAsRWA` on the tracker is still caller-supplied and
needs the same treatment before mainnet.

**Exclusions are load-bearing.** The AMM pair, the swap router, the vaults, the
distributor and the deployer all hold token balances without being players, so
each is excluded from dividends in the deploy script. Missing one silently
dilutes every real holder — the router in particular, because it holds fee
tokens mid-swap. `test_excludedAccountsHoldNoShares` guards the principle but
cannot know about an address you add later.

**Dividends round down.** The magnified-dividend pattern truncates, so a holder's
share can be a wei or two light and that dust stays in the tracker. This is the
safe direction and `testFuzz_distributionIsNeverOverPaid` pins it down.

## Before mainnet

- Professional audit of all three contracts.
- Real DEX liquidity, `ORACLE_REQUIRED=true`, a configured feed for every reward
  token, and the same oracle floor extended to `RWADividendTracker.claimAsRWA`.
- Legal review of the reward mechanics. The passive holder-dividend path is the
  securities-sensitive one.
- Replace every mock token with the real asset.
