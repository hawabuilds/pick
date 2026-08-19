import { createPublicClient, http, type Address } from "viem";
import {
  RH_MAINNET_ID,
  RH_TESTNET_ID,
  robinhoodMainnet,
  robinhoodTestnet,
} from "@/config/chain";
import { rewardTokenAddress } from "@/config/contracts";
import { db, hasDatabase } from "./db";
import { fetchAllQuotes } from "./rhprices";
import { getStockMap } from "./universe";

/**
 * The adoption story, in the numbers that matter.
 *
 * The claim this product makes is that people with no crypto knowledge end up
 * holding real-world assets they self-custody. Two halves prove it, and they are
 * deliberately measured from different places: the database says who signed up,
 * who played and what we paid; the chain says what they still hold. Only the
 * second half is evidence of ownership, so it is read on chain even though it
 * costs a round trip.
 */

const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

/**
 * Balance lookups are one call per wallet-and-token pair. Everyone paid so far
 * fits comfortably; past this the page reports a sample rather than hanging.
 */
const MAX_BALANCE_READS = 1500;

const CACHE_TTL_MS = 5 * 60 * 1000;

export interface Metrics {
  generatedAt: string;
  /** False when the backend is not configured and the shape below is sample data. */
  live: boolean;
  users: {
    total: number;
    onboarded: number;
    newToCrypto: number;
    walletStatusKnown: number;
    /** Share of players whose wallet status we know who were new to crypto. */
    newToCryptoPct: number | null;
    countries: number;
  };
  activity: {
    everPlayed: number;
    dau: number;
    activeWindowDays: number;
    activeInWindow: number;
  };
  retention: {
    d1: number | null;
    d7: number | null;
    d1Eligible: number;
    d7Eligible: number;
  };
  rewards: {
    confirmedClaims: number;
    recipients: number;
    usdDistributed: number;
    distinctTickers: number;
    finishedLessons: number;
    welcomeRewarded: number;
  };
  onChain: {
    /** People holding at least one tokenized share right now. */
    holders: number;
    /** Underlying shares sitting in players' own wallets. */
    shares: number;
    /** Those shares at the current mid price. */
    valueUsd: number;
    walletsChecked: number;
    /** True when the wallet list was capped, so the figures are a floor. */
    sampled: boolean;
    /** Set when the chain could not be reached; the numbers above are then zero. */
    error: string | null;
  };
}

interface RawMetrics {
  generatedAt: string;
  users: {
    total: number;
    onboarded: number;
    newToCrypto: number;
    walletStatusKnown: number;
    countries: number;
  };
  activity: {
    everPlayed: number;
    dau: number;
    activeWindowDays: number;
    activeInWindow: number;
  };
  retention: {
    d1Eligible: number;
    d1Retained: number;
    d7Eligible: number;
    d7Retained: number;
  };
  rewards: Metrics["rewards"] & { usdDistributed: number | string };
}

interface PaidWallet {
  user_id: string;
  wallet: string;
  ticker: string;
  chain_id: number | null;
}

