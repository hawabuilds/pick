"use client";

import {useEffect, useRef, useState} from "react";
import Link from "next/link";
import {LessonSheet} from "@/components/LessonSheet";
import {shareOnX} from "@/components/ShareCard";
import {Button} from "@/components/ui/Button";
import {CheckIcon, ClockIcon, LockIcon, XIcon} from "@/components/ui/Icons";
import {useLearn} from "@/hooks/useLearn";
import {useUser} from "@/hooks/useUser";
import {cn} from "@/lib/cn";
import {learnShareParams, shareText, publicLessons, type PublicLesson} from "@/lib/learn";
import {buildSharePageUrl} from "@/lib/share-url";
import {useSession} from "@/lib/session";

/**
 * The Learn tab, which doubles as the guided first run.
 *
 * A new player is sent straight here after signing up and is walked from "what
 * is a real-world asset" to owning one. They are not trapped: the tabs work
 * from the first second, and the guide simply waits where they left it.
 *
 * No wallet vocabulary appears anywhere in here. The embedded wallet already
 * exists by the time this renders and the player never has to know.
 */
export default function LearnPage() {
  const learn = useLearn();
  const {displayName} = useUser();
  const {getAccessToken, needsOnboarding, markOnboarded} = useSession();
  const [active, setActive] = useState<PublicLesson | null>(null);
  const [shareUrl, setShareUrl] = useState("");
  const marked = useRef(false);

  const lessons =
    learn.lessons.length > 0 ? learn.lessons : publicLessons();

  // Arriving here is what counts as onboarded, not finishing the lessons. The
  // guide is theirs to leave and come back to, and a player who reloads on
  // another tab should stay there rather than being pulled back in.
  useEffect(() => {
    if (needsOnboarding !== true || marked.current) return;
    marked.current = true;
    markOnboarded();

    void (async () => {
      try {
        const token = await getAccessToken();
        await fetch("/api/onboarding/complete", {
          method: "POST",
          headers: token ? {authorization: `Bearer ${token}`} : undefined,
        });
      } catch {
        // Marked locally either way. Worst case they land here once more.
      }
    })();
  }, [needsOnboarding, markOnboarded, getAccessToken]);

  const progress = learn.progress;
  const done = new Set(progress?.completed ?? []);
  const allDone = progress
    ? progress.completed.length === lessons.length
    : false;
  const notStarted = progress !== null && progress.completed.length === 0;

  const activeIndex = active
    ? lessons.findIndex((lesson) => lesson.id === active.id)
    : -1;
  const nextLesson =
    activeIndex >= 0 ? lessons[activeIndex + 1] : undefined;

  if (learn.isLoading && !progress) {
    return <LearnSkeleton />;
  }

  if (learn.error && !progress) {
    return (
      <div className="mt-6 rounded-panel border border-hairline bg-card px-5 py-8 text-center">
        <p className="text-[14px] font-medium text-muted">{learn.error}</p>
        <Button
          variant="dark"
          fullWidth
          className="mt-4"
          onClick={() => void learn.refetch()}
        >
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div>
      {progress === null ? null : notStarted ? (
        <Welcome
          name={displayName}
          rewardUsd={progress.rewardUsd}
          onStart={() => setActive(lessons[0] ?? null)}
        />
      ) : (
        <div className="mb-3.5 mt-1.5 rounded-panel border border-hairline bg-card p-[22px] text-center">
          <div className="tnum text-[32px] font-extrabold tracking-[-0.03em] text-green-deep">
            +${progress.rewardUsd}
          </div>
          <h3 className="mb-1.5 mt-2 text-[18px] font-extrabold tracking-[-0.02em]">
            Earn your first real stock
          </h3>
          <p className="text-[13px] leading-[1.5] text-muted">
            Finish three quick lessons and share on X. We&apos;ll drop $
            {progress.rewardUsd} of a real share into your wallet — you pick
            which one.
          </p>
          {!progress.rewarded ? (
            <div className="mt-3 text-[11.5px] font-bold tracking-[0.04em] text-faint">
              {progress.seatsLeft > 0
                ? `${progress.seatsLeft} SEATS LEFT THIS SEASON`
                : "SEATS FULL — JOIN THE WAITLIST"}
            </div>
          ) : null}
        </div>
      )}

      {lessons.map((lesson, index) => {
        const complete = done.has(lesson.id);
        // Lessons unlock in order so the quick checks build on each other.
        const locked = index > (progress?.completed.length ?? 0);

        return (
          <button
            key={lesson.id}
            type="button"
            disabled={locked}
            onClick={() => setActive(lesson)}
            className={cn(
              "mb-[9px] flex w-full items-center gap-3 rounded-[15px] border border-hairline bg-card px-3.5 py-[13px] text-left transition-colors",
              locked ? "opacity-55" : "hover:bg-wash",
            )}
          >
            <div
              className={cn(
                "tnum grid h-[26px] w-[26px] shrink-0 place-items-center rounded-lg text-[12px] font-extrabold",
                complete ? "bg-green text-[#04230A]" : "bg-wash text-green-deep",
              )}
            >
              {complete ? <CheckIcon className="h-3.5 w-3.5" /> : index + 1}
            </div>
            <div className="min-w-0 flex-1">
              <b className="text-[13.5px] font-bold">{lesson.title}</b>
              <small className="mt-px block text-[11.5px] text-faint">
                {lesson.summary} · {lesson.minutes} min
              </small>
            </div>
            {locked ? (
              <LockIcon className="h-4 w-4 shrink-0 text-faint" />
            ) : complete ? (
              <span className="text-[11.5px] font-bold text-green-deep">Done</span>
            ) : (
              <ClockIcon className="h-4 w-4 shrink-0 text-faint" />
            )}
          </button>
        );
      })}

      {progress ? (
        <RewardPanel
          status={progress.status}
          rewardUsd={progress.rewardUsd}
          allDone={allDone}
          shareUrl={shareUrl}
          onShareUrlChange={setShareUrl}
          onShare={() =>
            shareOnX(
              shareText(),
              buildSharePageUrl(learnShareParams(progress.rewardUsd)),
            )
          }
          onSubmit={() => void learn.claimReward(shareUrl).catch(() => undefined)}
          submitting={learn.isClaiming}
          error={learn.rewardError}
          message={learn.rewardResult?.message ?? null}
        />
      ) : null}

      <LessonSheet
        lesson={active}
        open={active !== null}
        onClose={() => setActive(null)}
        checking={learn.isChecking}
        result={learn.answerResult}
        error={learn.answerError}
        onReset={learn.resetAnswer}
        onNext={
          nextLesson
            ? () => {
                learn.resetAnswer();
                setActive(nextLesson);
              }
            : undefined
        }
        onAnswer={(choice) => {
          if (!active) return;
          void learn
            .submitAnswer({lessonId: active.id, answer: choice})
            .catch(() => undefined);
        }}
      />
    </div>
  );
}

/**
 * The first thing a brand-new player sees, carried over from the standalone
 * first run this tab replaced. It sells the destination — owning a real share —
 * rather than the game, because that is what they are here for.
 */
function LearnSkeleton() {
  return (
    <div>
      <div className="mb-3.5 mt-1.5 h-[220px] animate-pulse rounded-panel bg-wash" />
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="mb-[9px] h-[62px] animate-pulse rounded-[15px] bg-wash"
        />
      ))}
    </div>
  );
}

