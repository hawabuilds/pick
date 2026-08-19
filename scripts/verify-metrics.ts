import { config } from "dotenv";

// Same file the app reads. Plain `dotenv/config` loads `.env`, which this
// project does not use, so the script reported "no database" against a database
// that was there all along. The import below is dynamic for the same reason: a
// static one is hoisted above this call, and db.ts decides whether it has a
// database as it evaluates.
config({ path: ".env.local" });

/**
 * Prints the adoption numbers and the CSV the export serves.
 *
 * Runs against whatever is configured: with a database it is the live count,
 * without one it is the zeroed shape, which is still worth checking because the
 * page and the export have to render either way.
 */
async function main() {
  const { getMetrics, toCsv } = await import("../src/lib/server/metrics");
  const metrics = await getMetrics(true);

  console.log(metrics.live ? "Live counts." : "No database: zeroed shape.\n");
  console.log(JSON.stringify(metrics, null, 2));
  console.log("\n--- CSV ---\n");
  console.log(toCsv(metrics));

  if (metrics.onChain.error) {
    console.log(`\nOn-chain read failed: ${metrics.onChain.error}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
