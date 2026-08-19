"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useUser } from "@/hooks/useUser";
import { useSession } from "@/lib/session";
import { ProfileMenu } from "./ProfileMenu";
import { TabBar } from "./TabBar";
import { Logo } from "./ui/Logo";

const ONBOARDING_PATH = "/learn";

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { ready, authenticated } = useUser();
  const { restriction, needsOnboarding } = useSession();

  const onboarding = pathname === ONBOARDING_PATH;

  useEffect(() => {
    if (ready && !authenticated) router.replace("/");
  }, [ready, authenticated, router]);

  // A brand-new player starts on the guide rather than on a dashboard they have
  // no way to read yet. They are not held there: the tabs are live from the
  // first second, and Learn marks them onboarded on arrival so this fires once.
  useEffect(() => {
    if (!ready || !authenticated) return;
    if (needsOnboarding === true && !onboarding) router.replace(ONBOARDING_PATH);
  }, [ready, authenticated, needsOnboarding, onboarding, router]);

  if (!ready || !authenticated) {
    return <div className="h-full bg-premium" />;
  }

  // Hold the frame blank while that redirect resolves, so the dashboard never
  // flashes up behind the guide.
  if (needsOnboarding === true && !onboarding) {
    return <div className="h-full bg-premium" />;
  }

  return (
    <div className="flex h-full flex-col bg-premium">
      <header className="flex items-center justify-between px-[22px] pb-1.5 pt-[22px]">
        <Logo size="sm" />
        <ProfileMenu />
      </header>

      <div className="scroll-quiet flex-1 overflow-y-auto px-[22px] pt-2.5 pb-[calc(96px+env(safe-area-inset-bottom))]">
        {restriction ? (
          <div
            role="status"
            className="mb-3 rounded-[14px] border border-hairline bg-card px-4 py-3 text-[12.5px] font-medium leading-[1.5] text-red"
          >
            {restriction}
          </div>
        ) : null}
        <div className="animate-rise">{children}</div>
      </div>

      <TabBar />
    </div>
  );
}
