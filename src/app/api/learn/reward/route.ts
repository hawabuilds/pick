import {NextResponse, type NextRequest} from "next/server";
import {z} from "zod";
import {db} from "@/lib/server/db";
import {grantLearnerReward} from "@/lib/server/learn";
import {allow, LIMITS, logAbuse} from "@/lib/server/limits";
import {isResponse, requireUser} from "@/lib/server/session";
import {verifySharePost} from "@/lib/server/x";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  shareUrl: z.string().url().max(500),
});

/**
 * Claims the learner reward after verifying the share post is genuinely live
 * and genuinely theirs. Every other gate lives in `grantLearnerReward`.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser(request);
  if (isResponse(auth)) return auth;

  if (!(await allow(LIMITS.learnerReward, auth.userId))) {
    await logAbuse({
      kind: "learner_reward_rate_limited",
      userId: auth.userId,
      request,
    });
    return NextResponse.json(
      {error: "Too many attempts. Try again shortly."},
      {status: 429},
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({error: "Paste the link to your post."}, {status: 400});
  }

  const {data: user} = await db()
    .from("users")
    .select("x_id, handle")
    .eq("id", auth.userId)
    .maybeSingle();

  const verification = await verifySharePost({
    url: parsed.data.shareUrl,
    xId: user?.x_id ?? null,
    handle: user?.handle ?? null,
  });

  if (!verification.ok) {
    await logAbuse({
      kind: "learner_share_rejected",
      userId: auth.userId,
      detail: {url: parsed.data.shareUrl, reason: verification.reason},
      request,
    });
    return NextResponse.json(
      {error: verification.reason ?? "Could not verify that post."},
      {status: 400},
    );
  }

  try {
    const result = await grantLearnerReward({
      userId: auth.userId,
      shareUrl: parsed.data.shareUrl,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not grant that reward.";
    return NextResponse.json({error: message}, {status: 500});
  }
}