function Welcome({
  name,
  rewardUsd,
  onStart,
}: {
  name: string | null;
  rewardUsd: number;
  onStart: () => void;
}) {
  return (
    <div className="mb-3.5 mt-1.5 rounded-panel border border-hairline bg-card p-[22px]">
      <h1 className="mb-3 text-[26px] font-extrabold leading-[1.14] tracking-[-0.035em]">
        {name ? `Welcome, ${name}.` : "Welcome."}
        <br />
        Own your first real share.
      </h1>

      <p className="mb-5 text-[14px] leading-[1.6] text-muted">
        Three short lessons, about five minutes. At the end you can claim $
        {rewardUsd} of a real company — Apple, Tesla, whichever you like — and it
        is yours to keep.
      </p>

      <Button variant="green" fullWidth onClick={onStart}>
        Start
      </Button>
    </div>
  );
}

function RewardPanel({
  status,
  rewardUsd,
  allDone,
  shareUrl,
  onShareUrlChange,
  onShare,
  onSubmit,
  submitting,
  error,
  message,
}: {
  status: string;
  rewardUsd: number;
  allDone: boolean;
  shareUrl: string;
  onShareUrlChange: (value: string) => void;
  onShare: () => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
  message: string | null;
}) {
  if (status === "granted") {
    return (
      <Note tone="good">
        Your ${rewardUsd} reward is unlocked. Head to{" "}
        <Link href="/portfolio" className="font-bold underline underline-offset-2">
          Portfolio
        </Link>{" "}
        to choose which stock it lands in.
      </Note>
    );
  }

  if (!allDone) {
    return (
      <Note>
        Finish all three lessons to unlock your ${rewardUsd} reward. It takes
        about five minutes.
      </Note>
    );
  }

  if (status === "waitlisted") {
    return (
      <Note>
        Every seat for this season has gone. You keep your place — unclaimed
        seats roll into next season and you will be first in line.
      </Note>
    );
  }

  if (status === "account_too_new") {
    return (
      <Note>
        Your X account is too new to qualify for the learner reward. You can
        still play every slate and win on the leaderboard.
      </Note>
    );
  }

  const claimBlocked = status === "needs_slate";

  return (
    <div className="mt-4 rounded-panel border border-hairline bg-card p-5">
      <h4 className="text-[15px] font-extrabold tracking-[-0.02em]">
        Share on X to finish
      </h4>
      <p className="mt-1.5 text-[13px] leading-[1.5] text-muted">
        Tap Post on X below — it pre-fills your post with the card link. Then
        paste the link to that post here. One reward per X account.
      </p>

      {claimBlocked ? (
        <p className="mt-3 rounded-[12px] bg-wash px-3.5 py-3 text-[12.5px] leading-[1.5] text-muted">
          To claim your ${rewardUsd}, submit a full slate on the{" "}
          <Link href="/play" className="font-bold underline underline-offset-2">
            Play
          </Link>{" "}
          tab first. You can share now — claim unlocks after your first set of
          calls.
        </p>
      ) : null}

      <Button variant="dark" fullWidth className="mt-3.5" onClick={onShare}>
        <XIcon className="h-[17px] w-[17px]" />
        Post on X
      </Button>

      <input
        type="url"
        inputMode="url"
        value={shareUrl}
        onChange={(e) => onShareUrlChange(e.target.value)}
        placeholder="https://x.com/you/status/…"
        aria-label="Link to your post"
        className="mt-2.5 w-full rounded-control border border-hairline bg-card px-[15px] py-[13px] text-[14px] font-medium outline-none transition-[border-color,box-shadow] placeholder:text-faint focus:border-[rgba(0,200,5,0.5)] focus:shadow-[0_0_0_3px_rgba(0,200,5,0.1)]"
      />

      <Button
        variant="green"
        fullWidth
        className="mt-2.5"
        disabled={shareUrl.trim().length === 0 || submitting || claimBlocked}
        onClick={onSubmit}
      >
        {submitting
          ? "Checking your post…"
          : claimBlocked
            ? "Submit picks on Play to claim"
            : `Claim $${rewardUsd}`}
      </Button>

      {error ? (
        <p className="mt-2.5 text-[12.5px] font-medium text-red">{error}</p>
      ) : null}
      {message && !error ? (
        <p className="mt-2.5 text-[12.5px] font-medium text-green-deep">{message}</p>
      ) : null}
    </div>
  );
}

function Note({
  children,
  tone = "plain",
}: {
  children: React.ReactNode;
  tone?: "plain" | "good";
}) {
  return (
    <p
      className={cn(
        "mt-4 rounded-[15px] border border-hairline px-4 py-3.5 text-[12.5px] leading-[1.55]",
        tone === "good" ? "bg-wash text-ink" : "bg-card text-muted",
      )}
    >
      {children}
    </p>
  );
}
