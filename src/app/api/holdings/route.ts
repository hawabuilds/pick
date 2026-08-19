import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getPrivyId, hasPrivyServerAuth } from "@/lib/server/auth";
import { db, hasDatabase } from "@/lib/server/db";
import { getHoldings } from "@/lib/server/holdings";
import { getUserId } from "@/lib/server/play";
import { payoutAddresses } from "@/lib/server/smartAccount";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  wallet: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "Not a wallet address.")
    .optional(),
});

/**
 * Every address this player could be holding at, so a signed-in user needs no
 * query parameter. Includes the smart account, which is where a sponsored claim
 * is delivered and therefore where most players' assets actually are.
 */
async function walletsFor(userId: string): Promise<string[]> {
  const { data } = await db()
    .from("users")
    .select("embedded_wallet, connected_wallet")
    .eq("id", userId)
    .maybeSingle();

  return payoutAddresses({
    embedded: data?.embedded_wallet,
    connected: data?.connected_wallet,
  });
}

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({
    wallet: request.nextUrl.searchParams.get("wallet") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Bad request." },
      { status: 400 },
    );
  }

  let userId: string | null = null;
  if (hasDatabase && hasPrivyServerAuth) {
    const privyId = await getPrivyId(request);
    if (privyId) userId = await getUserId(privyId);
  }

  const wallets = parsed.data.wallet
    ? [parsed.data.wallet]
    : userId
      ? await walletsFor(userId)
      : [];

  if (wallets.length === 0) {
    return NextResponse.json({
      wallets: [],
      holdings: [],
      totalUsd: 0,
      partiallyValued: false,
    });
  }

  try {
    const summaries = await Promise.all(
      wallets.map((wallet) => getHoldings(wallet, userId)),
    );

    return NextResponse.json({
      wallets,
      holdings: summaries.flatMap((summary) => summary.holdings),
      totalUsd: summaries.reduce((sum, summary) => sum + summary.totalUsd, 0),
      partiallyValued: summaries.some((summary) => summary.partiallyValued),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not load holdings.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
