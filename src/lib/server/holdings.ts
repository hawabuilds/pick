import { createPublicClient, http, type Address } from "viem";
import {
  RH_MAINNET_ID,
  RH_TESTNET_ID,
  robinhoodMainnet,
  robinhoodTestnet,
} from "@/config/chain";
import { REWARD_TOKEN_ADDRESSES } from "@/config/contracts";
import { db, hasDatabase } from "./db";
import { fetchAllQuotes } from "./rhprices";
import { getStockMap } from "./universe";

/**
 * What the player actually owns.
 *
 * This is the point of the whole product, so it is read from the chain rather
 * than from our own records: the database says what we paid out, the chain says
 * what they hold. If those ever disagree the chain is right.
 *
 * Balances come from two places. Reward claims settle in testnet mocks until the
 * contracts are audited, and the real Stock Tokens only exist on mainnet, so
 * both are read and each holding carries the chain it lives on.
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

export type EarnedVia = "leaderboard" | "welcome" | "held";

export interface Holding {
  ticker: string;
  name: string;
  logoUrl: string | null;
  /** Whole tokens held, already scaled out of wei. */
  quantity: number;
  /** Underlying shares the tokens represent. */
  shares: number;
  pricePerShare: number | null;
  valueUsd: number | null;
  tokenAddress: string;
  chainId: number;
  earnedVia: EarnedVia;
}

export interface HoldingsSummary {
  wallet: string;
  holdings: Holding[];
  totalUsd: number;
  /** True when a balance was read but no price was available to value it. */
  partiallyValued: boolean;
}

function isAddress(value: string): value is Address {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

/**
 * How each ticker came to be owned, for the provenance tag.
 *
 * Only confirmed claims count. A pending one has not landed on chain, so the
 * balance it would explain is not there to be tagged yet.
 */
async function earnedVia(userId: string | null): Promise<Map<string, EarnedVia>> {
  const out = new Map<string, EarnedVia>();
  if (!userId || !hasDatabase) return out;

  const { data } = await db()
    .from("claims")
    .select("stock_ticker, type, created_at")
    .eq("user_id", userId)
    .eq("status", "confirmed")
    .order("created_at", { ascending: true });

  for (const row of data ?? []) {
    const ticker = row.stock_ticker as string | null;
    if (!ticker) continue;
    // Earliest claim wins: the first way they came to own it is the story.
    if (!out.has(ticker)) {
      out.set(ticker, row.type === "welcome" ? "welcome" : "leaderboard");
    }
  }

  return out;
}

interface TokenRef {
  ticker: string;
  address: Address;
  chainId: number;
  decimals: number;
  /** Shares per token. Testnet mocks are 1:1 by construction. */
  multiplier: number;
}

async function readBalances(
  wallet: Address,
  tokens: TokenRef[],
  chainId: number,
): Promise<Map<string, bigint>> {
  const out = new Map<string, bigint>();
  if (tokens.length === 0) return out;

  const client = createPublicClient({
    chain: chainId === RH_MAINNET_ID ? robinhoodMainnet : robinhoodTestnet,
    transport: http(undefined, { batch: true, retryCount: 2 }),
  });

  const contracts = tokens.map((token) => ({
    address: token.address,
    abi: ERC20_ABI,
    functionName: "balanceOf" as const,
    args: [wallet] as const,
  }));

  // Testnet has no Multicall3 deployment, so fall back to batched RPC calls
  // there rather than failing the whole view.
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

  results.forEach((result, i) => {
    if (result.status !== "success") return;
    const balance = result.result as bigint;
    if (balance > 0n) out.set(tokens[i].ticker, balance);
  });

  return out;
}

export async function getHoldings(
  wallet: string,
  userId: string | null,
): Promise<HoldingsSummary> {
  if (!isAddress(wallet)) {
    return { wallet, holdings: [], totalUsd: 0, partiallyValued: false };
  }

  const [universe, quotes, provenance] = await Promise.all([
    getStockMap().catch(() => new Map()),
    fetchAllQuotes().catch(() => new Map()),
    earnedVia(userId),
  ]);

  const mainnetTokens: TokenRef[] = [...universe.values()]
    .filter((stock) => stock.rhTokenAddress && isAddress(stock.rhTokenAddress))
    .map((stock) => ({
      ticker: stock.ticker,
      address: stock.rhTokenAddress as Address,
      chainId: RH_MAINNET_ID,
      decimals: stock.decimals,
      multiplier: Number(stock.multiplier) || 1,
    }));

  const testnetTokens: TokenRef[] = Object.entries(REWARD_TOKEN_ADDRESSES)
    .filter(([, address]) => address && isAddress(address))
    .map(([ticker, address]) => ({
      ticker,
      address: address as Address,
      chainId: RH_TESTNET_ID,
      decimals: 18,
      multiplier: 1,
    }));

  const [mainnetBalances, testnetBalances] = await Promise.all([
    readBalances(wallet, mainnetTokens, RH_MAINNET_ID).catch(() => new Map()),
    readBalances(wallet, testnetTokens, RH_TESTNET_ID).catch(() => new Map()),
  ]);

  const holdings: Holding[] = [];
  let partiallyValued = false;

  const collect = (tokens: TokenRef[], balances: Map<string, bigint>) => {
    for (const token of tokens) {
      const raw = balances.get(token.ticker);
      if (!raw) continue;

      const quantity = Number(raw) / 10 ** token.decimals;
      const shares = quantity * token.multiplier;
      const price = quotes.get(token.ticker)?.mid ?? null;

      if (price === null) partiallyValued = true;

      holdings.push({
        ticker: token.ticker,
        name: universe.get(token.ticker)?.name ?? token.ticker,
        logoUrl: universe.get(token.ticker)?.logoUrl ?? null,
        quantity,
        shares,
        pricePerShare: price,
        valueUsd: price === null ? null : shares * price,
        tokenAddress: token.address,
        chainId: token.chainId,
        earnedVia: provenance.get(token.ticker) ?? "held",
      });
    }
  };

  collect(mainnetTokens, mainnetBalances);
  collect(testnetTokens, testnetBalances);

  holdings.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));

  return {
    wallet,
    holdings,
    totalUsd: holdings.reduce((sum, h) => sum + (h.valueUsd ?? 0), 0),
    partiallyValued,
  };
}
