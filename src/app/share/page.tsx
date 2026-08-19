import type {Metadata} from "next";
import Link from "next/link";
import {APP_DOMAIN, APP_NAME, APP_TAGLINE} from "@/config/app";
import {buildShareImageUrl} from "@/lib/share-url";

/**
 * The landing page a shared post points at.
 *
 * X will not let an intent attach an image directly, so the tweet carries a
 * link to this page and X unfurls it. The Open Graph image below is the card
 * rendered by /api/share-image, which is what makes the post look like a card
 * rather than a bare link.
 */

type SearchParams = Record<string, string | string[] | undefined>;

function first(params: SearchParams, key: string): string | null {
  const value = params[key];
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function shareParams(params: SearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ["type", "picks", "handle", "amount", "ticker"]) {
    const value = first(params, key);
    if (value) out[key] = value;
  }
  return out;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const type = first(searchParams, "type");
  const isClaim = type === "claim";
  const isLearn = type === "learn";
  const ticker = first(searchParams, "ticker") ?? "TSLA";
  const amount = first(searchParams, "amount") ?? "10";

  const title = isClaim
    ? `Claimed $${amount} in ${ticker} on ${APP_NAME}`
    : isLearn
      ? `Finished the ${APP_NAME} lessons`
      : `My picks for tomorrow on ${APP_NAME}`;

  const description = isClaim
    ? `Real-world assets, earned by calling the market. Play free at ${APP_DOMAIN}.`
    : isLearn
      ? `Earn your first real-world asset. Play free at ${APP_DOMAIN}.`
      : `Ten calls a day. ${APP_TAGLINE} Play free at ${APP_DOMAIN}.`;

  const image = buildShareImageUrl(shareParams(searchParams));

  return {
    title,
    description,
    openGraph: {title, description, images: [{url: image, width: 1200, height: 630}]},
    twitter: {card: "summary_large_image", title, description, images: [image]},
  };
}

export default function SharePage({searchParams}: {searchParams: SearchParams}) {
  const type = first(searchParams, "type");
  const isClaim = type === "claim";
  const isLearn = type === "learn";

  return (
    <main className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
      <h1 className="text-[26px] font-extrabold tracking-[-0.03em]">
        {isClaim
          ? "A reward just landed"
          : isLearn
            ? "Lessons complete"
            : "Ten calls, every trading day"}
      </h1>
      <p className="mt-2 max-w-[34ch] text-[14px] leading-[1.55] text-muted">
        {APP_NAME} is free to play. Call ten stocks up or down before the open,
        climb the leaderboard, and get paid in real-world assets.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-[15px] bg-ink px-6 py-3.5 text-[15px] font-bold text-white"
      >
        Play {APP_NAME}
      </Link>
    </main>
  );
}
