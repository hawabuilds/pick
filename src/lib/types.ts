export type Direction = "up" | "down";

export interface Stock {
  ticker: string;
  name: string;
  /** ERC20 address of the tokenized share on Robinhood Chain mainnet. */
  rhTokenAddress: string | null;
  logoUrl: string | null;
  /**
   * Shares represented by one token, as a decimal string. Rises as dividends
   * are reinvested. Display and valuation only: never applied to a REST price,
   * which is already the raw underlying share price.
   */
  multiplier: string;
  decimals: number;
  active: boolean;
  sort: number;
}

export type PriceReferenceKind = "last_close" | "locked";

export interface StockQuote {
  ticker: string;
  name: string;
  /**
   * The official number on the card. Last close while the slate is still open;
   * the locked snapshot once it is, so a player cannot call off a live print
   * that is not the strike.
   */
  price: number;
  /** Robinhood mid right now. Context, never the number a call is scored from. */
  live: number;
  reference: number | null;
  referenceKind: PriceReferenceKind;
  /** Live vs the official number. Painted as P&L only after the slate locks. */
  changePct: number;
  /** Recent closes, oldest first. Used for the card sparkline. */
  series: number[];
  /** True when the numbers are simulated rather than from the market-data API. */
  simulated: boolean;
}

export interface Slate {
  slateDate: string;
  tickers: string[];
  locksAt: string;
  resolved: boolean;
}

export interface Pick {
  ticker: string;
  direction: Direction;
}

export interface Submission {
  slateDate: string;
  submittedAt: string;
  counted: boolean;
  picks: Pick[];
}

export interface LeaderboardRow {
  userId: string;
  handle: string | null;
  displayName: string;
  pfpUrl: string | null;
  points: number;
  slatesPlayed: number;
  rank: number;
}

export interface SeasonWindow {
  startsAt: string;
  endsAt: string;
  cadence: "3day" | "daily";
}

export interface LeaderboardState {
  season: SeasonWindow | null;
  rows: LeaderboardRow[];
  total: number;
  /** The signed-in player's row, even when it falls outside the loaded page. */
  me: LeaderboardRow | null;
  demo: boolean;
}

export interface PlayState {
  slate: Slate;
  quotes: StockQuote[];
  submission: Submission | null;
  /** Set when the app is running without Supabase credentials. */
  demo: boolean;
}

export interface StockCommentAuthor {
  handle: string | null;
  displayName: string | null;
  pfpUrl: string | null;
}

export interface StockComment {
  id: string;
  ticker: string;
  body: string;
  createdAt: string;
  author: StockCommentAuthor;
}
