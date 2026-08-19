import {APP_DOMAIN, APP_NAME, PICKS_PER_SLATE} from "@/config/app";

export interface QuickCheck {
  question: string;
  options: string[];
  /** Index into `options`. Checked on the server; never sent to the client. */
  answer: number;
  /** Shown after a correct answer to make the point stick. */
  explanation: string;
}

export interface Lesson {
  id: string;
  title: string;
  minutes: number;
  summary: string;
  body: string[];
  quickCheck: QuickCheck;
}

export const LESSONS: Lesson[] = [
  {
    id: "what-is-an-rwa",
    title: "What is an RWA?",
    minutes: 2,
    summary: "Real-world assets, on-chain.",
    body: [
      "A real-world asset, or RWA, is something that exists off-chain — a share in a company, a bond, a bar of gold — represented by a token on a blockchain.",
      "The token is not the company. It is a claim, backed by a custodian who actually holds the underlying asset. That backing is what separates an RWA from a token that merely tracks a price.",
      `On ${APP_NAME} the rewards are tokenized stocks on Robinhood Chain. When you claim $10 in TSLA, you receive a token whose value is tied to Tesla shares rather than a points balance that only means something inside this app.`,
      "Two things follow from that. Your reward keeps moving with the market after you claim it, and it sits in a wallet that belongs to you rather than in an account we control.",
      "There are 194 of these to call on, from Apple to gold to short-dated treasuries. Anyone, anywhere, can hold them — that is the part that is genuinely new.",
    ],
    quickCheck: {
      question: "What makes a token an RWA rather than just a price tracker?",
      options: [
        "It trades on a decentralised exchange",
        "A custodian holds the underlying asset that backs it",
        "Its price moves when the stock market moves",
      ],
      answer: 1,
      explanation:
        "Backing is the whole point. Without a custodian holding the real asset, a token can follow a price without ever being a claim on anything.",
    },
  },
  {
    id: "calls-and-leaderboard",
    title: "How calls & the leaderboard work",
    minutes: 2,
    summary: "Ten calls a day, scored on the close.",
    body: [
      `Every trading day you make ${PICKS_PER_SLATE} calls: for each stock you choose, you say whether it will finish up or down.`,
      "Your calls lock at 22:00 UTC, an hour after the US market closes, and they are for the next trading day. After the lock they cannot be changed — which is the point, since a call you can edit halfway through the day is not a call.",
      "That same instant is when we record the price everything is measured from, so nobody can watch the market move and then get their calls in.",
      "The next evening each call is scored against Robinhood's own price for that stock, compared with the day before. One point per correct call.",
      "Sometimes a stock cannot be scored fairly — it was paused, or it paid a dividend, which drops the price for reasons that have nothing to do with the company. Those are voided and score nothing either way, for everyone.",
      "Points accumulate across a season. The leaderboard ranks players by total points, and at the end of the season the top 20 receive a payout in the stock of their choice.",
      "Playing every day matters more than any single day. Streaks are tracked, and you get one freeze so a single missed day does not wipe out a long run.",
    ],
    quickCheck: {
      question: "When do your calls lock?",
      options: [
        "When you have made all ten",
        "At 22:00 UTC, the evening before they count",
        "At the end of the day they are scored on",
      ],
      answer: 1,
      explanation:
        "The lock and the starting price happen at the same moment. That is what stops anyone from calling a move they have already seen.",
    },
  },
  {
    id: "first-call",
    title: "Make your first call",
    minutes: 1,
    summary: "From picking to getting paid.",
    body: [
      `Open the Play tab and you will see all 194 stocks. Search for one you have a view on, then tap Up or Down. Repeat until you have ${PICKS_PER_SLATE}.`,
      "Tap Submit before the lock. You will get a share card with your calls on it, which you can post if you want to put your reputation behind them.",
      "The next evening your slate is scored and the leaderboard updates. Anything you have earned appears under Portfolio.",
      "To claim, choose which stock you want to be paid in and confirm. Your wallet was set up for you when you signed in, so there is nothing to install and nothing to pay — the shares simply arrive.",
      `Nothing here costs money. ${APP_NAME} is free to play at ${APP_DOMAIN} — the rewards come from the protocol, not from other players.`,
    ],
    quickCheck: {
      question: "What do you pay to enter a slate?",
      options: [
        "Nothing — it is free to play",
        "A small entry fee in the quote token",
        "10% of any reward you later claim",
      ],
      answer: 0,
      explanation:
        "There is no buy-in and no rake. If anything ever asks you to pay to play, it is not this app.",
    },
  },
];

export const LESSON_COUNT = LESSONS.length;

/** The client never receives the answer key. */
export type PublicLesson = Omit<Lesson, "quickCheck"> & {
  quickCheck: Omit<QuickCheck, "answer" | "explanation">;
};

export function publicLessons(): PublicLesson[] {
  return LESSONS.map(({quickCheck, ...lesson}) => ({
    ...lesson,
    quickCheck: {question: quickCheck.question, options: quickCheck.options},
  }));
}

export function lessonIndex(id: string): number {
  return LESSONS.findIndex((lesson) => lesson.id === id);
}

/** Lesson ids completed when `tasksDone` quick checks have passed, in order. */
export function completedLessonIds(tasksDone: number): string[] {
  return LESSONS.slice(0, Math.min(tasksDone, LESSON_COUNT)).map(
    (lesson) => lesson.id,
  );
}

export const LEARNER_REWARD_USD = 10;

export function shareText(): string {
  return `I just finished the ${APP_NAME} lessons and earned my first real-world asset. Play free at ${APP_DOMAIN}.`;
}

export function learnShareParams(rewardUsd = LEARNER_REWARD_USD): Record<string, string> {
  return {type: "learn", amount: String(rewardUsd)};
}
