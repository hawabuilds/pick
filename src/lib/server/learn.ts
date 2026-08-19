import {LEARNER_REWARD_USD, LESSONS, LESSON_COUNT} from "@/lib/learn";
import {db} from "./db";
import {getActiveSeason} from "./seasons";

/**
 * The learner reward: $10 of a real stock for finishing the lessons.
 *
 * It is the most farmable thing in the app — it pays real value to a brand new
 * account — so every gate here exists to answer one question: is this a player
 * or a script? The gates are, in order of how much they matter:
 *
 *   1. The X account must be older than MIN_X_ACCOUNT_AGE_DAYS.
 *   2. The player must have submitted at least one real slate.
 *   3. The share post must be verified live via the X API (see ./x.ts).
 *   4. Seats are capped per season, and one reward per account, ever.
 */

const MIN_X_ACCOUNT_AGE_DAYS = Number(
  process.env.MIN_X_ACCOUNT_AGE_DAYS ?? "30",
);

/** Seats per season. Unfilled seats roll forward rather than expiring. */
export const LEARNER_SEATS_PER_SEASON = Number(
  process.env.LEARNER_SEATS_PER_SEASON ?? "50",
);

export type LearnerStatus =
  | "in_progress"
  | "needs_slate"
  | "account_too_new"
  | "needs_share"
  | "waitlisted"
  | "granted";

export interface LearnerState {
  completed: string[];
  sharedOnX: boolean;
  rewarded: boolean;
  waitlisted: boolean;
  seatsLeft: number;
  status: LearnerStatus;
  rewardUsd: number;
}

interface ProgressRow {
  tasks_done: number;
  shared_on_x: boolean;
  rewarded: boolean;
  waitlisted: boolean;
  season_id: number | null;
}

/**
 * Lessons are stored as a count rather than a set of ids, so progress is only
 * meaningful in order. That is fine — the UI walks them in order — and it keeps
 * the row a single integer that cannot drift out of sync with the content.
 */
function completedIds(tasksDone: number): string[] {
  return LESSONS.slice(0, tasksDone).map((lesson) => lesson.id);
}

async function readProgress(userId: string): Promise<ProgressRow> {
  const {data} = await db()
    .from("learner_progress")
    .select("tasks_done, shared_on_x, rewarded, waitlisted, season_id")
    .eq("user_id", userId)
    .maybeSingle();

  return (
    (data as ProgressRow | null) ?? {
      tasks_done: 0,
      shared_on_x: false,
      rewarded: false,
      waitlisted: false,
      season_id: null,
    }
  );
}

/**
 * Seats available right now.
 *
 * Rolling unspent seats forward is the whole reason this counts cumulatively:
 * the allowance is `seats × seasons started` minus everything ever granted, so
 * a quiet season leaves its seats on the table for the next one.
 */
export async function seatsRemaining(): Promise<number> {
  const supabase = db();

  const {count: seasonsStarted} = await supabase
    .from("seasons")
    .select("id", {count: "exact", head: true})
    .lte("starts_at", new Date().toISOString());

  const {count: granted} = await supabase
    .from("learner_progress")
    .select("user_id", {count: "exact", head: true})
    .eq("rewarded", true);

  const allowance = Math.max(seasonsStarted ?? 1, 1) * LEARNER_SEATS_PER_SEASON;
  return Math.max(allowance - (granted ?? 0), 0);
}

async function hasPlayedASlate(userId: string): Promise<boolean> {
  const {count} = await db()
    .from("submissions")
    .select("slate_date", {count: "exact", head: true})
    .eq("user_id", userId)
    .eq("counted", true);
  return (count ?? 0) > 0;
}

async function xAccountOldEnough(userId: string): Promise<boolean> {
  const {data} = await db()
    .from("users")
    .select("x_account_created_at")
    .eq("id", userId)
    .maybeSingle();

  // An unknown creation date fails the check rather than passing it. Privy
  // supplies it for X logins; anything else is not a verified X account.
  if (!data?.x_account_created_at) return false;

  const ageDays =
    (Date.now() - new Date(data.x_account_created_at).getTime()) / 86400000;
  return ageDays >= MIN_X_ACCOUNT_AGE_DAYS;
}

export async function getLearnerState(userId: string): Promise<LearnerState> {
  const progress = await readProgress(userId);
  const seatsLeft = await seatsRemaining();

  let status: LearnerStatus = "in_progress";
  if (progress.rewarded) {
    status = "granted";
  } else if (progress.tasks_done < LESSON_COUNT) {
    status = "in_progress";
  } else if (!(await xAccountOldEnough(userId))) {
    status = "account_too_new";
  } else if (!(await hasPlayedASlate(userId))) {
    status = "needs_slate";
  } else if (seatsLeft <= 0) {
    // Checked before the share step so a waitlisted player is told before they
    // post rather than after.
    status = "waitlisted";
  } else {
    status = "needs_share";
  }

  return {
    completed: completedIds(progress.tasks_done),
    sharedOnX: progress.shared_on_x,
    rewarded: progress.rewarded,
    waitlisted: progress.waitlisted,
    seatsLeft,
    status,
    rewardUsd: LEARNER_REWARD_USD,
  };
}

