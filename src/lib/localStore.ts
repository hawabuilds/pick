import type { Submission } from "./types";

import type { StockComment } from "./types";

const KEY = "pick.submissions";

type Store = Record<string, Submission>;

function read(): Store {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Store;
  } catch {
    return {};
  }
}

/**
 * Submissions made while Supabase is unconfigured. Development only — this is
 * how the pick-10-and-lock-in loop stays exercisable without a database.
 */
export function readLocalSubmission(slateDate: string): Submission | null {
  return read()[slateDate] ?? null;
}

export function writeLocalSubmission(submission: Submission): void {
  if (typeof window === "undefined") return;
  const store = read();
  store[submission.slateDate] = submission;
  window.localStorage.setItem(KEY, JSON.stringify(store));
}

const LEARN_KEY = "pick.learn-tasks";

/** How many lesson quick checks passed in demo / offline mode. */
export function readLocalLearnTasks(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(LEARN_KEY);
    const n = raw === null ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(n) ? Math.min(Math.max(n, 0), 3) : 0;
  } catch {
    return 0;
  }
}

export function writeLocalLearnTasks(tasksDone: number): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    LEARN_KEY,
    String(Math.min(Math.max(tasksDone, 0), 3)),
  );
}

const COMMENTS_KEY = "pick.stock-comments";

type CommentStore = Record<string, StockComment[]>;

function readComments(): CommentStore {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(
      window.localStorage.getItem(COMMENTS_KEY) ?? "{}",
    ) as CommentStore;
  } catch {
    return {};
  }
}

function writeComments(store: CommentStore): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(COMMENTS_KEY, JSON.stringify(store));
}

/** Per-ticker comments stored locally when Supabase is unconfigured. */
export function readLocalComments(ticker: string) {
  const key = ticker.toUpperCase();
  return (readComments()[key] ?? []).slice().sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export function appendLocalComment(
  ticker: string,
  comment: StockComment,
): void {
  const key = ticker.toUpperCase();
  const store = readComments();
  const existing = store[key] ?? [];
  store[key] = [comment, ...existing.filter((row) => row.id !== comment.id)];
  writeComments(store);
}
