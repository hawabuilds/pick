import {NextResponse, type NextRequest} from "next/server";
import {getPrivyId, hasPrivyServerAuth} from "@/lib/server/auth";
import {hasDatabase} from "@/lib/server/db";
import {demoLearnerState, getLearnerState} from "@/lib/server/learn";
import {getUserId} from "@/lib/server/play";
import {publicLessons} from "@/lib/learn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const lessons = publicLessons();

  if (!hasDatabase || !hasPrivyServerAuth) {
    return NextResponse.json({lessons, progress: demoLearnerState()});
  }

  const privyId = await getPrivyId(request);
  const header = request.headers.get("authorization");
  const presentedToken = Boolean(header?.startsWith("Bearer "));

  // A presented token that does not resolve to a user is an auth failure, not
  // a reason to serve demo progress. Demo progress has completed: [] and would
  // overwrite a just-passed lesson on the next refetch.
  if (presentedToken && !privyId) {
    return NextResponse.json(
      {error: "Your session has expired. Sign in again to continue."},
      {status: 401},
    );
  }

  const userId = privyId ? await getUserId(privyId) : null;
  if (presentedToken && !userId) {
    return NextResponse.json(
      {error: "We could not find your account. Sign out and back in."},
      {status: 401},
    );
  }
  if (!userId) {
    return NextResponse.json({lessons, progress: demoLearnerState()});
  }

  try {
    return NextResponse.json({lessons, progress: await getLearnerState(userId)});
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not load your progress.";
    return NextResponse.json({error: message}, {status: 500});
  }
}
