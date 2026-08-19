import {NextResponse, type NextRequest} from "next/server";
import {z} from "zod";
import {allow, LIMITS} from "@/lib/server/limits";
import {confirmClaim, failClaim} from "@/lib/server/rewards";
import {isResponse, requireUser} from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  claimId: z.string().uuid(),
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  failed: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  const auth = await requireUser(request);
  if (isResponse(auth)) return auth;

  if (!(await allow(LIMITS.confirmClaim, auth.userId))) {
    return NextResponse.json({error: "Slow down a moment."}, {status: 429});
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({error: "Invalid request."}, {status: 400});
  }

  const {claimId, txHash, failed} = parsed.data;

  try {
    // A reverted transaction returns the reward to the available list rather
    // than stranding it as pending.
    if (failed || !txHash) {
      await failClaim({userId: auth.userId, claimId});
      return NextResponse.json({ok: true, status: "failed"});
    }

    await confirmClaim({userId: auth.userId, claimId, txHash});
    return NextResponse.json({ok: true, status: "confirmed"});
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not record that claim.";
    return NextResponse.json({error: message}, {status: 400});
  }
}
