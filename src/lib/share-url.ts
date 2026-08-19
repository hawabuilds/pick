import {APP_DOMAIN} from "@/config/app";

/** Public origin for OG tags and share links. Set NEXT_PUBLIC_APP_URL in production. */
export function getAppOrigin(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return "http://localhost:3000";
}

export function buildSharePageUrl(
  params: Record<string, string>,
  origin?: string,
): string {
  const base = origin ?? getAppOrigin();
  const url = new URL("/share", base);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

export function buildShareImageUrl(
  params: Record<string, string>,
  origin?: string,
): string {
  const base = origin ?? getAppOrigin();
  const url = new URL("/api/share-image", base);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

/** Whether tweet text or its link entities mention the app domain. */
export function postMentionsApp(text: string, urls: string[]): boolean {
  const needle = APP_DOMAIN.toLowerCase();
  const haystacks = [text.toLowerCase(), ...urls.map((u) => u.toLowerCase())];
  return haystacks.some(
    (chunk) =>
      chunk.includes(needle) ||
      chunk.includes("pick.xyz") ||
      chunk.includes("www.pick.xyz"),
  );
}
