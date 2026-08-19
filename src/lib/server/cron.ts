import type { NextRequest } from "next/server";

const secret = process.env.CRON_SECRET ?? "";

/**
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when the env var is
 * set. Without a secret the jobs are open, so they are refused outside
 * development rather than left callable by anyone who guesses the path.
 */
export function isAuthorisedCron(request: NextRequest): boolean {
  if (secret) {
    return request.headers.get("authorization") === `Bearer ${secret}`;
  }
  return process.env.NODE_ENV !== "production";
}
