/**
 * Checks the three live data sources the game depends on, the way the snapshot
 * job uses them: Robinhood's asset registry, Robinhood's quotes, and the
 * Chainlink feeds that corroborate them.
 *
 * The cross-check is the interesting output. Chainlink publishes total return,
 * so the multiplier is divided back out before comparing against the raw REST
 * mid; a ticker showing a large divergence here is one that would be voided at
 * resolution, and a screenful of them means something is wrong with the
 * comparison rather than with the market.
 *
 *   pnpm verify:feeds
 */
import { config } from "dotenv";

config({ path: ".env.local" });

const TOLERANCE_BPS = Number(process.env.CROSS_CHECK_TOLERANCE_BPS ?? 150);

async function main() {
  // Imported here rather than at the top of the file. These modules read
  // process.env as they evaluate, and a static import would be hoisted above
  // the config() call — so the script would quietly check the public RPC
  // instead of the Alchemy one it is meant to be checking.
  const { readFeedSnapshot } = await import("../src/lib/server/feeds");
  const { fetchAllQuotes } = await import("../src/lib/server/rhprices");
  const { getUniverse } = await import("../src/lib/server/universe");

  const universe = await getUniverse();
  const quotes = await fetchAllQuotes();

  console.log(`universe   ${universe.length} active tokens`);
  console.log(`quotes     ${quotes.size} priced`);

  const missingQuote = universe.filter((s) => !quotes.has(s.ticker));
  for (const stock of missingQuote) {
    console.log(`MISS  ${stock.ticker.padEnd(6)} no quote`);
  }

  let feeds: Awaited<ReturnType<typeof readFeedSnapshot>> | null = null;
  try {
    feeds = await readFeedSnapshot();
  } catch (err) {
    console.log(
      `\nChainlink unavailable: ${err instanceof Error ? err.message : err}`,
    );
    console.log("Snapshots would still be taken, uncorroborated.");
  }

  if (feeds) {
    console.log(`block      ${feeds.blockNumber}`);
    console.log(
      `sequencer  ${feeds.sequencerChecked ? "checked" : "not checked (CHAINLINK_SEQUENCER_UPTIME_FEED unset)"}`,
    );
    console.log(`feeds      ${feeds.readings.size} readable\n`);

    let breaches = 0;

    for (const stock of universe) {
      const quote = quotes.get(stock.ticker);
      const reading = feeds.readings.get(stock.ticker);
      if (!quote || !reading) continue;

      const underlying = reading.price / (Number(stock.multiplier) || 1);
      const bps = (Math.abs(underlying - quote.mid) / quote.mid) * 10_000;
      const ok = bps <= TOLERANCE_BPS;
      if (!ok) breaches++;

      console.log(
        `${ok ? "ok  " : "VOID"}  ${stock.ticker.padEnd(6)}` +
          ` rest ${quote.mid.toFixed(4).padStart(11)}` +
          ` link ${underlying.toFixed(4).padStart(11)}` +
          ` ${bps.toFixed(1).padStart(7)}bps`,
      );
    }

    console.log(
      `\n${breaches} of ${feeds.readings.size} cross-checked tickers over the ${TOLERANCE_BPS}bps tolerance.`,
    );
  }

  if (missingQuote.length > 0) {
    console.log(`\n${missingQuote.length} tickers have no quote and cannot be scored.`);
    process.exit(1);
  }

  console.log("\nEvery active token has a price.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
