import {db} from "./db";

/**
 * The account-age gate.
 *
 * A young X account is the cheapest thing in the world to make, so anything
 * that pays out has to know how old the account behind it is. This is checked
 * at signup and again on every submission, because an account can be created
 * before the gate exists and picked up afterwards.
 */

export const MIN_X_ACCOUNT_AGE_DAYS = Number(
  process.env.MIN_X_ACCOUNT_AGE_DAYS ?? "30",
);

export function accountAgeDays(createdAt: string | null): number | null {
  if (!createdAt) return null;
  const parsed = new Date(createdAt).getTime();
  if (Number.isNaN(parsed)) return null;
  return (Date.now() - parsed) / 86400000;
}

/**
 * Whether an account is old enough to play.
 *
 * Deliberately fails open on an unknown age: without an X API key the age
 * cannot be established, and refusing everyone would be worse than the abuse it
 * prevents. The learner reward applies a stricter version of this same check
 * (see ./learn.ts) precisely because that one pays real value.
 */
export function tooYoung(createdAt: string | null): boolean {
  const age = accountAgeDays(createdAt);
  if (age === null) return false;
  return age < MIN_X_ACCOUNT_AGE_DAYS;
}

export interface Restriction {
  restricted: boolean;
  reason?: string;
}

export async function accountRestriction(userId: string): Promise<Restriction> {
  const {data} = await db()
    .from("users")
    .select("x_account_created_at")
    .eq("id", userId)
    .maybeSingle();

  if (tooYoung(data?.x_account_created_at ?? null)) {
    return {
      restricted: true,
      reason: `X accounts need to be at least ${MIN_X_ACCOUNT_AGE_DAYS} days old to play.`,
    };
  }

  return {restricted: false};
}
