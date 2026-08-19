"use client";

import { useEffect, useMemo, useState } from "react";
import { PICKS_PER_SLATE } from "@/config/app";
import { PicksShareCard } from "@/components/ShareCard";
import { StockCard, type StockLayout } from "@/components/StockCard";
import { StockSheet } from "@/components/StockSheet";
import { SubmitBar } from "@/components/SubmitBar";
import { SearchBar } from "@/components/ui/SearchBar";
import { SegmentedToggle } from "@/components/ui/SegmentedToggle";
import { GridIcon, ListIcon, LockIcon } from "@/components/ui/Icons";
import { usePlay } from "@/hooks/usePlay";
import { useUser } from "@/hooks/useUser";
import { cn } from "@/lib/cn";
import { countdown, slateLabel } from "@/lib/format";
import type { Direction, Pick } from "@/lib/types";

export default function PlayPage() {
  const { displayName } = useUser();
  const { state, isLoading, error, submission, submit } = usePlay();

  const [selections, setSelections] = useState<Map<string, Direction>>(new Map());
  const [query, setQuery] = useState("");
  const [layout, setLayout] = useState<StockLayout>("grid");
  const [openTicker, setOpenTicker] = useState<string | null>(null);
  const [nudge, setNudge] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const locked = Boolean(submission?.counted);
  const quotes = useMemo(() => state?.quotes ?? [], [state]);

  // Once locked, the board shows what was submitted rather than local state.
  useEffect(() => {
    if (submission) {
      setSelections(
        new Map(submission.picks.map((p) => [p.ticker, p.direction])),
      );
    }
  }, [submission]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return quotes;
    return quotes.filter(
      (quote) =>
        quote.ticker.toLowerCase().includes(q) ||
        quote.name.toLowerCase().includes(q),
    );
  }, [quotes, query]);

  const picks: Pick[] = useMemo(
    () => [...selections].map(([ticker, direction]) => ({ ticker, direction })),
    [selections],
  );

  function togglePick(ticker: string, direction: Direction) {
    if (locked) return;
    setSelections((prev) => {
      const next = new Map(prev);
      if (next.get(ticker) === direction) {
        next.delete(ticker);
        return next;
      }
      if (!next.has(ticker) && next.size >= PICKS_PER_SLATE) {
        setNudge(true);
        window.setTimeout(() => setNudge(false), 400);
        return prev;
      }
      next.set(ticker, direction);
      return next;
    });
  }

  async function onSubmit() {
    if (picks.length !== PICKS_PER_SLATE || locked) return;
    await submit.mutateAsync(picks);
    setShareOpen(true);
  }

  if (isLoading) {
    return <BoardSkeleton name={displayName} />;
  }

  if (error || !state) {
    return (
      <p className="mt-6 text-[14px] text-muted">
        {error?.message ?? "Could not load today's slate."}
      </p>
    );
  }

  const openQuote = quotes.find((q) => q.ticker === openTicker) ?? null;
  const lockIn = countdown(state.slate.locksAt);

  return (
    <div>
      <h1 className="mx-0.5 mb-[18px] mt-0.5 text-[24px] font-extrabold tracking-[-0.03em]">
        Hello, {displayName ?? "there"}
      </h1>

      {locked ? (
        <LockedBanner
          slateDate={state.slate.slateDate}
          lockIn={lockIn}
          onShare={() => setShareOpen(true)}
        />
      ) : (
        <SearchBar
          value={query}
          onChange={setQuery}
          placeholder={`Search ${quotes.length} RWA stocks`}
          className="mb-4"
        />
      )}

      <div className="mx-0.5 mb-[13px] flex items-center justify-between">
        <div className="text-[14px] font-extrabold tracking-[-0.01em]">
          {locked ? "Your calls" : "Tomorrow's markets"}
          <span className="tnum ml-[5px] font-semibold text-faint">
            {locked ? picks.length : filtered.length}
          </span>
          {!locked && lockIn && (
            <span className="tnum ml-2 font-semibold text-faint">
              closes in {lockIn}
            </span>
          )}
        </div>
        {!locked && (
          <SegmentedToggle
            value={layout}
            onChange={setLayout}
            options={[
              { value: "grid", label: "Grid", icon: <GridIcon className="h-[15px] w-[15px]" /> },
              { value: "list", label: "List", icon: <ListIcon className="h-[15px] w-[15px]" /> },
            ]}
          />
        )}
      </div>

      <div
        className={cn(
          layout === "grid" && !locked
            ? "grid grid-cols-2 gap-[11px]"
            : "flex flex-col gap-2.5",
        )}
      >
        {(locked
          ? quotes.filter((quote) => selections.has(quote.ticker))
          : filtered
        ).map((quote) => (
          <StockCard
            key={quote.ticker}
            quote={quote}
            layout={locked ? "list" : layout}
            selected={selections.get(quote.ticker) ?? null}
            disabled={locked}
            onPick={(direction) => togglePick(quote.ticker, direction)}
            onOpen={() => setOpenTicker(quote.ticker)}
          />
        ))}
      </div>

      {!locked && filtered.length === 0 && (
        <p className="py-6 text-center text-[13px] text-faint">
          Nothing matches “{query}”.
        </p>
      )}

      {state.demo && (
        <p className="mt-6 px-0.5 text-[12px] leading-[1.5] text-faint">
          Demo data. Prices are simulated and your calls are stored in this
          browser until Supabase and a market-data key are configured.
        </p>
      )}

      {!locked ? (
        <SubmitBar
          count={picks.length}
          locked={locked}
          nudge={nudge}
          pending={submit.isPending}
          error={submit.error?.message ?? null}
          onSubmit={onSubmit}
        />
      ) : null}

      <StockSheet
        quote={openQuote}
        onClose={() => setOpenTicker(null)}
        selected={openTicker ? selections.get(openTicker) ?? null : null}
        locked={locked}
        onPick={(direction) => {
          if (openTicker) togglePick(openTicker, direction);
          setOpenTicker(null);
        }}
      />

      <PicksShareCard
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        picks={picks}
        dateLabel={slateLabel(state.slate.slateDate).toUpperCase()}
      />
    </div>
  );
}

function LockedBanner({
  slateDate,
  lockIn,
  onShare,
}: {
  slateDate: string;
  lockIn: string | null;
  onShare: () => void;
}) {
  return (
    <div className="mb-4 flex items-center gap-3 rounded-panel border border-[rgba(0,200,5,0.35)] bg-[rgba(0,200,5,0.05)] p-4">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-green-deep">
        <LockIcon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-extrabold tracking-[-0.01em]">
          Locked in for {slateLabel(slateDate)}
        </div>
        <div className="mt-0.5 text-[12.5px] text-muted">
          {lockIn ? `Picks close in ${lockIn}` : "Scores at 22:00 UTC"}
        </div>
      </div>
      <button
        type="button"
        onClick={onShare}
        className="shrink-0 rounded-pill bg-ink px-3.5 py-2.5 text-[12.5px] font-bold text-white"
      >
        Share
      </button>
    </div>
  );
}

function BoardSkeleton({ name }: { name: string | null }) {
  return (
    <div>
      <h1 className="mx-0.5 mb-[18px] mt-0.5 text-[24px] font-extrabold tracking-[-0.03em]">
        Hello, {name ?? "there"}
      </h1>
      <div className="mb-4 h-[46px] animate-pulse rounded-control bg-wash" />
      <div className="grid grid-cols-2 gap-[11px]">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-[168px] animate-pulse rounded-card bg-wash" />
        ))}
      </div>
    </div>
  );
}
