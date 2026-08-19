import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import {
  lockedSlateDate,
  openSlateDate,
  slateLocksAt,
} from "../src/lib/server/calendar";
import { getUniverse } from "../src/lib/server/universe";

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
 * Mirrors Robinhood's asset registry into our table.
 *
 * The registry is the source of truth at runtime; this copy is the fallback the
 * app reads when the registry is unreachable, so it is worth keeping current.
 */
async function seedStocks() {
  const universe = await getUniverse();

  const rows = universe.map((stock) => ({
    ticker: stock.ticker,
    name: stock.name,
    rh_token_address: stock.rhTokenAddress,
    logo_url: stock.logoUrl,
    multiplier: stock.multiplier,
    active: true,
    sort: stock.sort,
  }));

  const { error } = await supabase.from("stocks").upsert(rows, {
    onConflict: "ticker",
  });
  if (error) throw error;

  // A delisted ticker stays in the table because results and picks reference
  // it, but it must stop appearing on new slates.
  const { error: retireError, count } = await supabase
    .from("stocks")
    .update({ active: false }, { count: "exact" })
    .not("ticker", "in", `(${rows.map((r) => r.ticker).join(",")})`)
    .eq("active", true);

  if (retireError) throw retireError;
  console.log(`stocks: ${rows.length} upserted, ${count ?? 0} retired`);
}

async function seedSeason() {
  const { data: active } = await supabase
    .from("active_season")
    .select("id")
    .maybeSingle();

  if (active) {
    console.log(`season: ${active.id} already active`);
    return;
  }

  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + 3 * 86400000);
  const { data, error } = await supabase
    .from("seasons")
    .insert({
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      cadence: "3day",
    })
    .select("id")
    .single();

  if (error) throw error;
  console.log(`season: ${data.id} created (3-day cadence)`);
}

/**
 * Two slates exist at once: the one locked and being played out, and the one
 * taking picks for the day after. Both are seeded so the Play tab and the
 * resolution job each have something to work with straight away.
 */
async function seedSlates() {
  const tickers = (await getUniverse()).map((s) => s.ticker);

  for (const slateDate of [lockedSlateDate(), openSlateDate()]) {
    const locksAt = slateLocksAt(slateDate).toISOString();

    const { error } = await supabase.from("daily_slates").upsert(
      { slate_date: slateDate, tickers, locks_at: locksAt },
      { onConflict: "slate_date" },
    );

    if (error) throw error;
    console.log(`slate: ${slateDate} with ${tickers.length} tickers, locks at ${locksAt}`);
  }
}

async function main() {
  await seedStocks();
  await seedSeason();
  await seedSlates();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
