import {NextResponse, type NextRequest} from "next/server";
import {getPrivyId, hasPrivyServerAuth} from "@/lib/server/auth";
import {hasDatabase} from "@/lib/server/db";
import {getUserId} from "@/lib/server/play";
import {demoRewards, listRewards} from "@/lib/server/rewards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!hasDatabase || !hasPrivyServerAuth) {
    return NextResponse.json(demoRewards());
  }

  const privyId = await getPrivyId(request);
  if (!privyId) return NextResponse.json(demoRewards());

  const userId = await getUserId(privyId);
  if (!userId) return NextResponse.json(demoRewards());

  try {
    return NextResponse.json(await listRewards(userId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load rewards.";
    return NextResponse.json({error: message}, {status: 500});
  }
}
