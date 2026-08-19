import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import { APP_NAME, APP_TAGLINE } from "@/config/app";
import { Providers } from "@/components/providers/Providers";
import { OVERLAY_ROOT_ID } from "@/components/ui/OverlayPortal";
import { getAppOrigin } from "@/lib/share-url";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(getAppOrigin()),
  title: `${APP_NAME} — ${APP_TAGLINE}`,
  description:
    "A free-to-play prediction game on Robinhood Chain. Call ten stocks a day, climb the leaderboard, earn real-world assets.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#FFFFFF",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={manrope.variable}>
      <body className="font-sans text-ink antialiased">
        <Providers>
          <div className="app-frame">
            {children}
            <div id={OVERLAY_ROOT_ID} />
          </div>
        </Providers>
      </body>
    </html>
  );
}
