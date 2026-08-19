"use client";

import { APP_DOMAIN, APP_NAME } from "@/config/app";
import { buildSharePageUrl } from "@/lib/share-url";
import { explorerTxUrl } from "@/config/chain";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import type { Pick } from "@/lib/types";
import { Modal } from "./ui/Modal";
import { ArrowUpRightIcon, CheckIcon, XIcon } from "./ui/Icons";
import { Logo } from "./ui/Logo";

export function shareOnX(text: string, url?: string) {
  const intent = new URL("https://x.com/intent/tweet");
  intent.searchParams.set("text", text);
  // X unfurls the link into the branded card rendered by /api/share-image.
  if (url) intent.searchParams.set("url", url);

  window.open(intent.toString(), "_blank", "noopener,noreferrer");
}

function ShareFooter({
  text,
  url,
  onClose,
  dismissLabel,
}: {
  text: string;
  url?: string;
  onClose: () => void;
  dismissLabel: string;
}) {
  return (
    <div className="flex flex-col gap-[9px] bg-card px-5 pb-5 pt-4">
      <button
        type="button"
        onClick={() => shareOnX(text, url)}
        className="flex w-full items-center justify-center gap-[9px] rounded-[15px] bg-ink px-4 py-[15px] text-[15px] font-extrabold text-white"
      >
        <XIcon className="h-[17px] w-[17px]" />
        Share on X
      </button>
      <button
        type="button"
        onClick={onClose}
        className="w-full p-1.5 text-[14px] font-bold text-muted"
      >
        {dismissLabel}
      </button>
    </div>
  );
}

interface PicksShareCardProps {
  open: boolean;
  onClose: () => void;
  picks: Pick[];
  handle?: string | null;
  dateLabel: string;
}

export function PicksShareCard({
  open,
  onClose,
  picks,
  handle,
  dateLabel,
}: PicksShareCardProps) {
  const text = `these are my ${picks.length} picks for tomorrow. Head over to ${APP_DOMAIN} to play for the chance to earn some RWA.`;
  const url = buildSharePageUrl({
    type: "picks",
    picks: picks.map((pick) => `${pick.ticker}:${pick.direction}`).join(","),
    handle: handle ?? "",
  });

  return (
    <Modal open={open} onClose={onClose} bare closeTone="dark" className="overflow-hidden">
      <div className="bg-flex px-[22px] pb-5 pt-[22px] text-white">
        <div className="mb-4 flex items-center justify-between">
          <Logo size="sm" tone="white" />
          <div className="text-[11px] font-bold uppercase tracking-[0.03em] text-white/60">
            {dateLabel}
            {handle ? ` · @${handle}` : ""}
          </div>
        </div>
        <h3 className="mb-3.5 text-[20px] font-extrabold tracking-[-0.02em]">
          My {picks.length} picks for tomorrow
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {picks.map((pick) => (
            <div
              key={pick.ticker}
              className="flex items-center justify-between rounded-pill border border-white/10 bg-white/[0.07] px-[11px] py-[9px]"
            >
              <span className="text-[13px] font-extrabold">{pick.ticker}</span>
              <span
                className={cn(
                  "text-[12px] font-extrabold",
                  pick.direction === "up" ? "text-[#3DF07A]" : "text-[#FF7A73]",
                )}
              >
                {pick.direction === "up" ? "Up" : "Down"}
              </span>
            </div>
          ))}
        </div>
      </div>
      <ShareFooter text={text} url={url} onClose={onClose} dismissLabel="Maybe later" />
    </Modal>
  );
}

interface ClaimShareCardProps {
  open: boolean;
  onClose: () => void;
  amount: number;
  ticker: string;
  txHash?: string | null;
}

export function ClaimShareCard({
  open,
  onClose,
  amount,
  ticker,
  txHash,
}: ClaimShareCardProps) {
  const text = `I just claimed ${money(amount)} of ${ticker} on ${APP_NAME}. Play at ${APP_DOMAIN} to earn RWA.`;
  const url = buildSharePageUrl({
    type: "claim",
    amount: amount.toFixed(2),
    ticker,
  });

  return (
    <Modal open={open} onClose={onClose} bare closeTone="dark" className="overflow-hidden">
      <div className="bg-flex px-[22px] pb-6 pt-[30px] text-center text-white">
        <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-green shadow-[0_0_0_8px_rgba(0,200,5,0.16)]">
          <CheckIcon className="h-[30px] w-[30px] text-[#04230A]" />
        </div>
        <h3 className="text-[22px] font-extrabold tracking-[-0.02em]">
          Claimed {money(amount)} in {ticker}
        </h3>
        <p className="mt-1.5 text-[13.5px] text-white/75">
          Your reward is on its way to your wallet.
        </p>
        {txHash ? (
          <a
            href={explorerTxUrl(txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-bold text-white/70 underline underline-offset-4 transition-colors hover:text-white"
          >
            View transaction
            <ArrowUpRightIcon className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </div>
      <ShareFooter text={text} url={url} onClose={onClose} dismissLabel="Done" />
    </Modal>
  );
}
