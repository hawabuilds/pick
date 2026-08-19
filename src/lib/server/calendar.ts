const NY = "America/New_York";

/** US market holidays that fall on a weekday. Extend each year. */
const HOLIDAYS = new Set([
  "2026-01-01",
  "2026-01-19",
  "2026-02-16",
  "2026-04-03",
  "2026-05-25",
  "2026-06-19",
  "2026-07-03",
  "2026-09-07",
  "2026-11-26",
  "2026-12-25",
  "2027-01-01",
  "2027-01-18",
  "2027-02-15",
  "2027-03-26",
  "2027-05-31",
  "2027-06-18",
  "2027-07-05",
  "2027-09-06",
  "2027-11-25",
  "2027-12-24",
]);

function partsIn(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);

  const map: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = Number(part.value);
  }
  return map;
}

function offsetMs(date: Date, timeZone: string) {
  const p = partsIn(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return asUtc - date.getTime();
}

/** Converts a wall-clock time in `timeZone` to a real UTC instant. */
export function zonedToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone = NY,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  // Two passes settle the DST boundary where the first offset is stale.
  let ts = guess - offsetMs(new Date(guess), timeZone);
  ts = guess - offsetMs(new Date(ts), timeZone);
  return new Date(ts);
}

export function toDateKey(date: Date, timeZone = NY): string {
  const p = partsIn(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function isTradingDay(dateKey: string): boolean {
  const [y, m, d] = dateKey.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  return !HOLIDAYS.has(dateKey);
}

function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.toISOString().slice(0, 10);
}

/** The first trading day strictly after `dateKey`. */
export function nextTradingDay(dateKey: string): string {
  let candidate = addDays(dateKey, 1);
  for (let i = 0; i < 14 && !isTradingDay(candidate); i++) {
    candidate = addDays(candidate, 1);
  }
  return candidate;
}

/** The last trading day strictly before `dateKey`. */
export function previousTradingDay(dateKey: string): string {
  let candidate = addDays(dateKey, -1);
  for (let i = 0; i < 14 && !isTradingDay(candidate); i++) {
    candidate = addDays(candidate, -1);
  }
  return candidate;
}

/** 09:30 America/New_York on the given trading day, as a UTC instant. */
export function marketOpen(dateKey: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  return zonedToUtc(y, m, d, 9, 30);
}

/** 16:00 America/New_York on the given trading day, as a UTC instant. */
export function marketClose(dateKey: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  return zonedToUtc(y, m, d, 16, 0);
}

/**
 * The hour, in UTC, at which the daily Chainlink snapshot is taken.
 *
 * 22:00 UTC is 17:00 in New York under EST and 18:00 under EDT, so it is always
 * at least an hour past the 16:00 close in either regime, with the post-close
 * prints in. Deliberately a fixed UTC instant rather than a wall-clock time in
 * New York: the snapshot is the one part of the loop that never needs to know
 * about daylight saving, and the 24/5 feeds are live at that hour either way.
 */
export const SNAPSHOT_UTC_HOUR = 22;

/** The instant the day's prices are read, for a given trading day. */
export function snapshotAt(dateKey: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, SNAPSHOT_UTC_HOUR, 0, 0, 0));
}

function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The most recent trading day whose snapshot has already been taken. */
export function lastSnapshotDay(now = new Date()): string {
  let candidate = utcDateKey(now);
  for (let i = 0; i < 14; i++) {
    if (isTradingDay(candidate) && snapshotAt(candidate) <= now) return candidate;
    candidate = addDays(candidate, -1);
  }
  return candidate;
}

/**
 * When a slate stops accepting picks, which is the same instant its reference
 * price is read. If the two ever drifted apart, a player could watch the market
 * move and still get in against a price that was fixed hours earlier.
 */
export function slateLocksAt(slateDate: string): Date {
  return snapshotAt(previousTradingDay(slateDate));
}

/**
 * The slate that is locked and currently being played out. Its reference price
 * was read at the last snapshot; it scores at the next one.
 */
export function lockedSlateDate(now = new Date()): string {
  return nextTradingDay(lastSnapshotDay(now));
}

/**
 * The slate open for picks: the trading day after the one now in flight.
 *
 * Two slates exist at once by necessity. Locking at the reference price means
 * tomorrow's board has to close before tomorrow begins, so picks for it are
 * made across today.
 */
export function openSlateDate(now = new Date()): string {
  return nextTradingDay(lockedSlateDate(now));
}
