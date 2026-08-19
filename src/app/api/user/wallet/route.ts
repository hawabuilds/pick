import {NextResponse, type NextRequest} from "next/server";
import {z} from "zod";
import {db} from "@/lib/server/db";
import {allow, LIMITS, logAbuse} from "@/lib/server/limits";
import {isResponse, requireUser} from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "invalid wallet address"),
});

/**
 * Registers the external wallet a player claims rewards to.
 *
 * `users.connected_wallet` is unique, which is the anti-sybil bite: one external
 * wallet cannot be shared across accounts to funnel multiple welcome rewards
 * into the same address.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser(request);
  if (isResponse(auth)) return auth;

  if (!(await allow(LIMITS.walletLink, auth.userId))) {
    return NextResponse.json({error: "Slow down a moment."}, {status: 429});
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({error: "Invalid wallet address."}, {status: 400});
  }

  const wallet = parsed.data.wallet.toLowerCase();

  const {data: existing} = await db()
    .from("users")
    .select("id")
    .eq("connected_wallet", wallet)
    .maybeSingle();

  if (existing && existing.id !== auth.userId) {
    await logAbuse({
      kind: "wallet_already_linked",
      userId: auth.userId,
      detail: {wallet},
      request,
    });
    return NextResponse.json(
      {error: "That wallet is already linked to another account."},
      {status: 409},
    );
  }

  const {error} = await db()
    .from("users")
    .update({connected_wallet: wallet})
    .eq("id", auth.userId);

  if (error) {
    return NextResponse.json({error: error.message}, {status: 500});
  }

  return NextResponse.json({ok: true});
}
