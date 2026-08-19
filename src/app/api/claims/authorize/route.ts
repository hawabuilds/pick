import {NextResponse, type NextRequest} from "next/server";
import {z} from "zod";
import type {Address} from "viem";
import {rewardTokenAddress} from "@/config/contracts";
import {canSignClaims} from "@/lib/server/chain";
import {allow, LIMITS, logAbuse} from "@/lib/server/limits";
import {authorizeClaim} from "@/lib/server/rewards";
import {isResponse, requireUser} from "@/lib/server/session";
import {payoutAddresses} from "@/lib/server/smartAccount";
import {db} from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  claimId: z.string().uuid(),
  ticker: z.string().min(1).max(10),
  wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "invalid wallet address"),
});

export async function POST(request: NextRequest) {
  if (!canSignClaims) {
    return NextResponse.json(
      {error: "On-chain claims are not configured yet."},
      {status: 501},
    );
  }

  const auth = await requireUser(request);
  if (isResponse(auth)) return auth;

  if (!(await allow(LIMITS.authorizeClaim, auth.userId))) {
    await logAbuse({
      kind: "claim_authorize_rate_limited",
      userId: auth.userId,
      request,
    });
    return NextResponse.json(
      {error: "Too many claim attempts. Try again shortly."},
      {status: 429},
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({error: "Invalid request."}, {status: 400});
  }

  const {claimId, ticker, wallet} = parsed.data;

  const tokenAddress = rewardTokenAddress(ticker);
  if (!tokenAddress) {
    return NextResponse.json(
      {error: `${ticker} cannot be paid out yet.`},
      {status: 400},
    );
  }

  // The signature names a recipient, so the wallet must be the one this account
  // has registered. Otherwise a stolen session could redirect the payout.
  const {data: user} = await db()
    .from("users")
    .select("connected_wallet, embedded_wallet")
    .eq("id", auth.userId)
    .maybeSingle();

  // Includes the smart account derived from their embedded wallet, which is
  // where a sponsored claim is delivered. Derived server-side rather than
  // accepted from the client, so this stays a real check.
  const owned = await payoutAddresses({
    embedded: user?.embedded_wallet,
    connected: user?.connected_wallet,
  });

  if (!owned.includes(wallet.toLowerCase())) {
    await logAbuse({
      kind: "claim_wallet_mismatch",
      userId: auth.userId,
      detail: {wallet},
      request,
    });
    return NextResponse.json(
      {error: "Connect this wallet to your account before claiming."},
      {status: 403},
    );
  }

  try {
    const authorization = await authorizeClaim({
      userId: auth.userId,
      claimId,
      ticker,
      tokenAddress,
      wallet: wallet as Address,
    });
    return NextResponse.json(authorization);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not authorize that claim.";
    return NextResponse.json({error: message}, {status: 400});
  }
}