/** Records a passed quick check. Progress only ever moves forward. */
export async function completeLesson(
  userId: string,
  index: number,
): Promise<LearnerState> {
  const progress = await readProgress(userId);
  if (index > progress.tasks_done) {
    throw new Error("Finish the earlier lessons first.");
  }

  const tasksDone = Math.min(Math.max(progress.tasks_done, index + 1), LESSON_COUNT);

  if (tasksDone !== progress.tasks_done) {
    const {error} = await db()
      .from("learner_progress")
      .upsert(
        {user_id: userId, tasks_done: tasksDone, updated_at: new Date().toISOString()},
        {onConflict: "user_id"},
      );
    if (error) throw error;
  }

  return getLearnerState(userId);
}

export interface GrantResult {
  state: LearnerState;
  granted: boolean;
  message: string;
}

/**
 * Runs the gates and, if they all pass, creates the welcome claim. The claim
 * itself is paid out through the same ClaimDistributor flow as a leaderboard
 * prize; this only decides whether one is owed.
 */
export async function grantLearnerReward(options: {
  userId: string;
  shareUrl: string;
}): Promise<GrantResult> {
  const supabase = db();
  const progress = await readProgress(options.userId);

  if (progress.rewarded) {
    return {
      state: await getLearnerState(options.userId),
      granted: false,
      message: "You have already claimed this reward.",
    };
  }

  if (progress.tasks_done < LESSON_COUNT) {
    return {
      state: await getLearnerState(options.userId),
      granted: false,
      message: "Finish all three lessons first.",
    };
  }

  if (!(await xAccountOldEnough(options.userId))) {
    return {
      state: await getLearnerState(options.userId),
      granted: false,
      message: `Your X account needs to be at least ${MIN_X_ACCOUNT_AGE_DAYS} days old.`,
    };
  }

  if (!(await hasPlayedASlate(options.userId))) {
    return {
      state: await getLearnerState(options.userId),
      granted: false,
      message: "Submit a full slate of picks first, then come back.",
    };
  }

  const season = await getActiveSeason();
  const seatsLeft = await seatsRemaining();

  if (seatsLeft <= 0) {
    await supabase.from("learner_progress").upsert(
      {
        user_id: options.userId,
        shared_on_x: true,
        share_url: options.shareUrl,
        share_verified_at: new Date().toISOString(),
        waitlisted: true,
        season_id: season?.id ?? null,
        updated_at: new Date().toISOString(),
      },
      {onConflict: "user_id"},
    );

    return {
      state: await getLearnerState(options.userId),
      granted: false,
      message:
        "All the seats for this season are taken. You are on the waitlist and keep your place next season.",
    };
  }

  // The claim row is created first: if marking progress fails afterwards the
  // player still has their reward, which is the failure we would rather have.
  const {error: claimError} = await supabase.from("claims").insert({
    user_id: options.userId,
    type: "welcome",
    amount_usd: LEARNER_REWARD_USD,
    season_id: season?.id ?? null,
    status: "available",
  });

  if (claimError) {
    // The one-welcome-per-user index is the backstop against a double grant.
    if (claimError.code === "23505") {
      return {
        state: await getLearnerState(options.userId),
        granted: false,
        message: "You have already claimed this reward.",
      };
    }
    throw claimError;
  }

  const {error: progressError} = await supabase.from("learner_progress").upsert(
    {
      user_id: options.userId,
      tasks_done: LESSON_COUNT,
      shared_on_x: true,
      share_url: options.shareUrl,
      share_verified_at: new Date().toISOString(),
      rewarded: true,
      rewarded_at: new Date().toISOString(),
      waitlisted: false,
      season_id: season?.id ?? null,
      updated_at: new Date().toISOString(),
    },
    {onConflict: "user_id"},
  );
  if (progressError) throw progressError;

  return {
    state: await getLearnerState(options.userId),
    granted: true,
    message: `$${LEARNER_REWARD_USD} is waiting on Portfolio. Pick which stock you want it in.`,
  };
}

/** Shown when Supabase is not configured, so the tab is still explorable. */
export function demoLearnerState(): LearnerState {
  return {
    completed: [],
    sharedOnX: false,
    rewarded: false,
    waitlisted: false,
    seatsLeft: LEARNER_SEATS_PER_SEASON,
    status: "in_progress",
    rewardUsd: LEARNER_REWARD_USD,
  };
}
