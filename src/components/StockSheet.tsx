"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/cn";
import { money, percent } from "@/lib/format";
import type { Direction, StockQuote } from "@/lib/types";
import { Sparkline } from "./Sparkline";
import { Sheet, SheetFooter } from "./ui/Sheet";
import { ArrowDownIcon, ArrowUpIcon, CloseIcon } from "./ui/Icons";
import { StockComments } from "./StockComments";

const TIMEFRAMES = ["1D", "1W", "1M", "1Y"] as const;
type Timeframe = (typeof TIMEFRAMES)[number];

interface ChartPoint {
  t: string;
  price: number;
}

interface ChartResponse {
  points: ChartPoint[];
  source: "ticks" | "alchemy" | "snapshots" | "none";
  changePct: number | null;
}

interface DetailResponse {
  tokenAddress: string | null;
  price: number | null;
  bid: number | null;
  ask: number | null;
  isTradingHalt: boolean;
  /** The snapshot a call is scored against. Null until the day's snapshot exists. */
  lockedPrice: number | null;
  lockedHourUtc: number;
  changeSinceLockPct: number | null;
}

interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
}

interface NewsResponse {
  enabled: boolean;
  items: NewsItem[];
}

interface StockSheetProps {
  quote: StockQuote | null;
  onClose: () => void;
  onPick: (direction: Direction) => void;
  selected: Direction | null;
  locked: boolean;
}

export function StockSheet({
  quote,
  onClose,
  onPick,
  selected,
  locked,
}: StockSheetProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>("1M");
  const ticker = quote?.ticker;

  const detail = useQuery({
    queryKey: ["stock", ticker],
    enabled: Boolean(ticker),
    queryFn: async () => {
      const res = await fetch(`/api/stock/${ticker}`);
      if (!res.ok) throw new Error("Could not load this stock.");
      return (await res.json()) as DetailResponse;
    },
  });

  const chart = useQuery({
    queryKey: ["stock-chart", ticker, timeframe],
    enabled: Boolean(ticker),
    queryFn: async () => {
      const res = await fetch(
        `/api/stock/${ticker}/chart?timeframe=${timeframe}`,
      );
      if (!res.ok) throw new Error("Could not load the chart.");
      return (await res.json()) as ChartResponse;
    },
  });

  // News is decorative. It loads on its own so a slow or absent provider never
  // holds up the price or the pick buttons.
  const news = useQuery({
    queryKey: ["stock-news", ticker],
    enabled: Boolean(ticker),
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch(`/api/stock/${ticker}/news`);
      if (!res.ok) return { enabled: false, items: [] } as NewsResponse;
      return (await res.json()) as NewsResponse;
    },
  });

  const series = (chart.data?.points ?? []).map((point) => point.price);
  const windowChange = chart.data?.changePct ?? null;
  const inPlay = quote?.referenceKind === "locked";
  const official = quote?.price ?? detail.data?.lockedPrice ?? 0;
  const live = quote?.live ?? detail.data?.price ?? official;
  const sinceLock = inPlay ? (quote?.changePct ?? detail.data?.changeSinceLockPct) : null;
  const positive =
    (sinceLock ?? windowChange ?? 0) >= 0;

  const lockedPrice = inPlay ? (quote?.reference ?? detail.data?.lockedPrice) : null;

  // Only on 1D after the slate locks. Over a week the locked price is simply
  // the latest point, and before lock there is no strike to draw.
  const showBaseline = timeframe === "1D" && lockedPrice !== null;

  if (!quote) return null;

  return (
    <Sheet
      open
      onClose={onClose}
      height="90%"
      label={`${quote.ticker} detail`}
      header={
        <div className="flex items-start justify-between px-[22px] pb-2 pt-5">
          <div>
            <div className="text-[12px] font-extrabold tracking-[0.02em] text-faint">
              {quote.ticker}
            </div>
            <div className="my-px mb-2 text-[22px] font-extrabold tracking-[-0.03em]">
              {quote?.name}
            </div>
            <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
              <div className="flex items-baseline gap-1.5">
                <span className="text-[11.5px] font-semibold text-faint">
                  Closed
                </span>
                <span className="tnum text-[20px] font-extrabold tracking-[-0.02em]">
                  {money(official)}
                </span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-[11.5px] font-semibold text-faint">
                  Now
                </span>
                <span className="tnum text-[20px] font-extrabold tracking-[-0.02em]">
                  {money(live)}
                </span>
              </div>
              {(inPlay && sinceLock !== null) || quote?.reference !== null ? (
                <span
                  className={cn(
                    "tnum pb-0.5 text-[12.5px] font-bold",
                    positive ? "text-green-deep" : "text-red",
                  )}
                >
                  {percent(
                    inPlay && sinceLock !== null
                      ? sinceLock
                      : (quote?.changePct ?? 0),
                  )}
                </span>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-full bg-[rgba(11,15,12,0.05)] text-muted transition-colors hover:bg-[rgba(11,15,12,0.1)]"
          >
            <CloseIcon className="h-[15px] w-[15px]" />
          </button>
        </div>
      }
      footer={
        <SheetFooter>
          <FootButton
            direction="up"
            active={selected === "up"}
            disabled={locked}
            onClick={() => onPick("up")}
          />
          <FootButton
            direction="down"
            active={selected === "down"}
            disabled={locked}
            onClick={() => onPick("down")}
          />
        </SheetFooter>
      }
    >
      <div className="my-3.5 flex gap-1.5">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            type="button"
            onClick={() => setTimeframe(tf)}
            className={cn(
              "rounded-[9px] px-3 py-1.5 text-[12px] font-bold transition-colors",
              tf === timeframe
                ? "bg-[rgba(0,200,5,0.12)] text-green-deep"
                : "text-faint",
            )}
          >
            {tf}
          </button>
        ))}
      </div>

      <div className="h-[150px]">
        {series.length > 1 ? (
          <Sparkline
            series={series}
            positive={positive}
            filled
            height={150}
            baseline={showBaseline ? lockedPrice : null}
            className="h-full w-full"
          />
        ) : (
          <div className="grid h-full place-items-center rounded-panel bg-wash px-6 text-center text-[13px] font-medium text-faint">
            {chart.isLoading ? "Loading chart" : "Not enough history yet"}
          </div>
        )}
      </div>

      <div className="mb-[18px] mt-2 h-[15px] text-[11.5px] font-semibold text-faint">
        {showBaseline && series.length > 1 ? (
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-px w-4 border-t border-dashed border-faint"
            />
            Locked price your call is scored from
          </span>
        ) : null}
      </div>

      <NewsList items={news.data?.items ?? []} loading={news.isLoading} />

      <StockComments ticker={quote.ticker} />
    </Sheet>
  );
}

