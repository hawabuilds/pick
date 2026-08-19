"use client";

import {useMemo, useState} from "react";
import {
  claimableTickers,
  REWARD_TICKERS,
  REWARD_TICKER_NAMES,
} from "@/config/contracts";
import {cn} from "@/lib/cn";
import {money} from "@/lib/format";
import {Button} from "./ui/Button";
import {CheckIcon} from "./ui/Icons";
import {SearchBar} from "./ui/SearchBar";
import {Sheet, SheetFooter, SheetTitle} from "./ui/Sheet";

const NAMES = new Map(Object.entries(REWARD_TICKER_NAMES));

interface StockSelectSheetProps {
  open: boolean;
  onClose: () => void;
  amountUsd: number;
  pending: boolean;
  error: string | null;
  onConfirm: (ticker: string) => void;
}

/**
 * Picks which tokenized stock a reward is paid in. The list is the contract's
 * allowlist, not the pick universe: only these have a deployed token the
 * distributor will swap into.
 */
export function StockSelectSheet({
  open,
  onClose,
  amountUsd,
  pending,
  error,
  onConfirm,
}: StockSelectSheetProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const results = useMemo(() => {
    // Falls back to the full allowlist so the sheet still reads correctly
    // before the token addresses are in the environment.
    const deployed = claimableTickers();
    const tickers = deployed.length > 0 ? deployed : [...REWARD_TICKERS];

    const needle = query.trim().toLowerCase();
    if (!needle) return tickers;

    return tickers.filter(
      (ticker) =>
        ticker.toLowerCase().includes(needle) ||
        (NAMES.get(ticker) ?? "").toLowerCase().includes(needle),
    );
  }, [query]);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      height="80%"
      label="Choose a stock"
      header={<SheetTitle title="Choose a stock" onClose={onClose} />}
      footer={
        <SheetFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="dark"
            disabled={!selected || pending}
            onClick={() => selected && onConfirm(selected)}
          >
            {pending ? "Processing…" : `Claim ${money(amountUsd)}`}
          </Button>
        </SheetFooter>
      }
    >
      <p className="mb-3 mt-1 text-[13px] leading-[1.5] text-muted">
        Your {money(amountUsd)} becomes a real share in the company you choose,
        held in your own wallet. Nothing to pay.
      </p>

      <div className="mb-3">
        <SearchBar
          value={query}
          onChange={setQuery}
          placeholder="Search stocks"
        />
      </div>

      {results.length === 0 ? (
        <p className="px-1 py-6 text-center text-[13px] text-faint">
          No stocks match “{query}”.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {results.map((ticker) => {
            const isSelected = selected === ticker;
            return (
              <button
                key={ticker}
                type="button"
                onClick={() => setSelected(ticker)}
                aria-pressed={isSelected}
                className={cn(
                  "flex items-center gap-3 rounded-[14px] border px-4 py-3.5 text-left transition-colors",
                  isSelected
                    ? "border-ink bg-wash"
                    : "border-hairline bg-card hover:bg-wash",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[14.5px] font-extrabold tracking-[-0.01em]">
                    {ticker}
                  </span>
                  <span className="block truncate text-[12.5px] text-faint">
                    {NAMES.get(ticker) ?? ticker}
                  </span>
                </span>
                {isSelected ? (
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ink text-white">
                    <CheckIcon className="h-3.5 w-3.5" />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      {error ? (
        <p className="mt-3 text-[12.5px] font-medium text-red">{error}</p>
      ) : null}
    </Sheet>
  );
}
