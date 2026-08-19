import {NextResponse, type NextRequest} from "next/server";
import {getPrivyId, hasPrivyServerAuth} from "./auth";
import {hasDatabase} from "./db";
import {getUserId} from "./play";

export interface AuthedUser {
  privyId: string;
  userId: string;
}

/**
 * Resolves the caller to a database user, or returns the response to send back.
 *
 * Routes that mutate state should start with this. Demo mode (no Privy, no
 * Supabase) has no verifiable identity, so those routes refuse rather than
 * guessing at who is calling.
 */
export async function requireUser(
  request: NextRequest,
): Promise<AuthedUser | NextResponse> {
  // These reach the player now, so they say what to do rather than which
  // environment variable is missing.
  if (!hasDatabase || !hasPrivyServerAuth) {
    return NextResponse.json(
      {error: "This is not switched on yet. Try again shortly."},
      {status: 501},
    );
  }

  const privyId = await getPrivyId(request);
  if (!privyId) {
    return NextResponse.json(
      {error: "Your session has expired. Sign in again to continue."},
      {status: 401},
    );
  }

  const userId = await getUserId(privyId);
  if (!userId) {
    return NextResponse.json(
      {error: "We could not find your account. Sign out and back in."},
      {status: 401},
    );
  }

  return {privyId, userId};
}

export function isResponse(value: unknown): value is NextResponse {
  return value instanceof NextResponse;
}
