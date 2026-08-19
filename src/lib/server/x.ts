import {APP_DOMAIN} from "@/config/app";
import {postMentionsApp} from "@/lib/share-url";

/**
 * Verification of the "share on X" step behind the learner reward.
 *
 * This gate is what stops the reward being farmed with a screenshot, so it
 * calls the X API and checks three things: the post exists, it was written by
 * the account that is claiming, and it actually mentions the app.
 */

const bearerToken = process.env.X_BEARER_TOKEN ?? "";

/**
 * Escape hatch for local development, where there is no X app to call. Must be
 * left unset in production or the gate is decorative.
 */
const allowUnverified = process.env.ALLOW_UNVERIFIED_SHARE === "true";

export const canVerifyShares = bearerToken.length > 0;

export interface ShareVerification {
  ok: boolean;
  reason?: string;
}

/**
 * When the X account was opened. Privy does not surface this, and it is the
 * single most useful sybil signal available: a farm can make a thousand
 * accounts today but cannot make them a year old.
 *
 * Returns null when it cannot be determined, and callers treat that as
 * "unknown" rather than "new" so a missing API key does not lock everyone out.
 */
export async function fetchXAccountCreatedAt(
  xId: string,
): Promise<string | null> {
  if (!canVerifyShares) return null;

  try {
    const response = await fetch(
      `https://api.x.com/2/users/${xId}?user.fields=created_at`,
      {
        headers: {authorization: `Bearer ${bearerToken}`},
        cache: "no-store",
      },
    );
    if (!response.ok) return null;

    const payload = (await response.json()) as {
      data?: {created_at?: string};
    };
    return payload.data?.created_at ?? null;
  } catch {
    return null;
  }
}

/** Pulls the numeric status id out of any of the URL shapes X hands out. */
export function parsePostId(url: string): string | null {
  const match = url.match(
    /(?:twitter\.com|x\.com)\/[^/]+\/status(?:es)?\/(\d{5,25})/i,
  );
  return match ? match[1] : null;
}

/** Pulls the poster's handle out of a status URL for a fallback author check. */
export function parsePostHandle(url: string): string | null {
  const match = url.match(/(?:twitter\.com|x\.com)\/([^/?#]+)\/status/i);
  const handle = match?.[1]?.toLowerCase();
  if (!handle || ["i", "intent", "share", "home"].includes(handle)) return null;
  return handle;
}

export async function verifySharePost(options: {
  url: string;
  xId: string | null;
  handle: string | null;
}): Promise<ShareVerification> {
  const postId = parsePostId(options.url);
  if (!postId) {
    return {ok: false, reason: "That does not look like a link to a post on X."};
  }

  if (!canVerifyShares) {
    if (allowUnverified) return {ok: true};
    return {
      ok: false,
      reason: "Share verification is not configured yet. Try again later.",
    };
  }

  let payload: {
    data?: {
      id: string;
      text: string;
      author_id?: string;
      entities?: {
        urls?: Array<{expanded_url?: string; display_url?: string}>;
      };
    };
    errors?: Array<{detail?: string}>;
  };

  try {
    const response = await fetch(
      `https://api.x.com/2/tweets/${postId}?tweet.fields=author_id,text,entities`,
      {
        headers: {authorization: `Bearer ${bearerToken}`},
        cache: "no-store",
      },
    );

    if (response.status === 429) {
      return {ok: false, reason: "X is rate limiting us. Try again in a minute."};
    }
    payload = await response.json();
  } catch {
    return {ok: false, reason: "Could not reach X to check your post."};
  }

  const post = payload.data;
  if (!post) {
    return {
      ok: false,
      reason: "That post could not be found. Is it public and still up?",
    };
  }

  // An author check is the part that matters: without it, one real post could
  // be pasted by every account that wanted the reward.
  if (
    options.xId &&
    post.author_id &&
    String(post.author_id) !== String(options.xId)
  ) {
    return {ok: false, reason: "That post was written by a different account."};
  }

  if (!options.xId && options.handle) {
    const urlHandle = parsePostHandle(options.url);
    const mine = options.handle.replace(/^@/, "").toLowerCase();
    if (urlHandle && urlHandle !== mine) {
      return {ok: false, reason: "That post was written by a different account."};
    }
  }

  const linked = (post.entities?.urls ?? []).flatMap((entry) =>
    [entry.expanded_url, entry.display_url].filter(Boolean) as string[],
  );

  if (!postMentionsApp(post.text, linked)) {
    return {
      ok: false,
      reason: `Your post needs to mention ${APP_DOMAIN}.`,
    };
  }

  return {ok: true};
}
