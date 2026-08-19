import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

const stroke = {
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function ArrowUpRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 20L20 4M20 4h-7M20 4v7" {...stroke} strokeWidth={2.4} />
    </Icon>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12h14M13 6l6 6-6 6" {...stroke} strokeWidth={2.2} />
    </Icon>
  );
}

export function ArrowUpIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 19V5M6 11l6-6 6 6" {...stroke} strokeWidth={2.2} />
    </Icon>
  );
}

export function ArrowDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14M6 13l6 6 6-6" {...stroke} strokeWidth={2.2} />
    </Icon>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth={2} />
      <path d="M21 21l-4-4" {...stroke} />
    </Icon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 6l12 12M18 6L6 18" {...stroke} strokeWidth={2.2} />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 6L9 17l-5-5" {...stroke} strokeWidth={2.8} />
    </Icon>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="8" y="8" width="12" height="12" rx="2" {...stroke} />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" {...stroke} />
    </Icon>
  );
}

export function GridIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth={2} />
      <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth={2} />
      <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth={2} />
      <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth={2} />
    </Icon>
  );
}

export function ListIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 6h16M4 12h16M4 18h16" {...stroke} />
    </Icon>
  );
}

export function LogoutIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path
        d="M16 17l5-5-5-5M21 12H9M12 3H6a2 2 0 00-2 2v14a2 2 0 002 2h6"
        {...stroke}
      />
    </Icon>
  );
}

export function WalletIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path
        d="M3 9a2 2 0 012-2h13a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V9zM3 9V7a2 2 0 012-2h11M17 13.5h.01"
        {...stroke}
      />
    </Icon>
  );
}

export function TrophyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path
        d="M8 21h8M12 17.5V21M6 4h12v3.5a6 6 0 01-12 0V4zM6 6.5H4V8a3 3 0 002.5 2.95M18 6.5h2V8a3 3 0 01-2.5 2.95"
        {...stroke}
        strokeWidth={1.9}
      />
    </Icon>
  );
}

export function GiftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path
        d="M20 12v8H4v-8M2.5 8h19v4h-19zM12 20V8M12 8H8.2A2.1 2.1 0 019.6 4.3C11 4.3 12 6 12 8zM12 8h3.8A2.1 2.1 0 0014.4 4.3C13 4.3 12 6 12 8z"
        {...stroke}
        strokeWidth={1.8}
      />
    </Icon>
  );
}

export function TargetIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth={2} />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
    </Icon>
  );
}

export function BarsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 20V11M12 20V4M17 20v-6" {...stroke} />
    </Icon>
  );
}

export function CapIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path
        d="M3 7l9-4 9 4-9 4-9-4zM7 10v5c0 1 2 2.5 5 2.5S17 16 17 15v-5"
        {...stroke}
        strokeWidth={1.9}
      />
    </Icon>
  );
}

export function MailIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 6h16v12H4zM4 7l8 6 8-6" {...stroke} />
    </Icon>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={2} />
      <path d="M12 7.5V12l3 2" {...stroke} />
    </Icon>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4" y="10" width="16" height="10" rx="2.5" stroke="currentColor" strokeWidth={2} />
      <path d="M8 10V7a4 4 0 018 0v3" {...stroke} />
    </Icon>
  );
}

export function XIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
      <path d="M18.9 2H22l-7.6 8.7L23 22h-6.8l-5.3-6.9L4.8 22H1.7l8.1-9.3L1 2h7l4.8 6.3L18.9 2zm-2.4 18h1.9L7.5 4H5.5l11 16z" />
    </svg>
  );
}