function ratio(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

interface BalanceRead {
  userId: string;
  wallet: Address;
  ticker: string;
  address: Address;
  chainId: number;
  decimals: number;
  multiplier: number;
}

function isAddress(value: string): value is Address {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

async function readChain(
  reads: BalanceRead[],
  chainId: number,
): Promise<bigint[]> {
  if (reads.length === 0) return [];

  const client = createPublicClient({
    chain: chainId === RH_MAINNET_ID ? robinhoodMainnet : robinhoodTestnet,
    transport: http(undefined, { batch: true, retryCount: 2 }),
  });

  const contracts = reads.map((read) => ({
    address: read.address,
    abi: ERC20_ABI,
    functionName: "balanceOf" as const,
    args: [read.wallet] as const,
  }));

  // Mainnet has Multicall3, so a few hundred balances are one request. Testnet
  // does not, and falls back to batched calls rather than losing the numbers.
  const results =
    chainId === RH_MAINNET_ID
      ? await client.multicall({ contracts, allowFailure: true })
      : await Promise.all(
          contracts.map((contract) =>
            client
              .readContract(contract)
              .then((result) => ({ status: "success" as const, result }))
              .catch(() => ({ status: "failure" as const, result: undefined })),
          ),
        );

  return results.map((result) =>
    result.status === "success" ? (result.result as bigint) : 0n,
  );
}

async function onChainHoldings(): Promise<Metrics["onChain"]> {
  const empty = {
    holders: 0,
    shares: 0,
    valueUsd: 0,
    walletsChecked: 0,
    sampled: false,
    error: null as string | null,
  };

  if (!hasDatabase) return empty;

  const { data, error } = await db().rpc("paid_wallets");
  if (error) return { ...empty, error: "Could not list paid wallets." };

  const pairs = (data ?? []) as PaidWallet[];
  if (pairs.length === 0) return empty;

  const sampled = pairs.length > MAX_BALANCE_READS;
  const capped = sampled ? pairs.slice(0, MAX_BALANCE_READS) : pairs;

  const [universe, quotes] = await Promise.all([
    getStockMap().catch(() => new Map()),
    fetchAllQuotes().catch(() => new Map()),
  ]);

  const reads: BalanceRead[] = [];

  for (const pair of capped) {
    if (!isAddress(pair.wallet)) continue;

    // Claims settle in testnet mocks until the contracts are audited, so the
    // token to look up depends on the chain the claim was paid on.
    if (pair.chain_id === RH_TESTNET_ID || pair.chain_id === null) {
      const address = rewardTokenAddress(pair.ticker);
      if (address && isAddress(address)) {
        reads.push({
          userId: pair.user_id,
          wallet: pair.wallet,
          ticker: pair.ticker,
          address,
          chainId: RH_TESTNET_ID,
          decimals: 18,
          multiplier: 1,
        });
      }
      continue;
    }

    const stock = universe.get(pair.ticker);
    if (stock?.rhTokenAddress && isAddress(stock.rhTokenAddress)) {
      reads.push({
        userId: pair.user_id,
        wallet: pair.wallet,
        ticker: pair.ticker,
        address: stock.rhTokenAddress,
        chainId: RH_MAINNET_ID,
        decimals: stock.decimals,
        multiplier: Number(stock.multiplier) || 1,
      });
    }
  }

  const mainnet = reads.filter((read) => read.chainId === RH_MAINNET_ID);
  const testnet = reads.filter((read) => read.chainId === RH_TESTNET_ID);

  let balances: [BalanceRead, bigint][];
  try {
    const [mainnetBalances, testnetBalances] = await Promise.all([
      readChain(mainnet, RH_MAINNET_ID),
      readChain(testnet, RH_TESTNET_ID),
    ]);
    balances = [
      ...mainnet.map((read, i): [BalanceRead, bigint] => [
        read,
        mainnetBalances[i] ?? 0n,
      ]),
      ...testnet.map((read, i): [BalanceRead, bigint] => [
        read,
        testnetBalances[i] ?? 0n,
      ]),
    ];
  } catch {
    return { ...empty, error: "Could not read balances from the chain." };
  }

  const holders = new Set<string>();
  let shares = 0;
  let valueUsd = 0;

  for (const [read, raw] of balances) {
    if (raw <= 0n) continue;

    holders.add(read.userId);

    const held = (Number(raw) / 10 ** read.decimals) * read.multiplier;
    shares += held;

    const price = quotes.get(read.ticker)?.mid ?? null;
    if (price !== null) valueUsd += held * price;
  }

  return {
    holders: holders.size,
    shares,
    valueUsd,
    walletsChecked: new Set(reads.map((read) => read.wallet)).size,
    sampled,
    error: null,
  };
}

function shape(raw: RawMetrics, onChain: Metrics["onChain"]): Metrics {
  return {
    generatedAt: raw.generatedAt,
    live: true,
    users: {
      ...raw.users,
      newToCryptoPct: ratio(raw.users.newToCrypto, raw.users.walletStatusKnown),
    },
    activity: raw.activity,
    retention: {
      d1: ratio(raw.retention.d1Retained, raw.retention.d1Eligible),
      d7: ratio(raw.retention.d7Retained, raw.retention.d7Eligible),
      d1Eligible: raw.retention.d1Eligible,
      d7Eligible: raw.retention.d7Eligible,
    },
    rewards: {
      ...raw.rewards,
      usdDistributed: Number(raw.rewards.usdDistributed) || 0,
    },
    onChain,
  };
}

let cache: { at: number; value: Metrics } | null = null;

export async function getMetrics(force = false): Promise<Metrics> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.value;
  }

  if (!hasDatabase) return demoMetrics();

  const { data, error } = await db().rpc("adoption_metrics", {
    p_active_days: 7,
  });

  if (error || !data) return demoMetrics();

  const value = shape(data as unknown as RawMetrics, await onChainHoldings());
  cache = { at: Date.now(), value };
  return value;
}

