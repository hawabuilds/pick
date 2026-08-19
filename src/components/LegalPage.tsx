import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRightIcon } from "./ui/Icons";
import { Logo } from "./ui/Logo";

export function LegalPage({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="scroll-quiet h-full overflow-y-auto bg-premium px-[30px] pb-10 pt-[26px]">
      <Logo size="sm" />
      <h1 className="mb-4 mt-7 text-[26px] font-extrabold tracking-[-0.03em]">
        {title}
      </h1>
      <div className="space-y-3.5 text-[14px] leading-[1.6] text-muted">
        {children}
      </div>
      <Link
        href="/"
        className="mt-8 inline-flex items-center gap-2 text-[14px] font-bold text-green-deep"
      >
        Back
        <ArrowRightIcon className="h-4 w-4" />
      </Link>
    </div>
  );
}
