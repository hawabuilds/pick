import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getPrivyId, hasPrivyServerAuth } from "@/lib/server/auth";
import { db, hasDatabase } from "@/lib/server/db";
import { MIN_X_ACCOUNT_AGE_DAYS, tooYoung } from "@/lib/server/eligibility";
import { logAbuse } from "@/lib/server/limits";
import { fetchXAccountCreatedAt } from "@/lib/server/x";

export const runtime = "nodejs";

const bodySchema = z.object({
  id: z.string().min(1),
  xId: z.string().nullable().optional(),
  handle: z.string().nullable(),
  displayName: z.string(),
  pfpUrl: z.string().nullable(),
  embeddedWallet: z.string().nullable(),
  xAccountCreatedAt: z.string().nullable(),
  /** Whether the browser already had a wallet extension. See the migration. */
  hadWalletAtSignup: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  if (!hasDatabase) {
    return NextResponse.json({ ok: true, persisted: false });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  // The client can claim any id, so the token decides. Without Privy configured
  // there is no verifiable identity and nothing is written.
  const privyId = await getPrivyId(request);
  if (!hasPrivyServerAuth || !privyId) {
    return NextResponse.json({ ok: true, persisted: false });
  }

  const user = parsed.data;
  const supabase = db();

  // The client cannot know when the X account was opened, and would not be
  // trusted with it if it could. Looked up once and cached on the row.
  const { data: existing } = await supabase
    .from("users")
    .select("id, x_account_created_at, onboarded_at, had_wallet_at_signup")
    .eq("privy_id", privyId)
    .maybeSingle();

  let xAccountCreatedAt = existing?.x_account_created_at ?? null;
  if (!xAccountCreatedAt && user.xId) {
    xAccountCreatedAt = await fetchXAccountCreatedAt(user.xId);
  }

  // Both of these describe the moment the account was created, so they are
  // written once and never revised: a player who installs a wallet next week was
  // still new to crypto when they arrived.
  const firstLogin = !existing;

  const { error } = await supabase.from("users").upsert(
    {
      privy_id: privyId,
      x_id: user.xId ?? null,
      handle: user.handle,
      display_name: user.displayName,
      pfp_url: user.pfpUrl,
      embedded_wallet: user.embeddedWallet,
      x_account_created_at: xAccountCreatedAt,
      ...(firstLogin
        ? {
            had_wallet_at_signup: user.hadWalletAtSignup ?? null,
            signup_country:
              request.headers.get("x-vercel-ip-country")?.slice(0, 2) ?? null,
          }
        : {}),
    },
    { onConflict: "privy_id" },
  );

  if (error) {
    // A duplicate x_id or embedded wallet means someone is trying to run two
    // accounts off one X identity, which is exactly what those unique
    // constraints exist to stop.
    if (error.code === "23505") {
      await logAbuse({
        kind: "duplicate_identity",
        privyId,
        detail: { xId: user.xId, wallet: user.embeddedWallet },
        request,
      });
      return NextResponse.json(
        { error: "That X account is already linked to another player." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (tooYoung(xAccountCreatedAt)) {
    await logAbuse({
      kind: "account_too_young",
      privyId,
      detail: { xId: user.xId, createdAt: xAccountCreatedAt },
      request,
    });
    return NextResponse.json({
      ok: true,
      persisted: true,
      restricted: true,
      onboarded: true,
      reason: `X accounts need to be at least ${MIN_X_ACCOUNT_AGE_DAYS} days old to play.`,
    });
  }

  return NextResponse.json({
    ok: true,
    persisted: true,
    restricted: false,
    onboarded: existing?.onboarded_at != null,
  });
}
