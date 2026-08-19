import { NextResponse, type NextRequest } from "next/server";
import { db, hasDatabase } from "./db";
import { isResponse, requireUser } from "./session";

/**
 * Who is allowed to see the internal numbers.
 *
 * Two ways in, because the page and the export have different callers. A person
 * signs in with X and is checked against an allowlist of handles; a script sends
 * a bearer token. Neither is optional in production: with nothing configured the
 * gate is closed rather than open, so a forgotten env var cannot publish the
 * user counts to anyone who guesses the path.
 */

const handles = new Set(
  (process.env.ADMIN_X_HANDLES ?? "")
    .split(",")
    .map((handle) => handle.trim().replace(/^@/, "").toLowerCase())
    .filter(Boolean),
);

const token = process.env.ADMIN_API_TOKEN ?? "";

export const hasAdminAccess = handles.size > 0 || token.length > 0;

function refuse(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function requireAdmin(
  request: NextRequest,
): Promise<NextResponse | null> {
  if (token) {
    const header = request.headers.get("authorization");
    if (header === `Bearer ${token}`) return null;
  }

  if (!hasAdminAccess) {
    return process.env.NODE_ENV === "production"
      ? refuse(404, "Not found.")
      : null;
  }

  if (handles.size === 0) return refuse(401, "Not authorised.");

  const auth = await requireUser(request);
  if (isResponse(auth)) return auth;
  if (!hasDatabase) return refuse(401, "Not authorised.");

  const { data } = await db()
    .from("users")
    .select("handle")
    .eq("id", auth.userId)
    .maybeSingle();

  const handle = (data?.handle ?? "").replace(/^@/, "").toLowerCase();
  if (!handle || !handles.has(handle)) {
    // 404 rather than 403: an internal page should not confirm it exists.
    return refuse(404, "Not found.");
  }

  return null;
}
