import {ImageResponse} from "next/og";
import type {NextRequest} from "next/server";
import {APP_DOMAIN, APP_NAME} from "@/config/app";

/**
 * Branded PNG of a share card, so a post on X carries a real image rather than
 * a bare link.
 *
 * Runs on the edge because satori is fast enough to render per request and the
 * alternative — pre-rendering every possible card — is not a thing.
 *
 *   /api/share-image?type=picks&picks=TSLA:up,AMZN:down&handle=someone
 *   /api/share-image?type=claim&amount=10&ticker=TSLA
 *
 * Two satori rules to keep in mind when editing the markup below: every element
 * with more than one child needs an explicit `display: flex`, and text has to
 * sit in a leaf. Breaking either produces a 500, not a wonky image.
 */
export const runtime = "edge";

const INK = "#0B0F0C";
const GREEN = "#00C805";
const UP = "#3DF07A";
const DOWN = "#FF7A73";

const WIDTH = 1200;
const HEIGHT = 630;

/** Every div satori sees is a flex container, which is the only safe default. */
const row = {display: "flex", alignItems: "center"} as const;

/**
 * Glyphs like ↗ and ✓ are not in the Manrope subset, and satori's fallback
 * renders them as garbage rather than dropping them. Drawing them keeps the
 * card on-brand and matches the app's SVG-only icon rule.
 */
function ArrowUpRight({size, color}: {size: number; color: string}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M7 17 17 7M9 7h8v8"
        stroke={color}
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Check({size, color}: {size: number; color: string}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="m5 12.5 4.5 4.5L19 7.5"
        stroke={color}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Manrope is the brand face. Fetched rather than bundled because the edge
 * runtime cannot read from the filesystem.
 *
 * The User-Agent is deliberately omitted: Google serves woff2 to modern
 * browsers, and satori cannot parse woff2. With no UA it falls back to
 * truetype, which satori can.
 */
async function loadFont(): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch(
      "https://fonts.googleapis.com/css2?family=Manrope:wght@800",
    ).then((res) => res.text());

    const url = css.match(
      /src: url\((https:[^)]+)\) format\('(?:truetype|opentype)'\)/,
    )?.[1];
    if (!url) return null;

    const response = await fetch(url);
    if (!response.ok) return null;
    return await response.arrayBuffer();
  } catch {
    // A card in the fallback face beats a broken share.
    return null;
  }
}

function parsePicks(raw: string | null) {
  if (!raw) return [];
  return raw
    .split(",")
    .slice(0, 10)
    .map((entry) => {
      const [ticker, direction] = entry.split(":");
      return {
        ticker: (ticker ?? "").toUpperCase().slice(0, 6),
        up: direction !== "down",
      };
    })
    .filter((pick) => pick.ticker.length > 0);
}

function Chrome({children, caption}: {children: React.ReactNode; caption: string}) {
  return (
    <div
      style={{
        width: WIDTH,
        height: HEIGHT,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 64,
        background: `linear-gradient(160deg, ${INK} 0%, #111A13 100%)`,
        color: "#FFFFFF",
        fontFamily: "Manrope",
      }}
    >
      <div style={{...row, justifyContent: "space-between"}}>
        <div style={{...row, gap: 14}}>
          <div style={{display: "flex", fontSize: 40, letterSpacing: "-0.03em"}}>
            {APP_NAME}
          </div>
          <div
            style={{
              ...row,
              justifyContent: "center",
              width: 36,
              height: 36,
              borderRadius: 11,
              background: GREEN,
            }}
          >
            <ArrowUpRight size={22} color={INK} />
          </div>
        </div>
        <div style={{display: "flex", fontSize: 22, color: "rgba(255,255,255,0.55)"}}>
          {caption}
        </div>
      </div>

      {children}

      <div style={{display: "flex", fontSize: 26, color: "rgba(255,255,255,0.5)"}}>
        {APP_DOMAIN}
      </div>
    </div>
  );
}

function PicksCard({
  picks,
  handle,
}: {
  picks: Array<{ticker: string; up: boolean}>;
  handle: string | null;
}) {
  return (
    <Chrome caption={handle ? `@${handle}` : "Free to play"}>
      <div style={{display: "flex", flexDirection: "column", gap: 28}}>
        <div style={{display: "flex", fontSize: 54, letterSpacing: "-0.03em"}}>
          {`My ${picks.length} picks for tomorrow`}
        </div>
        <div style={{display: "flex", flexWrap: "wrap", gap: 12}}>
          {picks.map((pick) => (
            <div
              key={pick.ticker}
              style={{
                ...row,
                gap: 12,
                padding: "14px 22px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.06)",
                fontSize: 28,
              }}
            >
              <div style={{display: "flex"}}>{pick.ticker}</div>
              <div style={{display: "flex", color: pick.up ? UP : DOWN}}>
                {pick.up ? "Up" : "Down"}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Chrome>
  );
}

function ClaimCard({amount, ticker}: {amount: string; ticker: string}) {
  return (
    <Chrome caption="Claimed">
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 22,
        }}
      >
        <div
          style={{
            ...row,
            justifyContent: "center",
            width: 96,
            height: 96,
            borderRadius: 999,
            background: GREEN,
          }}
        >
          <Check size={52} color="#04230A" />
        </div>
        <div style={{display: "flex", fontSize: 68, letterSpacing: "-0.035em"}}>
          {`Claimed $${amount} in ${ticker}`}
        </div>
        <div style={{display: "flex", fontSize: 30, color: "rgba(255,255,255,0.6)"}}>
          Real-world assets, earned by calling the market.
        </div>
      </div>
    </Chrome>
  );
}

function LearnCard({amount}: {amount: string}) {
  return (
    <Chrome caption="Lessons complete">
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 22,
        }}
      >
        <div
          style={{
            ...row,
            justifyContent: "center",
            width: 96,
            height: 96,
            borderRadius: 999,
            background: GREEN,
          }}
        >
          <Check size={52} color="#04230A" />
        </div>
        <div style={{display: "flex", fontSize: 68, letterSpacing: "-0.035em"}}>
          {`Earned my first $${amount} share`}
        </div>
        <div style={{display: "flex", fontSize: 30, color: "rgba(255,255,255,0.6)"}}>
          Finished all three {APP_NAME} lessons.
        </div>
      </div>
    </Chrome>
  );
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const font = await loadFont();

  const options = {
    width: WIDTH,
    height: HEIGHT,
    fonts: font
      ? [{name: "Manrope", data: font, style: "normal" as const, weight: 800 as const}]
      : undefined,
  };

  if (params.get("type") === "claim") {
    const amount =
      (params.get("amount") ?? "10").replace(/[^0-9.]/g, "").slice(0, 8) || "10";
    const ticker = (params.get("ticker") ?? "TSLA").toUpperCase().slice(0, 6);
    return new ImageResponse(<ClaimCard amount={amount} ticker={ticker} />, options);
  }

  if (params.get("type") === "learn") {
    const amount =
      (params.get("amount") ?? "10").replace(/[^0-9.]/g, "").slice(0, 8) || "10";
    return new ImageResponse(<LearnCard amount={amount} />, options);
  }

  const picks = parsePicks(params.get("picks"));
  const handle =
    params.get("handle")?.replace(/[^A-Za-z0-9_]/g, "").slice(0, 20) || null;

  return new ImageResponse(<PicksCard picks={picks} handle={handle} />, options);
}
