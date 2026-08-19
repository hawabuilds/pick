"use client";

import { PICKS_PER_SLATE } from "@/config/app";
import { cn } from "@/lib/cn";
import { CheckIcon } from "./ui/Icons";

interface SubmitBarProps {
  count: number;
  locked: boolean;
  nudge: boolean;
  pending: boolean;
  error: string | null;
  onSubmit: () => void;
}

/** Sticky bar at the bottom of the Play scroll area — not portaled, so it never steals taps from stock cards. */
export function SubmitBar({
  count,
  locked,
  nudge,
  pending,
  error,
  onSubmit,
}: SubmitBarProps) {
  const ready = count === PICKS_PER_SLATE;
  const interactive = ready && !locked && !pending;

  return (
    <div className="pointer-events-none sticky bottom-0 z-20 -mx-[22px] mt-4 bg-gradient-to-t from-white from-60% to-transparent px-[22px] pb-1 pt-5">
      {error && (
        <p className="mb-2 text-center text-[12.5px] font-semibold text-red">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={!interactive}
        onClick={onSubmit}
        className={cn(
          "pointer-events-auto flex w-full items-center justify-center gap-2 rounded-[15px]",
          "px-4 py-4 text-[15px] font-extrabold tracking-[-0.01em] transition-all duration-200",
          "disabled:cursor-not-allowed",
          locked
            ? "bg-ink text-white"
            : ready
              ? "bg-green text-[#04230A] shadow-green hover:-translate-y-0.5"
              : "bg-wash text-faint",
          nudge && "animate-nudge",
        )}
      >
        {locked ? (
          <>
            <CheckIcon className="h-4 w-4" />
            {PICKS_PER_SLATE} calls locked for tomorrow
          </>
        ) : (
          <>
            <span>
              {pending
                ? "Locking in"
                : ready
                  ? "Lock in tomorrow's calls"
                  : "Pick tomorrow's calls"}
            </span>
            <span className="tnum opacity-85">
              {count}/{PICKS_PER_SLATE}
            </span>
          </>
        )}
      </button>
    </div>
  );
}
