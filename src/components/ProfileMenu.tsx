"use client";

import {useEffect, useRef, useState} from "react";
import {useRewards} from "@/hooks/useRewards";
import {useUser} from "@/hooks/useUser";
import {useWallet} from "@/hooks/useWallet";
import {cn} from "@/lib/cn";
import {shortAddress} from "@/lib/format";
import {useSession} from "@/lib/session";
import {addressUrlForChain, RH_MAINNET_ID} from "@/config/chain";
import {ConnectWalletSheet} from "./ConnectWalletSheet";
import {Avatar} from "./ui/Avatar";
import {Button} from "./ui/Button";
import {
  ArrowUpRightIcon,
  CopyIcon,
  LogoutIcon,
  WalletIcon,
} from "./ui/Icons";
import {Sheet, SheetTitle} from "./ui/Sheet";

export function ProfileMenu() {
  const {displayName, handle, pfpUrl, embeddedWallet, logout} = useUser();
  const {exportEmbeddedWallet} = useSession();
  const wallet = useWallet();
  const rewards = useRewards();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [copied, setCopied] = useState(false);

  const ownWallet = rewards.smartAccountAddress ?? embeddedWallet;
  const external = wallet.isConnected ? wallet.address : null;
  const usingExternal = !rewards.gasless && external !== null;
  const destination = usingExternal ? external : ownWallet;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
    };
  }, [open]);

  async function copyAddress() {
    if (!destination) return;
    try {
      await navigator.clipboard.writeText(destination);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  async function saveBackup() {
    if (!exportEmbeddedWallet) return;
    setBackingUp(true);
    try {
      await exportEmbeddedWallet();
      setBackupOpen(false);
    } catch {
      // Privy surfaces its own refusal.
    } finally {
      setBackingUp(false);
    }
  }

  return (
    <>
      <div ref={rootRef} className="relative">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((prev) => !prev);
          }}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label="Profile and wallet"
          className="block rounded-full"
        >
          <Avatar name={displayName} src={pfpUrl} size={40} ring />
        </button>

        <div
          role="menu"
          aria-label="Account"
          className={cn(
            "absolute right-0 top-[calc(100%+8px)] z-50 w-[min(280px,calc(100vw-44px))]",
            "rounded-panel border border-hairline bg-card p-2 shadow-menu",
            "origin-top-right transition-[opacity,transform,visibility] duration-150",
            open
              ? "visible scale-100 opacity-100"
              : "invisible pointer-events-none scale-[0.98] opacity-0",
          )}
        >
          <div className="border-b border-hairline px-2.5 pb-2.5 pt-2">
            <div className="truncate text-[14px] font-extrabold tracking-[-0.01em]">
              {displayName}
            </div>
            <div className="truncate text-[12px] font-medium text-faint">
              {handle ? `@${handle}` : "Signed in with X"}
            </div>
          </div>

          <div className="mx-1 mt-2 rounded-[13px] bg-wash px-3 py-2.5">
            <div className="text-[12.5px] font-bold">
              {usingExternal
                ? (wallet.walletName ?? "Imported wallet")
                : "Your wallet"}
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="tnum min-w-0 flex-1 truncate text-[12px] font-semibold text-muted">
                {destination ? shortAddress(destination) : "Setting up…"}
              </span>
              {destination ? (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void copyAddress()}
                    aria-label={copied ? "Address copied" : "Copy address"}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-muted transition-colors hover:bg-card hover:text-ink"
                  >
                    <CopyIcon className="h-3.5 w-3.5" />
                  </button>
                  <a
                    href={addressUrlForChain(destination, RH_MAINNET_ID)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="View on explorer"
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-muted transition-colors hover:bg-card hover:text-ink"
                  >
                    <ArrowUpRightIcon className="h-3.5 w-3.5" />
                  </a>
                </>
              ) : null}
            </div>
            {copied ? (
              <div className="mt-1 text-[11px] font-semibold text-green-deep">
                Copied
              </div>
            ) : null}
          </div>

          <div className="mt-1 flex flex-col">
            <MenuRow
              onClick={() => {
                setOpen(false);
                setConnectOpen(true);
              }}
              icon={<WalletIcon className="h-4 w-4" />}
              label="Import wallet"
            />
            {exportEmbeddedWallet && embeddedWallet ? (
              <MenuRow
                onClick={() => {
                  setOpen(false);
                  setBackupOpen(true);
                }}
                icon={<CopyIcon className="h-4 w-4" />}
                label="Export backup"
              />
            ) : null}
            {usingExternal && wallet.onWrongChain ? (
              <MenuRow
                onClick={() => void wallet.ensureCorrectChain()}
                icon={<WalletIcon className="h-4 w-4" />}
                label="Switch network"
              />
            ) : null}
            {usingExternal ? (
              <MenuRow
                onClick={() => wallet.disconnect()}
                icon={<WalletIcon className="h-4 w-4" />}
                label="Disconnect wallet"
              />
            ) : null}
          </div>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              logout();
            }}
            className="mx-1 mt-1 flex w-[calc(100%-8px)] items-center gap-2 rounded-[10px] px-2.5 py-2.5 text-[14px] font-bold text-red transition-colors hover:bg-wash"
          >
            <LogoutIcon className="h-4 w-4" />
            Log out
          </button>
        </div>
      </div>

      <ConnectWalletSheet
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        connectors={wallet.connectors}
        onConnect={wallet.connectWith}
      />

      <Sheet
        open={backupOpen}
        onClose={() => setBackupOpen(false)}
        height="auto"
        label="Export backup"
        header={
          <SheetTitle title="Export backup" onClose={() => setBackupOpen(false)} />
        }
      >
        <p className="mt-1 text-[14px] leading-[1.55] text-muted">
          Save this somewhere only you can reach. You will need it to restore
          your wallet on another device.
        </p>
        <Button
          variant="dark"
          fullWidth
          className="mt-5"
          disabled={backingUp}
          onClick={() => void saveBackup()}
        >
          {backingUp ? "Opening export…" : "Continue"}
        </Button>
      </Sheet>
    </>
  );
}

function MenuRow({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2.5 text-left text-[14px] font-semibold",
        "transition-colors hover:bg-wash disabled:opacity-45",
      )}
    >
      <span className="text-muted">{icon}</span>
      {label}
    </button>
  );
}
