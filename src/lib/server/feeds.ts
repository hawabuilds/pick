import { createPublicClient, http, type Address } from "viem";
import { robinhoodMainnet } from "@/config/chain";
import { getStockMap } from "./universe";

/**
 * Chainlink price feeds for Robinhood Stock Tokens, read on-chain.
 *
 * These no longer settle the game — Robinhood's own REST quotes do, because
 * they cover all ~194 tokens rather than the ~34 with a feed. Chainlink is the
 * integrity anchor: an independent, reproducible price for the covered tickers.
 * Where the two disagree beyond tolerance the ticker is voided rather than
 * scored on a number nothing else corroborates.
 *
 * The feed answer is the token's total return value — the underlying share
 * price already multiplied by the corporate-action multiplier — so comparing it
 * against a REST quote means dividing the multiplier back out first.
 *
 * Feed proxy addresses come from Chainlink's reference data directory rather
 * than being hardcoded, because Robinhood's own docs name it the source of
 * truth for addresses, decimals and heartbeats.
 */

const RDD_URL =
  "https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json";

/** Chainlink's grace period convention after a sequencer comes back up. */
const SEQUENCER_GRACE_SECONDS = 3600;

/**
 * How far past a feed's heartbeat a price may be before it is refused. The
 * stock feeds publish on a 0.5% deviation with an 86400s heartbeat, so a quiet
 * name can legitimately be many hours old; this only catches a feed that has
 * actually stopped.
 */
const STALENESS_GRACE_SECONDS = Number(
  process.env.CHAINLINK_STALENESS_GRACE_SECONDS ?? 3600,
);

const sequencerFeed = process.env.CHAINLINK_SEQUENCER_UPTIME_FEED ?? "";

const AGGREGATOR_ABI = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
] as const;

/** Separate ABI so the multicall above stays typed to one return shape. */
const DECIMALS_ABI = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
] as const;