/**
 * Shown when the backend is not configured, so the page is still reviewable
 * locally. Marked `live: false` so nobody screenshots it as a real result.
 */
function demoMetrics(): Metrics {
  return {
    generatedAt: new Date().toISOString(),
    live: false,
    users: {
      total: 0,
      onboarded: 0,
      newToCrypto: 0,
      walletStatusKnown: 0,
      newToCryptoPct: null,
      countries: 0,
    },
    activity: { everPlayed: 0, dau: 0, activeWindowDays: 7, activeInWindow: 0 },
    retention: { d1: null, d7: null, d1Eligible: 0, d7Eligible: 0 },
    rewards: {
      confirmedClaims: 0,
      recipients: 0,
      usdDistributed: 0,
      distinctTickers: 0,
      finishedLessons: 0,
      welcomeRewarded: 0,
    },
    onChain: {
      holders: 0,
      shares: 0,
      valueUsd: 0,
      walletsChecked: 0,
      sampled: false,
      error: null,
    },
  };
}

/** Flat key/value rows, which is what a spreadsheet wants. */
export function toCsv(metrics: Metrics): string {
  const rows: [string, string | number][] = [
    ["generated_at", metrics.generatedAt],
    ["live", metrics.live ? "true" : "false"],
    ["users_total", metrics.users.total],
    ["users_onboarded", metrics.users.onboarded],
    ["users_new_to_crypto", metrics.users.newToCrypto],
    ["users_wallet_status_known", metrics.users.walletStatusKnown],
    [
      "users_new_to_crypto_pct",
      metrics.users.newToCryptoPct === null
        ? ""
        : (metrics.users.newToCryptoPct * 100).toFixed(1),
    ],
    ["countries_reached", metrics.users.countries],
    ["players_ever", metrics.activity.everPlayed],
    ["daily_active_players", metrics.activity.dau],
    [`active_last_${metrics.activity.activeWindowDays}_days`, metrics.activity.activeInWindow],
    [
      "retention_d1_pct",
      metrics.retention.d1 === null ? "" : (metrics.retention.d1 * 100).toFixed(1),
    ],
    ["retention_d1_cohort", metrics.retention.d1Eligible],
    [
      "retention_d7_pct",
      metrics.retention.d7 === null ? "" : (metrics.retention.d7 * 100).toFixed(1),
    ],
    ["retention_d7_cohort", metrics.retention.d7Eligible],
    ["claims_confirmed", metrics.rewards.confirmedClaims],
    ["claim_recipients", metrics.rewards.recipients],
    ["usd_distributed", metrics.rewards.usdDistributed.toFixed(2)],
    ["distinct_tickers_paid", metrics.rewards.distinctTickers],
    ["lessons_finished", metrics.rewards.finishedLessons],
    ["welcome_rewards_granted", metrics.rewards.welcomeRewarded],
    ["rwa_holders_onchain", metrics.onChain.holders],
    ["rwa_shares_onchain", metrics.onChain.shares.toFixed(6)],
    ["rwa_value_usd_onchain", metrics.onChain.valueUsd.toFixed(2)],
    ["wallets_checked", metrics.onChain.walletsChecked],
    ["sampled", metrics.onChain.sampled ? "true" : "false"],
  ];

  const escape = (value: string | number) => {
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  return ["metric,value", ...rows.map(([k, v]) => `${escape(k)},${escape(v)}`)].join(
    "\n",
  );
}