function relativeTime(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(minutes) || minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function NewsList({ items, loading }: { items: NewsItem[]; loading: boolean }) {
  return (
    <>
      <div className="mb-1 text-[13px] font-extrabold tracking-[-0.01em]">
        Latest news
      </div>
      {items.length === 0 ? (
        <p className="border-t border-hairline py-[13px] text-[13px] text-muted">
          {loading ? "Loading news" : "No recent news"}
        </p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block border-t border-hairline py-[13px] transition-colors hover:bg-wash"
              >
                <div className="text-[13.5px] font-semibold leading-[1.4] tracking-[-0.01em]">
                  {item.title}
                </div>
                <div className="mt-1 text-[12px] font-medium text-faint">
                  {item.source} &middot; {relativeTime(item.publishedAt)}
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function FootButton({
  direction,
  active,
  disabled,
  onClick,
}: {
  direction: Direction;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const up = direction === "up";
  const Arrow = up ? ArrowUpIcon : ArrowDownIcon;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex items-center justify-center gap-[7px] rounded-control border py-[15px] text-[15px] font-extrabold transition-colors",
        "disabled:pointer-events-none disabled:opacity-50",
        active && up
          ? "border-green bg-[rgba(0,200,5,0.1)] text-green-deep"
          : active && !up
            ? "border-red bg-[rgba(255,90,82,0.09)] text-red"
            : up
              ? "border-hairline bg-card text-green-deep hover:border-green hover:bg-[rgba(0,200,5,0.1)]"
              : "border-hairline bg-card text-red hover:border-red hover:bg-[rgba(255,90,82,0.09)]",
      )}
    >
      <Arrow className="pointer-events-none h-4 w-4" />
      Call {up ? "Up" : "Down"}
    </button>
  );
}
