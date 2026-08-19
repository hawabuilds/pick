"use client";

import {useState, type KeyboardEvent} from "react";
import {commentTimestamp} from "@/lib/format";
import {useStockComments} from "@/hooks/useStockComments";
import type {StockComment} from "@/lib/types";
import {Avatar} from "./ui/Avatar";

interface StockCommentsProps {
  ticker: string;
}

function authorLabel(handle: string | null, displayName: string | null) {
  if (handle) return `@${handle.replace(/^@/, "")}`;
  if (displayName?.trim()) return displayName.trim();
  return "Player";
}

function CommentRow({comment}: {comment: StockComment}) {
  const name =
    comment.author.displayName ?? comment.author.handle ?? "Player";

  return (
    <li className="flex gap-2.5 border-b border-hairline px-4 py-2.5 last:border-b-0">
      <Avatar
        name={name}
        src={comment.author.pfpUrl}
        size={28}
        className="mt-0.5 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[13px] font-extrabold tracking-[-0.01em]">
            {authorLabel(comment.author.handle, comment.author.displayName)}
          </span>
          <time
            dateTime={comment.createdAt}
            className="text-[11.5px] font-medium text-faint"
          >
            {commentTimestamp(comment.createdAt)}
          </time>
        </div>
        <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-[1.45] text-muted">
          {comment.body}
        </p>
      </div>
    </li>
  );
}

export function StockComments({ticker}: StockCommentsProps) {
  const [draft, setDraft] = useState("");
  const {
    comments,
    isLoading,
    error,
    postComment,
    isPosting,
    postError,
    canPost,
    localOnly,
    offline,
  } = useStockComments(ticker);

  const trimmed = draft.trim();
  const remaining = 500 - draft.length;
  const atLimit = draft.length >= 500;
  const showCounter = draft.length > 0;
  const showFade = comments.length > 2;

  async function handleSubmit() {
    if (!trimmed || isPosting) return;
    await postComment(trimmed);
    setDraft("");
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    void handleSubmit();
  }

  const countLabel =
    comments.length === 1 ? "1 read" : `${comments.length} reads`;

  return (
    <section className="mt-6">
      <div className="flex flex-col overflow-hidden rounded-panel border border-hairline bg-card shadow-panel">
        <div className="flex shrink-0 items-center justify-between border-b border-hairline px-4 py-3">
          <h3 className="text-[13px] font-extrabold tracking-[-0.01em]">
            Comments
          </h3>
          {comments.length > 0 ? (
            <span className="text-[11.5px] font-semibold text-faint">
              {countLabel}
            </span>
          ) : null}
        </div>

        <div className="relative min-h-[88px] max-h-[240px] shrink-0">
          <div className="scroll-quiet h-full max-h-[240px] overflow-y-auto overscroll-contain">
            {isLoading ? (
              <p className="grid min-h-[88px] place-items-center px-4 text-[13px] text-muted">
                Loading comments
              </p>
            ) : error ? (
              <p className="grid min-h-[88px] place-items-center px-4 text-[13px] text-red">
                {error}
              </p>
            ) : comments.length === 0 ? (
              <p className="grid min-h-[88px] place-items-center px-4 text-center text-[13px] leading-[1.45] text-muted">
                No comments yet. Be the first to share your read.
              </p>
            ) : (
              <ul>
                {comments.map((comment) => (
                  <CommentRow key={comment.id} comment={comment} />
                ))}
              </ul>
            )}
          </div>
          {showFade && !isLoading && !error ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-b from-transparent to-white motion-reduce:hidden"
            />
          ) : null}
        </div>

        <div className="shrink-0 border-t border-hairline bg-gradient-to-b from-white to-[#FAFDFB] px-3 py-2.5">
          <label htmlFor={`comment-${ticker}`} className="sr-only">
            Share your read on {ticker}
          </label>
          <div className="flex items-end gap-2">
            <textarea
              id={`comment-${ticker}`}
              value={draft}
              onChange={(event) =>
                setDraft(event.target.value.slice(0, 500))
              }
              onKeyDown={onComposerKeyDown}
              rows={1}
              placeholder={
                canPost
                  ? "Share your read…"
                  : "Sign in to post"
              }
              disabled={!canPost || isPosting}
              className="max-h-[52px] min-h-[36px] flex-1 resize-none rounded-control border border-hairline bg-white/80 px-3 py-2 text-[13px] leading-[1.4] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-faint focus:border-[rgba(0,200,5,0.35)] focus:shadow-[0_0_0_3px_rgba(0,200,5,0.08)] disabled:cursor-not-allowed disabled:opacity-55"
            />
            <button
              type="button"
              disabled={!canPost || !trimmed || isPosting}
              onClick={() => void handleSubmit()}
              className="shrink-0 rounded-control bg-green px-3.5 py-2 text-[12px] font-extrabold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-45"
            >
              {isPosting ? "…" : "Post"}
            </button>
          </div>
          {showCounter ? (
            <p
              className={
                atLimit
                  ? "mt-1.5 text-right text-[11px] font-semibold text-red"
                  : "mt-1.5 text-right text-[11px] font-semibold text-faint"
              }
            >
              {remaining}
            </p>
          ) : null}
          {postError ? (
            <p className="mt-1.5 text-[12px] font-medium text-red">{postError}</p>
          ) : null}
          {localOnly && canPost && !postError ? (
            <p className="mt-1.5 text-[11.5px] font-medium text-faint">
              {offline
                ? "Saved in this browser until Supabase is connected."
                : "Saved in this browser for now. Run the latest migration to sync."}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
