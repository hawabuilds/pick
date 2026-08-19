"use client";

import {useState} from "react";
import type {Address} from "viem";
import {ClaimShareCard} from "@/components/ShareCard";
import {ConnectWalletSheet} from "@/components/ConnectWalletSheet";
import {StockSelectSheet} from "@/components/StockSelectSheet";
import {SectionLabel} from "@/components/ui/Card";
import {ArrowUpRightIcon, GiftIcon, TrophyIcon} from "@/components/ui/Icons";
import {explorerTxUrl} from "@/config/chain";
import {useHoldings} from "@/hooks/useHoldings";
import {useRewards} from "@/hooks/useRewards";
import {useWallet} from "@/hooks/useWallet";
import {money} from "@/lib/format";
import type {EarnedVia, Holding} from "@/lib/server/holdings";
import type {Reward} from "@/lib/server/rewards";

const EARNED_LABEL: Record<EarnedVia, string> = {
  leaderboard: "Leaderboard",
  welcome: "Lessons",
  held: "Held",
};

function quantity(value: number): string {
  if (value >= 1000) return value.toFixed(2);
  if (value >= 1) return value.toFixed(4);
  return value.toFixed(6);
}

export default function PortfolioPage() {
  const wallet = useWallet();
  const rewards = useRewards();
  const {holdings, totalUsd, isLoading: holdingsLoading, partiallyValued} =
    useHoldings();

  const [connectOpen, setConnectOpen] = useState(false);
  const [pendingReward, setPendingReward] = useState<Reward | null>(null);

  const claimableTotal = rewards.available.reduce(
    (sum, reward) => sum + reward.amountUsd,
    0,
  );

  function startClaim(reward: Reward) {
    rewards.resetClaimError();
    setPendingReward(reward);
    if (!rewards.gasless && !wallet.isConnected) {
      setConnectOpen(true);
    }
  }

  async function confirmClaim(ticker: string) {
    if (!pendingReward) return;
    try {
      if (!rewards.gasless) {
        await wallet.ensureCorrectChain();
      }
      await rewards.claim({
        reward: pendingReward,
        ticker,
        wallet: (wallet.address ?? undefined) as Address | undefined,
      });
      setPendingReward(null);
    } catch {
      // Surfaced inside the sheet via rewards.claimError.
    }
  }

  const selecting =
    pendingReward !== null &&
    (rewards.gasless || wallet.isConnected) &&
    !connectOpen;

  return (
    <div>
      <div className="mx-0.5 mb-4 mt-1.5 text-[22px] font-extrabold tracking-[-0.03em]">
        Portfolio
      </div>

      <div className="mb-5 rounded-panel border border-hairline bg-gradient-to-b from-white to-[#FAFDFB] p-[22px] shadow-panel">
        <div className="text-[11px] font-bold tracking-[0.09em] text-faint">
          TOTAL VALUE
        </div>
        <div className="tnum my-[9px] text-[40px] font-extrabold tracking-[-0.035em]">
          {holdingsLoading ? "—" : money(totalUsd)}
        </div>
        <div className="text-[13px] font-medium leading-[1.5] text-muted">
          {holdings.length === 0 && !holdingsLoading
            ? "Win a round or finish the lessons to earn your first share."
            : `${holdings.length} ${holdings.length === 1 ? "asset" : "assets"} in your wallet`}
          {claimableTotal > 0 ? (
            <>
              {" "}
              ·{" "}
              <span className="tnum font-bold text-green-deep">
                {money(claimableTotal)} ready to claim
              </span>
            </>
          ) : null}
        </div>
      </div>

      <SectionLabel>HOLDINGS</SectionLabel>
      {holdingsLoading ? (
        <SkeletonRows />
      ) : holdings.length === 0 ? (
        <EmptyHoldings />
      ) : (
        <div className="mb-5 overflow-hidden rounded-[16px] border border-hairline bg-card">
          {holdings.map((holding, index) => (
            <HoldingRow
              key={`${holding.chainId}:${holding.tokenAddress}`}
              holding={holding}
              first={index === 0}
            />
          ))}
        </div>
      )}

      {partiallyValued ? (
        <p className="-mt-3 mb-5 px-1 text-[12px] font-medium text-faint">
          Some holdings could not be priced right now, so the total is
          understated.
        </p>
      ) : null}

      <SectionLabel>READY TO CLAIM</SectionLabel>
      {rewards.isLoading ? (
        <SkeletonRows />
      ) : rewards.available.length === 0 ? (
        <div className="mb-5 rounded-[16px] border border-hairline bg-card px-4 py-5 text-center text-[13px] leading-[1.5] text-muted">
          Nothing to claim yet. Top the leaderboard or finish the lessons to
          earn your first reward.
        </div>
      ) : (
        <div className="mb-5 space-y-2.5">
          {rewards.available.map((reward) => (
            <div
              key={reward.id}
              className="flex items-center gap-[13px] rounded-[16px] border border-hairline bg-card p-[15px]"
            >
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-wash text-green-deep">
                {reward.kind === "leaderboard" ? (
                  <TrophyIcon className="h-5 w-5" />
                ) : (
                  <GiftIcon className="h-5 w-5" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[14.5px] font-bold tracking-[-0.01em]">
                  {reward.title}
                </div>
                <div className="mt-0.5 text-[12.5px] text-muted">
                  <b className="tnum font-extrabold text-ink">
                    {money(reward.amountUsd)}
                  </b>{" "}
                  · {reward.subtitle}
                </div>
              </div>
              <button
                type="button"
                onClick={() => startClaim(reward)}
                disabled={!rewards.claimable || rewards.isClaiming}
                className="whitespace-nowrap rounded-pill bg-ink px-[17px] py-[11px] text-[13px] font-bold text-white transition-transform hover:-translate-y-px disabled:translate-y-0 disabled:bg-wash disabled:text-faint"
              >
                Claim
              </button>
            </div>
          ))}
        </div>
      )}

      <SectionLabel>HISTORY</SectionLabel>
      {rewards.history.length === 0 ? (
        <div className="rounded-[16px] border border-hairline bg-card px-4 py-5 text-center text-[13px] text-faint">
          Claimed rewards show up here.
        </div>
      ) : (
        <div className="rounded-[16px] border border-hairline bg-card px-4 py-0.5">
          {rewards.history.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-3 border-b border-hairline py-3.5 last:border-b-0"
            >
              <div className="min-w-0">
                <div className="text-[13.5px] font-bold">{item.title}</div>
                <div className="tnum mt-0.5 text-[12px] text-faint">
                  {new Date(item.createdAt).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                  {item.ticker ? ` · ${item.ticker}` : ""}
                  {item.status === "pending" ? " · confirming" : ""}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <div className="tnum text-[14.5px] font-extrabold">
                  {money(item.amountUsd)}
                </div>
                {item.txHash ? (
                  <a
                    href={explorerTxUrl(item.txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="View transaction"
                    className="text-faint transition-colors hover:text-ink"
                  >
                    <ArrowUpRightIcon className="h-4 w-4" />
                  </a>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {!rewards.claimable ? (
        <p className="mt-5 px-0.5 text-[12px] leading-[1.5] text-faint">
          On-chain claims switch on once the contracts are deployed. Amounts
          shown are sample data until then.
        </p>
      ) : (
        <p className="mt-5 px-0.5 text-[12px] leading-[1.5] text-faint">
          Wallet settings live under your profile photo. Transfers stay paused
          until the contracts are audited.
        </p>
      )}

      <ConnectWalletSheet
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        connectors={wallet.connectors}
        onConnect={wallet.connectWith}
      />

      <StockSelectSheet
        open={selecting}
        onClose={() => setPendingReward(null)}
        amountUsd={pendingReward?.amountUsd ?? 0}
        pending={rewards.isClaiming}
        error={rewards.claimError}
        onConfirm={(ticker) => void confirmClaim(ticker)}
      />

      <ClaimShareCard
        open={rewards.result !== null}
        onClose={rewards.dismissResult}
        amount={rewards.result?.amountUsd ?? 0}
        ticker={rewards.result?.ticker ?? ""}
        txHash={rewards.result?.txHash ?? null}
      />
    </div>
  );
}

function HoldingRow({holding, first}: {holding: Holding; first: boolean}) {
  return (
    <div
      className={
        first
          ? "flex items-center gap-3 px-4 py-[13px]"
          : "flex items-center gap-3 border-t border-hairline px-4 py-[13px]"
      }
    >
      {holding.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={holding.logoUrl}
          alt=""
          className="h-9 w-9 shrink-0 rounded-full bg-wash object-contain"
        />
      ) : (
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-wash text-[11px] font-extrabold text-muted">
          {holding.ticker.slice(0, 2)}
        </span>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[13.5px] font-extrabold tracking-[-0.01em]">
            {holding.ticker}
          </span>
          <span className="rounded-md bg-wash px-1.5 py-0.5 text-[10px] font-bold tracking-[0.03em] text-faint">
            {EARNED_LABEL[holding.earnedVia]}
          </span>
        </div>
        <div className="truncate text-[12px] font-medium text-faint">
          {holding.name}
        </div>
      </div>

      <div className="shrink-0 text-right">
        <div className="tnum text-[13.5px] font-extrabold tracking-[-0.01em]">
          {holding.valueUsd === null ? "—" : money(holding.valueUsd)}
        </div>
        <div className="tnum text-[12px] font-medium text-faint">
          {quantity(holding.shares)} shares
        </div>
      </div>
    </div>
  );
}

function EmptyHoldings() {
  return (
    <div className="mb-5 rounded-[16px] border border-hairline bg-card px-4 py-5 text-center text-[13px] text-muted">
      No shares yet.
    </div>
  );
}

function SkeletonRows() {
  return (
    <>
      {[0, 1].map((i) => (
        <div
          key={i}
          className="mb-2.5 h-[70px] animate-pulse rounded-[16px] border border-hairline bg-wash"
        />
      ))}
    </>
  );
}
