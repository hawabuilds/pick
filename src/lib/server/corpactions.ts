/**
 * Corporate actions — splits and dividends that move the raw share price for
 * reasons that have nothing to do with the market.
 *
 * A ticker that goes ex-dividend opens lower by the dividend, and a 2-for-1
 * split halves the quoted price overnight. Settlement compares raw prices, so
 * either would score every "down" call correct on a stock that did not fall.
 * Any ticker with an action in the window is voided rather than scored.
 */

const API_BASE = process.env.ROBINHOOD_API_BASE ?? "https://api.robinhood.com";

const CACHE_TTL_MS = 30 * 60 * 1000;

export interface CorporateAction {
  ticker: string;
  type: string;
  /** YYYY-MM-DD, so it compares directly against a snapshot date. */
  processDate: string;
  detail: string;
}

interface ActionRow {
  type?: string;
  status?: string;
  tokenSymbol?: string;
  processDate?: { year?: number; month?: number; day?: number };
  details?: {
    cashDividend?: { rate?: string };
    stockSplit?: { ratio?: string; numerator?: string; denominator?: string };
  };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function toDateKey(date: ActionRow["processDate"]): string | null {
  if (!date?.year || !date.month || !date.day) return null;
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}

function shortType(type: string): string {
  return type.replace(/^CORPORATE_ACTION_TYPE_/, "").toLowerCase();
}

function describe(row: ActionRow): string {
  const kind = shortType(row.type ?? "unknown");
  const rate = row.details?.cashDividend?.rate;
  if (rate) return `${kind} ${rate}`;
  const ratio = row.details?.stockSplit?.ratio;
  if (ratio) return `${kind} ${ratio}`;
  return kind;
}

let cache: { at: number; actions: CorporateAction[] } | null = null;

async function load(): Promise<CorporateAction[]> {
  const res = await fetch(`${API_BASE}/rhj/corporate-actions`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Robinhood /rhj/corporate-actions returned ${res.status}`);
  }

  const body = (await res.json()) as { corpActions?: ActionRow[] };

  return (body.corpActions ?? [])
    .map((row) => {
      const processDate = toDateKey(row.processDate);
      if (!processDate || !row.tokenSymbol) return null;
      return {
        ticker: row.tokenSymbol,
        type: shortType(row.type ?? "unknown"),
        processDate,
        detail: describe(row),
      } satisfies CorporateAction;
    })
    .filter((action): action is CorporateAction => action !== null);
}

export async function fetchCorporateActions(): Promise<CorporateAction[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.actions;

  const actions = await load();
  cache = { at: Date.now(), actions };
  return actions;
}

/**
 * Actions processed after the reference snapshot and on or before the scoring
 * snapshot, keyed by ticker.
 *
 * An action on the reference day itself is already priced into that day's
 * snapshot, so the window is open at the start and closed at the end.
 */
export async function actionsInWindow(
  afterDate: string,
  throughDate: string,
): Promise<Map<string, CorporateAction>> {
  const actions = await fetchCorporateActions();
  const byTicker = new Map<string, CorporateAction>();

  for (const action of actions) {
    if (action.processDate <= afterDate) continue;
    if (action.processDate > throughDate) continue;
    byTicker.set(action.ticker, action);
  }

  return byTicker;
}
