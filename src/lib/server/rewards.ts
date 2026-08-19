import {parseUnits, type Address, type Hex} from "viem";
import {RH_TESTNET_ID} from "@/config/chain";
import {REWARD_KIND, type RewardKindName} from "@/lib/abi";
import {db} from "./db";
import {canSignClaims, signClaim} from "./chain";

/** The mock quote token is 18-decimal, matching the deploy script. */
const QUOTE_DECIMALS = 18;

/** How long a signed authorisation stays valid. Long enough to approve a
 *  transaction in a wallet, short enough that a leaked one expires quickly. */
const AUTHORIZATION_TTL_SECONDS = 15 * 60;

export interface Reward {
  id: string;
  kind: RewardKindName;
  title: string;
  subtitle: string;
  amountUsd: number;
  seasonId: number | null;
}

export interface RewardHistoryItem {
  id: string;
  title: string;
  amountUsd: number;
  ticker: string | null;
  txHash: string | null;
  createdAt: string;
  status: "pending" | "confirmed" | "failed";
}

export interface RewardsState {
  available: Reward[];
  history: RewardHistoryItem[];
  /** False when the contracts or signer key are not wired up yet. */
  claimable: boolean;
}

function title(kind: RewardKindName) {
  return kind === "leaderboard" ? "Leaderboard payout" : "Welcome reward";
}

function subtitle(kind: RewardKindName, seasonId: number | null) {
  if (kind === "welcome") return "Lessons complete";
  return seasonId ? `Season ${seasonId}` : "Last season";
}

interface ClaimRow {
  id: string;
  type: string;
  amount_usd: number | string;
  stock_ticker: string | null;
  tx_hash: string | null;
  status: string;
  season_id: number | null;
  created_at: string;
}

function toNumber(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}

export async function listRewards(userId: string): Promise<RewardsState> {
  const {data, error} = await db()
    .from("claims")
    .select("id, type, amount_usd, stock_ticker, tx_hash, status, season_id, created_at")
    .eq("user_id", userId)
    .order("created_at", {ascending: false});

  if (error) throw error;

  const rows = (data ?? []) as ClaimRow[];

  const available = rows
    .filter((row) => row.status === "available" || row.status === "failed")
    .map<Reward>((row) => ({
      id: row.id,
      kind: row.type as RewardKindName,
      title: title(row.type as RewardKindName),
      subtitle: subtitle(row.type as RewardKindName, row.season_id),
      amountUsd: toNumber(row.amount_usd),
      seasonId: row.season_id,
    }));

  const history = rows
    .filter((row) => row.status === "pending" || row.status === "confirmed")
    .map<RewardHistoryItem>((row) => ({
      id: row.id,
      title: title(row.type as RewardKindName),
      amountUsd: toNumber(row.amount_usd),
      ticker: row.stock_ticker,
      txHash: row.tx_hash,
      createdAt: row.created_at,
      status: row.status as RewardHistoryItem["status"],
    }));

  return {available, history, claimable: canSignClaims};
}

/** Real auth, no rows yet — new accounts and pre-sync sessions. */
export function emptyRewards(): RewardsState {
  return {available: [], history: [], claimable: canSignClaims};
}

/** Shown when Supabase is not configured, so the tab is still explorable. */
export function demoRewards(): RewardsState {
  return {
    available: [
      {
        id: "demo-leaderboard",
        kind: "leaderboard",
        title: "Leaderboard payout",
        subtitle: "Top 20 · last season",
        amountUsd: 12.4,
        seasonId: null,
      },
      {
        id: "demo-welcome",
        kind: "welcome",
        title: "Welcome reward",
        subtitle: "Lessons complete",
        amountUsd: 10,
        seasonId: null,
      },
    ],
    history: [
      {
        id: "demo-h1",
        title: "Leaderboard payout",
        amountUsd: 8.1,
        ticker: "TSLA",
        txHash: null,
        createdAt: "2026-08-12T16:00:00.000Z",
        status: "confirmed",
      },
      {
        id: "demo-h2",
        title: "Leaderboard payout",
        amountUsd: 5.6,
        ticker: "NFLX",
        txHash: null,
        createdAt: "2026-08-09T16:00:00.000Z",
        status: "confirmed",
      },
    ],
    claimable: false,
  };
}

export interface AuthorizedClaim {
  season: string;
  kind: number;
  amount: string;
  deadline: string;
  signature: Hex;
  tokenAddress: Address;
  ticker: string;
}

/**
 * Signs an EIP-712 authorisation for a reward the player is actually owed.
 *
 * Everything the signature commits to is read from the database rather than the
 * request, so a caller cannot inflate the amount, claim someone else's reward or
 * redirect it to another address.
 */
export async function authorizeClaim(options: {
  userId: string;
  claimId: string;
  ticker: string;
  tokenAddress: Address;
  wallet: Address;
}): Promise<AuthorizedClaim> {
  const supabase = db();

  const {data, error} = await supabase
    .from("claims")
    .select("id, type, amount_usd, status, season_id")
    .eq("id", options.claimId)
    .eq("user_id", options.userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("That reward is not yours to claim.");

  // 'pending' is re-authorisable: a player may have closed their wallet before
  // signing. The contract's claimed-ledger is the real double-claim guard.
  if (data.status === "confirmed") {
    throw new Error("That reward has already been claimed.");
  }

  const amountUsd = toNumber(data.amount_usd);
  const kind = REWARD_KIND[data.type as RewardKindName];
  if (kind === undefined) throw new Error("Unknown reward type.");

  const season = BigInt(data.season_id ?? 0);
  const amount = parseUnits(amountUsd.toFixed(2), QUOTE_DECIMALS);
  const deadline = BigInt(
    Math.floor(Date.now() / 1000) + AUTHORIZATION_TTL_SECONDS,
  );

  const signature = await signClaim({
    account: options.wallet,
    season,
    kind,
    amount,
    deadline,
  });

  const {error: updateError} = await supabase
    .from("claims")
    .update({
      status: "pending",
      wallet: options.wallet,
      chain_id: RH_TESTNET_ID,
      stock_ticker: options.ticker,
      token_address: options.tokenAddress,
      authorized_at: new Date().toISOString(),
    })
    .eq("id", options.claimId)
    .eq("user_id", options.userId);

  if (updateError) throw updateError;

  return {
    season: season.toString(),
    kind,
    amount: amount.toString(),
    deadline: deadline.toString(),
    signature,
    tokenAddress: options.tokenAddress,
    ticker: options.ticker,
  };
}

export async function confirmClaim(options: {
  userId: string;
  claimId: string;
  txHash: string;
}): Promise<void> {
  const {error} = await db()
    .from("claims")
    .update({
      status: "confirmed",
      tx_hash: options.txHash,
      confirmed_at: new Date().toISOString(),
    })
    .eq("id", options.claimId)
    .eq("user_id", options.userId);

  if (error) throw error;
}

export async function failClaim(options: {
  userId: string;
  claimId: string;
}): Promise<void> {
  await db()
    .from("claims")
    .update({status: "failed"})
    .eq("id", options.claimId)
    .eq("user_id", options.userId)
    .eq("status", "pending");
}
