"use client";

import { cn } from "@/lib/cn";
import { money, percent } from "@/lib/format";
import type { Direction, StockQuote } from "@/lib/types";
import { Sparkline } from "./Sparkline";
import { ArrowDownIcon, ArrowUpIcon } from "./ui/Icons";

export type StockLayout = "grid" | "list";

interface StockCardProps {
  quote: StockQuote;
  layout: StockLayout;
  selected: Direction | null;
  disabled?: boolean;
  onPick: (direction: Direction) => void;
  onOpen: () => void;
}

export function StockCard({
  quote,
  layout,
  selected,
  disabled,
  onPick,
  onOpen,
}: StockCardProps) {
  const inPlay = quote.referenceKind === "locked";
  const positive = quote.changePct >= 0;
  const list = layout === "list";
  const showChange = quote.reference !== null || inPlay;

  const price = (
    <>
      <span className="tnum text-[16px] font-extrabold tracking-[-0.02em]">
        {money(quote.price)}
      </span>
      {showChange ? (
        <span
          className={cn(
            "tnum text-[12.5px] font-bold",
            positive ? "text-green-deep" : "text-red",
          )}
        >
          {percent(quote.changePct)}
        </span>
      ) : (
        <span className="text-[11.5px] font-semibold text-faint">Last close</span>
      )}
    </>
  );

  return (
    <div
      onClick={onOpen}
      className={cn(
        "cursor-pointer rounded-card border border-hairline bg-card p-[15px] shadow-card",
        "transition-[transform,box-shadow,border-color] duration-200",
        "hover:-translate-y-0.5 hover:border-[rgba(11,15,12,0.14)] hover:shadow-lift",
        selected && "border-[rgba(0,200,5,0.35)]",
        list && "grid grid-cols-[1fr_auto_auto] items-center gap-3.5",
      )}
    >
      <div className={cn("min-w-0", list && "col-start-1")}>
        <div className="text-[15px] font-extrabold tracking-[-0.01em] text-ink">
          {quote.ticker}
        </div>
        <div className="mt-px truncate text-[12px] font-semibold text-faint">
          {quote.name}
        </div>
      </div>

      <Sparkline
        series={quote.series}
        positive={showChange ? positive : true}
        className={cn(
          "h-[30px]",
          list ? "col-start-2 w-16" : "my-[10px] w-full",
        )}
      />

      <div
        className={cn(
          list
            ? "col-start-3 flex flex-col items-end gap-0.5 text-right"
            : "mb-3 flex items-baseline gap-2",
        )}
      >
        {price}
      </div>

      {/* Matches tell-preview: stop card open from swallowing pick taps. */}
      <div
        className={cn(
          "grid grid-cols-2 gap-[7px]",
          list ? "col-span-full mt-1" : "mt-0",
        )}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <CallButton
          direction="up"
          active={selected === "up"}
          disabled={disabled}
          onPick={() => onPick("up")}
        />
        <CallButton
          direction="down"
          active={selected === "down"}
          disabled={disabled}
          onPick={() => onPick("down")}
        />
      </div>
    </div>
  );
}

function CallButton({
  direction,
  active,
  disabled,
  onPick,
}: {
  direction: Direction;
  active: boolean;
  disabled?: boolean;
  onPick: () => void;
}) {
  const up = direction === "up";
  const Arrow = up ? ArrowUpIcon : ArrowDownIcon;

  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      aria-label={up ? "Call up" : "Call down"}
      onClick={(e) => {
        e.stopPropagation();
        if (disabled) return;
        onPick();
      }}
      className={cn(
        "flex items-center justify-center gap-1.5 rounded-[11px] border py-2.5",
        "text-[12.5px] font-bold transition-all duration-150",
        "hover:border-[rgba(11,15,12,0.2)] disabled:cursor-not-allowed disabled:opacity-50",
        active && up
          ? "border-green bg-[rgba(0,200,5,0.13)] text-green-deep"
          : active && !up
            ? "border-red bg-[rgba(255,90,82,0.11)] text-red"
            : "border-hairline bg-card text-muted",
      )}
    >
      <Arrow className="pointer-events-none h-[13px] w-[13px]" />
      {up ? "Up" : "Down"}
    </button>
  );
}
