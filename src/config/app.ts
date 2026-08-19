export const APP_NAME = "Pick";
export const APP_TAGLINE = "Making RWA global for all";
export const APP_SUBTITLE =
  "Where users earn RWA by holding, playing and learning how they work.";

/** Domain used in share copy. Swap once the real domain is registered. */
export const APP_DOMAIN = "pick.xyz";

/** A slate is always exactly this many calls — never more, never fewer. */
export const PICKS_PER_SLATE = 10;

/**
 * Play first, then social proof, then the destination (Portfolio), then onboarding.
 */
export const TABS = [
  { href: "/play", label: "Play", key: "play" },
  { href: "/leaderboard", label: "Ranks", key: "leaderboard" },
  { href: "/portfolio", label: "Portfolio", key: "portfolio" },
  { href: "/learn", label: "Learn", key: "learn" },
] as const;

export type TabKey = (typeof TABS)[number]["key"];
