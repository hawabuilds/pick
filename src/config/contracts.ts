import type { Address } from "viem";

/**
 * Deployed addresses, read from the environment so the same build can point at
 * a fresh testnet deployment without a code change. `contracts/script/Deploy.s.sol`
 * prints these lines ready to paste into `.env.local`.
 */
function address(value: string | undefined): Address | null {
  if (!value) return null;
  const trimmed = value.trim();
  return /^0x[0-9a-fA-F]{40}$/.test(trimmed) ? (trimmed as Address) : null;
}

export const CLAIM_DISTRIBUTOR_ADDRESS = address(
  process.env.NEXT_PUBLIC_CLAIM_DISTRIBUTOR_ADDRESS,
);
export const DIVIDEND_TRACKER_ADDRESS = address(
  process.env.NEXT_PUBLIC_DIVIDEND_TRACKER_ADDRESS,
);
export const TOKEN_ADDRESS = address(process.env.NEXT_PUBLIC_TOKEN_ADDRESS);
export const QUOTE_TOKEN_ADDRESS = address(
  process.env.NEXT_PUBLIC_QUOTE_TOKEN_ADDRESS,
);

/** Claims can only be sent once the distributor address is known. */
export const isChainConfigured = CLAIM_DISTRIBUTOR_ADDRESS !== null;

/**
 * The tickers the contracts will actually pay out in. This is deliberately
 * narrower than the pick universe: each one needs a deployed testnet token that
 * the distributor has allowlisted.
 */
export const REWARD_TICKERS = ["TSLA", "AMZN", "PLTR", "NFLX", "AMD"] as const;

export type RewardTicker = (typeof REWARD_TICKERS)[number];

/**
 * Display names for the reward allowlist only.
 *
 * The pick universe is fetched from Robinhood's asset registry on the server
 * and is far too large to ship to the browser. These five are the exception:
 * the claim sheet needs to label them before any network call resolves.
 */
export const REWARD_TICKER_NAMES: Record<RewardTicker, string> = {
  TSLA: "Tesla",
  AMZN: "Amazon",
  PLTR: "Palantir Technologies",
  NFLX: "Netflix",
  AMD: "AMD",
};

/**
 * Reward token addresses, supplied as a JSON map so a new deployment needs one
 * env var rather than five.
 *
 * NEXT_PUBLIC_REWARD_TOKENS={"TSLA":"0x...","AMZN":"0x..."}
 */
export const REWARD_TOKEN_ADDRESSES: Partial<Record<RewardTicker, Address>> =
  (() => {
    const raw = process.env.NEXT_PUBLIC_REWARD_TOKENS;
    if (!raw) return {};

    try {
      const parsed = JSON.parse(raw) as Record<string, string>;
      const out: Partial<Record<RewardTicker, Address>> = {};
      for (const ticker of REWARD_TICKERS) {
        const found = address(parsed[ticker]);
        if (found) out[ticker] = found;
      }
      return out;
    } catch {
      // A malformed map must not take the whole app down; the Rewards tab
      // degrades to "not configured" instead.
      return {};
    }
  })();

export function rewardTokenAddress(ticker: string): Address | null {
  return REWARD_TOKEN_ADDRESSES[ticker as RewardTicker] ?? null;
}

/** Reward tickers that actually have a token deployed behind them. */
export function claimableTickers(): RewardTicker[] {
  return REWARD_TICKERS.filter((ticker) => REWARD_TOKEN_ADDRESSES[ticker]);
}