/** Robinhood Stock Tokens expose an advisory pause flag for corporate actions. */
const STOCK_TOKEN_ABI = [
  {
    type: "function",
    name: "oraclePaused",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
] as const;

export interface FeedMeta {
  ticker: string;
  proxy: Address;
  decimals: number;
  heartbeat: number;
}

export interface FeedReading {
  ticker: string;
  /** Total return value of one token, in USD. */
  price: number;
  roundId: bigint;
  updatedAt: Date;
}

export interface ReadingInput {
  answer: bigint;
  updatedAt: bigint;
  heartbeat: number;
  nowSeconds: number;
  paused: boolean;
}

/**
 * Decides whether a single feed reading may be scored on.
 *
 * Pure and exported so the guards can be tested without a chain: the failure
 * modes here are the ones that would quietly corrupt a whole day of results.
 */
export function evaluateReading(
  input: ReadingInput,
): { ok: true } | { ok: false; reason: string } {
  if (input.answer <= 0n) {
    return { ok: false, reason: "non-positive answer" };
  }

  const age = input.nowSeconds - Number(input.updatedAt);
  if (age > input.heartbeat + STALENESS_GRACE_SECONDS) {
    return {
      ok: false,
      reason: `stale by ${age}s against a ${input.heartbeat}s heartbeat`,
    };
  }

  // The pause flag is advisory and not enforced on-chain, so staleness above
  // stays the primary guard; this only catches a corporate action in flight.
  if (input.paused) {
    return { ok: false, reason: "oracle paused" };
  }

  return { ok: true };
}

export interface FeedSnapshot {
  /** Every reading comes from this block, so the whole set is reproducible. */
  blockNumber: bigint;
  capturedAt: Date;
  readings: Map<string, FeedReading>;
  /** Tickers deliberately left out, with the reason. */
  rejected: Array<{ ticker: string; reason: string }>;
  /** False when no sequencer uptime feed is configured to check against. */
  sequencerChecked: boolean;
}

function client() {
  return createPublicClient({
    chain: robinhoodMainnet,
    transport: http(undefined, { batch: true, retryCount: 3 }),
  });
}

function isAddress(value: string): value is Address {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

/**
 * Chainlink names the stock feeds "Robinhood NVDA / USD", except for a handful
 * that come through as "Robinhood DELL-USD". Both reduce to the ticker.
 */
function tickerFromFeedName(name: string): string {
  return name
    .replace(/^Robinhood /, "")
    .replace(/ ?\/ ?USD$/, "")
    .replace(/-USD$/, "")
    .trim();
}

let cache: { at: number; feeds: Map<string, FeedMeta> } | null = null;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** Ticker to feed metadata, for the tickers that have a feed at all. */
export async function loadFeeds(): Promise<Map<string, FeedMeta>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.feeds;

  const res = await fetch(RDD_URL, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Chainlink reference data directory returned ${res.status}`);
  }

  const rows = (await res.json()) as Array<{
    name?: string;
    proxyAddress?: string;
    decimals?: number;
    heartbeat?: number;
  }>;

  const universe = await getStockMap();
  const feeds = new Map<string, FeedMeta>();
  for (const row of rows) {
    if (!row.name?.startsWith("Robinhood ")) continue;
    const ticker = tickerFromFeedName(row.name);
    if (!universe.has(ticker)) continue;
    if (!row.proxyAddress || !isAddress(row.proxyAddress)) continue;
    feeds.set(ticker, {
      ticker,
      proxy: row.proxyAddress,
      decimals: row.decimals ?? 8,
      heartbeat: row.heartbeat ?? 86400,
    });
  }

  if (feeds.size === 0) {
    throw new Error("Chainlink directory returned no Robinhood stock feeds");
  }

  cache = { at: Date.now(), feeds };
  return feeds;
}

/**
 * Refuses to return prices while the sequencer is down or inside its grace
 * period, because feeds go stale during an outage and a stale price would score
 * a whole slate wrongly.
 */
async function assertSequencerUp(): Promise<boolean> {
  if (!isAddress(sequencerFeed)) return false;

  const [, answer, startedAt] = await client().readContract({
    address: sequencerFeed,
    abi: AGGREGATOR_ABI,
    functionName: "latestRoundData",
  });

  if (answer !== 0n) throw new Error("Robinhood Chain sequencer is down");

  const since = Math.floor(Date.now() / 1000) - Number(startedAt);
  if (since <= SEQUENCER_GRACE_SECONDS) {
    throw new Error(
      `Sequencer came back up ${since}s ago; waiting out the ${SEQUENCER_GRACE_SECONDS}s grace period`,
    );
  }

  return true;
}

/**
 * Reads every requested feed at a single block.
 *
 * Pinning the block matters twice over: it keeps a slate internally consistent,
 * and it lets anyone re-run the same call later and get the same numbers, which
 * is the whole argument for settling on-chain prices instead of a vendor's.
 */
export async function readFeedSnapshot(
  tickers?: string[],
): Promise<FeedSnapshot> {
  const feeds = await loadFeeds();
  const universe = await getStockMap();
  const wantedTickers = tickers ?? [...feeds.keys()];
  const rpc = client();

  const sequencerChecked = await assertSequencerUp();
  const blockNumber = await rpc.getBlockNumber();

  const wanted: FeedMeta[] = [];
  const rejected: Array<{ ticker: string; reason: string }> = [];

  for (const ticker of wantedTickers) {
    const meta = feeds.get(ticker);
    if (!meta) {
      rejected.push({ ticker, reason: "no Chainlink feed" });
      continue;
    }
    // Without the token address there is no pause flag to read, and the
    // multicall would be sent to `undefined`.
    if (!universe.get(ticker)?.rhTokenAddress) {
      rejected.push({ ticker, reason: "no token address" });
      continue;
    }
    wanted.push(meta);
  }

  const [rounds, decimals, pauses] = await Promise.all([
    rpc.multicall({
      blockNumber,
      allowFailure: true,
      contracts: wanted.map((meta) => ({
        address: meta.proxy,
        abi: AGGREGATOR_ABI,
        functionName: "latestRoundData",
      })),
    }),
    // Chainlink's guidance is to read decimals rather than assume them, so the
    // directory's value is only a fallback if the call fails.
    rpc.multicall({
      blockNumber,
      allowFailure: true,
      contracts: wanted.map((meta) => ({
        address: meta.proxy,
        abi: DECIMALS_ABI,
        functionName: "decimals",
      })),
    }),
    rpc.multicall({
      blockNumber,
      allowFailure: true,
      contracts: wanted.map((meta) => ({
        address: universe.get(meta.ticker)?.rhTokenAddress as Address,
        abi: STOCK_TOKEN_ABI,
        functionName: "oraclePaused",
      })),
    }),
  ]);

  const capturedAt = new Date();
  const nowSeconds = Math.floor(capturedAt.getTime() / 1000);
  const readings = new Map<string, FeedReading>();

  wanted.forEach((meta, i) => {
    const round = rounds[i];
    if (round.status !== "success") {
      rejected.push({ ticker: meta.ticker, reason: "feed call reverted" });
      return;
    }

    const [roundId, answer, , updatedAt] = round.result;
    const paused = pauses[i];

    const verdict = evaluateReading({
      answer,
      updatedAt,
      heartbeat: meta.heartbeat,
      nowSeconds,
      paused: paused.status === "success" && paused.result === true,
    });

    if (!verdict.ok) {
      rejected.push({ ticker: meta.ticker, reason: verdict.reason });
      return;
    }

    const onChainDecimals = decimals[i];
    const scale =
      onChainDecimals.status === "success"
        ? Number(onChainDecimals.result)
        : meta.decimals;

    readings.set(meta.ticker, {
      ticker: meta.ticker,
      price: Number(answer) / 10 ** scale,
      roundId,
      updatedAt: new Date(Number(updatedAt) * 1000),
    });
  });

  return { blockNumber, capturedAt, readings, rejected, sequencerChecked };
}
