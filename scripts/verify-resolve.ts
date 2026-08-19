/**
 * Checks the two decisions that turn prices into points: whether a feed reading
 * may be scored on at all, and which way a call resolved.
 *
 * Both fail silently if they are wrong — a stale price or a mis-set 'void'
 * hands out points that cannot be taken back — so the failure paths are pinned
 * down here rather than left to a live run to discover.
 *
 *   pnpm verify:resolve
 */
import { evaluateReading } from "../src/lib/server/feeds";
import { outcomeOf } from "../src/lib/server/resolve";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "ok  " : "FAIL"}  ${label}: ${actual}${ok ? "" : ` (expected ${expected})`}`,
  );
}

const NOW = 1_800_000_000;
const HEARTBEAT = 86_400;

function reading(over: Partial<Parameters<typeof evaluateReading>[0]> = {}) {
  return evaluateReading({
    answer: 21_802_500_000n,
    updatedAt: BigInt(NOW - 600),
    heartbeat: HEARTBEAT,
    nowSeconds: NOW,
    paused: false,
    ...over,
  });
}

function verdict(result: ReturnType<typeof evaluateReading>) {
  return result.ok ? "ok" : result.reason;
}

console.log("-- feed guards --");
check("a fresh, positive, unpaused reading is accepted", verdict(reading()), "ok");

// The stock feeds publish on a 0.5% deviation with a 24h heartbeat, so a quiet
// ticker being hours old is normal and must not be thrown away.
check(
  "12h old is still fine on a 24h heartbeat",
  verdict(reading({ updatedAt: BigInt(NOW - 12 * 3600) })),
  "ok",
);
check(
  "just inside the heartbeat plus grace",
  verdict(reading({ updatedAt: BigInt(NOW - (HEARTBEAT + 3599)) })),
  "ok",
);
check(
  "past the heartbeat plus grace is refused",
  verdict(reading({ updatedAt: BigInt(NOW - (HEARTBEAT + 3601)) })),
  `stale by ${HEARTBEAT + 3601}s against a ${HEARTBEAT}s heartbeat`,
);

check(
  "a zero answer is refused",
  verdict(reading({ answer: 0n })),
  "non-positive answer",
);
check(
  "a negative answer is refused",
  verdict(reading({ answer: -1n })),
  "non-positive answer",
);

check(
  "a paused oracle is refused",
  verdict(reading({ paused: true })),
  "oracle paused",
);
// Staleness is the primary guard because the pause flag is advisory: a stale
// reading must be refused for being stale even when nothing claims it is paused.
check(
  "staleness is reported ahead of the advisory pause flag",
  verdict(reading({ updatedAt: BigInt(NOW - 200_000), paused: true })),
  `stale by 200000s against a ${HEARTBEAT}s heartbeat`,
);

console.log("\n-- outcomes --");

const READING = {
  price: 100,
  spreadBps: 10,
  isTradingHalt: false,
  multiplier: 1,
  crossCheckOk: true as boolean | null,
};

/** Yesterday's price is fixed at 100; only what changed is worth stating. */
function resolve(
  today: Partial<typeof READING> = {},
  previous: Partial<typeof READING> = {},
  corporateAction = false,
) {
  const result = outcomeOf({
    today: { ...READING, ...today },
    previous: { ...READING, ...previous },
    corporateAction,
  });
  return result.reason ?? result.direction;
}

check("a higher price is up", resolve({ price: 101 }), "up");
check("a lower price is down", resolve({ price: 99 }), "down");
check("an unchanged price is flat", resolve(), "flat");

// Eight decimals of precision is the reason 'flat' is close to unreachable: a
// move too small to see at 4dp still resolves.
check(
  "a move in the 8th decimal still resolves",
  resolve({ price: 1763.08800001 }, { price: 1763.088 }),
  "up",
);

// The one that would otherwise pay out on a lie. A stock going ex-dividend
// opens lower by the dividend and a split halves the quote outright; either
// scores every 'down' call correct on a company that did not fall.
check(
  "a corporate action in the window voids the ticker",
  resolve({ price: 50 }, { price: 100 }, true),
  "corporate_action",
);
check(
  "a multiplier change is a corporate action even if the feed missed it",
  resolve({ price: 50, multiplier: 2 }, { price: 100, multiplier: 1 }),
  "corporate_action",
);
check(
  "a corporate action outranks a price move",
  resolve({ price: 101 }, {}, true),
  "corporate_action",
);

check(
  "a halt today voids the ticker",
  resolve({ price: 101, isTradingHalt: true }),
  "trading_halt",
);
check(
  "a halt on the reference day voids it too",
  resolve({ price: 101 }, { isTradingHalt: true }),
  "trading_halt",
);

// Chainlink disagreeing means we cannot corroborate the price we would settle
// on, so nobody is paid rather than everybody being paid on a guess.
check(
  "a failed cross-check voids the ticker",
  resolve({ price: 101, crossCheckOk: false }),
  "cross_check",
);
check(
  "no Chainlink feed at all is not a failed cross-check",
  resolve({ price: 101, crossCheckOk: null }, { crossCheckOk: null }),
  "up",
);

// Mid on a market this wide is not a price anyone could trade at.
check(
  "an untradeable spread voids the ticker",
  resolve({ price: 101, spreadBps: 900 }),
  "wide_spread",
);
check("a normal spread scores", resolve({ price: 101, spreadBps: 40 }), "up");

check(
  "a missing price today voids the ticker",
  outcomeOf({ today: null, previous: READING, corporateAction: false }).reason,
  "missing_price",
);
check(
  "a missing reference price voids the ticker",
  outcomeOf({ today: READING, previous: null, corporateAction: false }).reason,
  "missing_price",
);

console.log(
  failures === 0 ? "\nAll resolution checks passed." : `\n${failures} check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
