import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first.",
  );
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * Wipes all player history so you can test from a clean slate.
 *
 * Keeps stocks, seasons, daily slates (but unmarks them resolved), and market
 * snapshots/ticks. Deletes every user and everything that cascades from them.
 */
async function resetUsers() {
  const { error: resultsError, count: resultsCount } = await supabase
    .from("slate_results")
    .delete({ count: "exact" })
    .gte("slate_date", "1970-01-01");

  if (resultsError) throw resultsError;
  console.log(`slate_results: ${resultsCount ?? 0} deleted`);

  const { error: abuseError, count: abuseCount } = await supabase
    .from("abuse_events")
    .delete({ count: "exact" })
    .gte("id", 0);

  if (abuseError) throw abuseError;
  console.log(`abuse_events: ${abuseCount ?? 0} deleted`);

  const { error: limitsError, count: limitsCount } = await supabase
    .from("rate_limits")
    .delete({ count: "exact" })
    .gte("hits", 0);

  if (limitsError) throw limitsError;
  console.log(`rate_limits: ${limitsCount ?? 0} deleted`);

  const { error: usersError, count: usersCount } = await supabase
    .from("users")
    .delete({ count: "exact" })
    .neq("privy_id", "");

  if (usersError) throw usersError;
  console.log(`users: ${usersCount ?? 0} deleted (picks, submissions, scores, streaks, claims, learn, comments cascade)`);

  const { error: slatesError, count: slatesCount } = await supabase
    .from("daily_slates")
    .update({ resolved: false }, { count: "exact" })
    .eq("resolved", true);

  if (slatesError) throw slatesError;
  console.log(`daily_slates: ${slatesCount ?? 0} marked unresolved`);
}

async function main() {
  console.log("Resetting player history…");
  await resetUsers();
  console.log("\nDone. Also clear browser localStorage (pick.submissions, pick.stock-comments, pick.learn-tasks) and sign in again.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
