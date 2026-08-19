/**
 * Checks the trading calendar, which decides when picks lock and when a slate
 * is scored. Getting DST, a holiday or the snapshot instant wrong here fails
 * silently and corrupts scoring, so these cases are worth pinning down.
 *
 *   pnpm verify:calendar
 */
import {
  isTradingDay,
  lastSnapshotDay,
  lockedSlateDate,
  marketClose,
  marketOpen,
  nextTradingDay,
  openSlateDate,
  previousTradingDay,
  slateLocksAt,
  snapshotAt,
} from "../src/lib/server/calendar";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}: ${actual}${ok ? "" : ` (expected ${expected})`}`);
}

console.log("-- trading days --");
check("Sat 2026-08-22 is not a trading day", isTradingDay("2026-08-22"), false);
check("Sun 2026-08-23 is not a trading day", isTradingDay("2026-08-23"), false);
check("Wed 2026-08-19 is a trading day", isTradingDay("2026-08-19"), true);
check("Christmas 2026-12-25 is a holiday", isTradingDay("2026-12-25"), false);
check("Thanksgiving 2026-11-26 is a holiday", isTradingDay("2026-11-26"), false);

console.log("\n-- rolling over weekends and holidays --");
check("Friday rolls to Monday", nextTradingDay("2026-08-21"), "2026-08-24");
check("Monday steps back to Friday", previousTradingDay("2026-08-24"), "2026-08-21");
check("Christmas Eve rolls past 25th", nextTradingDay("2026-12-24"), "2026-12-28");

console.log("\n-- market hours in UTC, across DST --");
// Summer: New York is UTC-4, so 09:30 ET is 13:30 UTC and 16:00 ET is 20:00 UTC.
check("summer open", marketOpen("2026-08-19").toISOString(), "2026-08-19T13:30:00.000Z");
check("summer close", marketClose("2026-08-19").toISOString(), "2026-08-19T20:00:00.000Z");
// Winter: New York is UTC-5, so the same wall clock shifts an hour later in UTC.
check("winter open", marketOpen("2026-01-20").toISOString(), "2026-01-20T14:30:00.000Z");
check("winter close", marketClose("2026-01-20").toISOString(), "2026-01-20T21:00:00.000Z");

console.log("\n-- the snapshot instant --");
// Fixed in UTC on purpose. It lands 2h after the summer close and 1h after the
// winter one, so it is always past the bell with post-close prints in, and the
// job itself never needs to know about daylight saving.
check("summer snapshot", snapshotAt("2026-08-19").toISOString(), "2026-08-19T22:00:00.000Z");
check("winter snapshot", snapshotAt("2026-01-20").toISOString(), "2026-01-20T22:00:00.000Z");
check(
  "summer snapshot is 2h after the close",
  (snapshotAt("2026-08-19").getTime() - marketClose("2026-08-19").getTime()) / 3600000,
  2,
);
check(
  "winter snapshot is 1h after the close",
  (snapshotAt("2026-01-20").getTime() - marketClose("2026-01-20").getTime()) / 3600000,
  1,
);

console.log("\n-- which snapshot is the latest --");
check(
  "an hour before Wednesday's snapshot -> Tuesday",
  lastSnapshotDay(new Date("2026-08-19T21:00:00Z")),
  "2026-08-18",
);
check(
  "half an hour after it -> Wednesday",
  lastSnapshotDay(new Date("2026-08-19T22:30:00Z")),
  "2026-08-19",
);
check(
  "Saturday still points at Friday",
  lastSnapshotDay(new Date("2026-08-22T12:00:00Z")),
  "2026-08-21",
);

console.log("\n-- two slates in flight --");
// Before Wednesday's snapshot: Wednesday is locked and being played out, and
// Thursday is the board taking picks.
check(
  "Wed 21:00 UTC -> Wednesday locked",
  lockedSlateDate(new Date("2026-08-19T21:00:00Z")),
  "2026-08-19",
);
check(
  "Wed 21:00 UTC -> Thursday open",
  openSlateDate(new Date("2026-08-19T21:00:00Z")),
  "2026-08-20",
);
// After it, everything shifts by one trading day in the same tick.
check(
  "Wed 22:30 UTC -> Thursday locked",
  lockedSlateDate(new Date("2026-08-19T22:30:00Z")),
  "2026-08-20",
);
check(
  "Wed 22:30 UTC -> Friday open",
  openSlateDate(new Date("2026-08-19T22:30:00Z")),
  "2026-08-21",
);
check(
  "Saturday -> Monday locked",
  lockedSlateDate(new Date("2026-08-22T12:00:00Z")),
  "2026-08-24",
);
check(
  "Saturday -> Tuesday open",
  openSlateDate(new Date("2026-08-22T12:00:00Z")),
  "2026-08-25",
);

console.log("\n-- a slate locks exactly when its reference price is read --");
check(
  "Thursday locks at Wednesday's snapshot",
  slateLocksAt("2026-08-20").toISOString(),
  snapshotAt("2026-08-19").toISOString(),
);
check(
  "Monday locks at Friday's snapshot, not Sunday's",
  slateLocksAt("2026-08-24").toISOString(),
  "2026-08-21T22:00:00.000Z",
);
check(
  "the 28th locks at Christmas Eve's snapshot",
  slateLocksAt("2026-12-28").toISOString(),
  "2026-12-24T22:00:00.000Z",
);
// The invariant that makes the game fair: picks close no later than the instant
// the reference price is taken.
const lockLeak = ["2026-08-20", "2026-08-24", "2026-08-25", "2026-12-28"].filter(
  (day) => slateLocksAt(day).getTime() > snapshotAt(previousTradingDay(day)).getTime(),
);
check("no slate locks after its reference snapshot", lockLeak.length, 0);

console.log(failures === 0 ? "\nAll calendar checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
