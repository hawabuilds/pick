"use client";

import { Avatar } from "@/components/ui/Avatar";
import { useLeaderboard } from "@/hooks/useLeaderboard";
import { useUser } from "@/hooks/useUser";
import { cn } from "@/lib/cn";
import { countdown } from "@/lib/format";
import type { LeaderboardRow } from "@/lib/types";

export default function LeaderboardPage() {
  const { user } = useUser();
  const { data, isLoading, error, loadMore, hasMore, isFetching } =
    useLeaderboard();

  const me = data?.me ?? null;
  const rows = data?.rows ?? [];
  const meIsListed = rows.some((row) => row.userId === me?.userId);
  const resetsIn = data?.season ? countdown(data.season.endsAt) : null;

  return (
    <div>
      <div className="mx-0.5 mb-4 mt-1.5 flex items-baseline justify-between gap-3">
        <h2 className="text-[22px] font-extrabold tracking-[-0.03em]">
          Leaderboard
        </h2>
        <span className="shrink-0 text-[12px] font-semibold text-faint">
          {resetsIn ? `Resets in ${resetsIn}` : "Season closed"}
        </span>
      </div>

      {data?.season && (
        <p className="mx-0.5 mb-4 text-[12.5px] text-muted">
          {data.season.cadence === "daily" ? "Daily" : "3-day"} season ·{" "}
          {formatWindow(data.season.startsAt, data.season.endsAt)}
        </p>
      )}

      {isLoading && <RowsSkeleton />}

      {error && (
        <p className="mt-6 text-[14px] text-muted">{(error as Error).message}</p>
      )}

      {!isLoading && !error && rows.length === 0 && (
        <p className="mt-6 text-[13.5px] leading-[1.55] text-muted">
          No scores yet this season. The board fills in after the first slate
          resolves.
        </p>
      )}

      {rows.map((row) => (
        <Row key={row.userId} row={row} me={row.userId === me?.userId} />
      ))}

      {hasMore && (
        <button
          type="button"
          onClick={loadMore}
          disabled={isFetching}
          className="mt-1 w-full rounded-[15px] border border-hairline bg-card py-3.5 text-[13.5px] font-bold text-muted transition-colors hover:bg-wash disabled:text-faint"
        >
          {isFetching ? "Loading" : `Show more (${data!.total - rows.length} left)`}
        </button>
      )}

      {/* Pinned so a player ranked far down the board can still see themselves. */}
      {me && !meIsListed && (
        <>
          <div className="mx-0.5 mb-3 mt-5 text-[11px] font-bold tracking-[0.09em] text-faint">
            YOUR RANK
          </div>
          <Row row={me} me />
        </>
      )}

      {data?.demo && (
        <p className="mt-5 px-0.5 text-[12px] leading-[1.5] text-faint">
          Demo standings. Real ranks appear once Supabase is configured and the
          resolution job has scored a slate.
        </p>
      )}

      {!data?.demo && me && (
        <p className="mt-5 px-0.5 text-[12.5px] text-faint">
          {me.points} {me.points === 1 ? "point" : "points"} from{" "}
          {me.slatesPlayed} {me.slatesPlayed === 1 ? "slate" : "slates"} this
          season.
        </p>
      )}

      {!data?.demo && !me && !isLoading && (
        <p className="mt-5 px-0.5 text-[12.5px] text-faint">
          {user
            ? "You have no scored slates this season yet."
            : "Sign in to see your rank."}
        </p>
      )}
    </div>
  );
}

function Row({ row, me }: { row: LeaderboardRow; me: boolean }) {
  return (
    <div
      className={cn(
        "mb-[9px] flex items-center gap-3 rounded-[15px] border border-hairline bg-card px-3.5 py-[11px]",
        me && "border-[rgba(0,200,5,0.4)] bg-[rgba(0,200,5,0.05)]",
      )}
    >
      <div
        className={cn(
          "tnum w-6 text-center text-[15px] font-extrabold",
          row.rank <= 3 ? "text-green-deep" : "text-faint",
        )}
      >
        {row.rank}
      </div>
      <Avatar name={row.displayName} src={row.pfpUrl} size={38} />
      <div className="min-w-0 flex-1">
        <b className="block truncate text-[14px] font-bold">{row.displayName}</b>
        {row.handle && (
          <small className="text-[12px] text-faint">@{row.handle}</small>
        )}
      </div>
      <div className="tnum text-[16px] font-extrabold">{row.points}</div>
    </div>
  );
}

function formatWindow(startsAt: string, endsAt: string) {
  const options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  const start = new Date(startsAt).toLocaleDateString("en-GB", options);
  const end = new Date(endsAt).toLocaleDateString("en-GB", options);
  return `${start} – ${end}`;
}

function RowsSkeleton() {
  return (
    <div>
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="mb-[9px] h-[62px] animate-pulse rounded-[15px] bg-wash"
        />
      ))}
    </div>
  );
}
