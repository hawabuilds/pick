"use client";

import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/lib/session";
import { money } from "@/lib/format";
import type { Metrics } from "@/lib/server/metrics";

/**
 * The internal adoption view.
 *
 * One screen that answers the only question a reviewer actually asks: how many
 * real people, who were not already in crypto, now hold a real-world asset they
 * control. Everything else on this page is supporting evidence for that line.
 */

function count(value: number): string {
  return value.toLocaleString("en-GB");
}

function percent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function shares(value: number): string {
  if (value === 0) return "0";
  return value >= 100 ? value.toFixed(1) : value.toFixed(4);
}

export default function MetricsPage() {
  const { getAccessToken } = useSession();
  const [exporting, setExporting] = useState(false);

  const authedFetch = useCallback(
    async (url: string) => {
      const token = await getAccessToken();
      return fetch(url, {
        headers: token ? { authorization: `Bearer ${token}` } : undefined,
      });
    },
    [getAccessToken],
  );

  const query = useQuery({
    queryKey: ["admin-metrics"],
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const res = await authedFetch("/api/admin/metrics");
      if (res.status === 404 || res.status === 401) {
        throw new Error("You do not have access to this page.");
      }
      if (!res.ok) throw new Error("Could not load metrics.");
      return (await res.json()) as Metrics;
    },
  });

  const download = useCallback(
    async (format: "json" | "csv") => {
      setExporting(true);
      try {
        const res = await authedFetch(`/api/admin/metrics?format=${format}`);
        if (!res.ok) return;

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const day = new Date().toISOString().slice(0, 10);
        const link = document.createElement("a");
        link.href = url;
        link.download = `pick-metrics-${day}.${format}`;
        link.click();
        URL.revokeObjectURL(url);
      } finally {
        setExporting(false);
      }
    },
    [authedFetch],
  );

  const metrics = query.data;

  return (
    <main className="scroll-quiet h-full overflow-y-auto bg-premium px-[18px] pb-12 pt-[26px]">
      <header className="mb-5">
        <h1 className="text-[26px] font-extrabold tracking-[-0.03em]">
          Adoption
        </h1>
        <p className="mt-1 text-[13.5px] leading-[1.55] text-muted">
          People with no crypto knowledge who now hold real-world assets in
          wallets they control, for free.
        </p>
        <div className="mt-3.5 flex gap-2">
          <ExportButton
            label="Export JSON"
            disabled={exporting || !metrics}
            onClick={() => void download("json")}
          />
          <ExportButton
            label="Export CSV"
            disabled={exporting || !metrics}
            onClick={() => void download("csv")}
          />
        </div>
      </header>

      {query.isLoading ? (
        <Note>Loading.</Note>
      ) : query.error ? (
        <Note>
          {query.error instanceof Error
            ? query.error.message
            : "Could not load metrics."}
        </Note>
      ) : metrics ? (
        <Report metrics={metrics} />
      ) : null}
    </main>
  );
}

function Report({ metrics }: { metrics: Metrics }) {
  const { users, activity, retention, rewards, onChain } = metrics;

  return (
    <>
      {!metrics.live ? (
        <Note>
          The database is not configured, so every figure below is zero rather
          than real. Set the Supabase environment variables to see live counts.
        </Note>
      ) : null}

      <div className="mb-3 rounded-panel border border-hairline bg-gradient-to-b from-white to-[#FAFDFB] p-[22px] shadow-panel">
        <div className="text-[11px] font-bold tracking-[0.09em] text-faint">
          REAL-WORLD ASSETS IN SELF-CUSTODY
        </div>
        <div className="tnum my-2 text-[42px] font-extrabold tracking-[-0.035em]">
          {money(onChain.valueUsd)}
        </div>
        <div className="text-[13.5px] font-medium leading-[1.5] text-muted">
          {count(onChain.holders)} people holding {shares(onChain.shares)} shares
          across {count(rewards.distinctTickers)} companies, read from the chain.
        </div>
        {onChain.error ? (
          <div className="mt-3 text-[12.5px] font-semibold text-red">
            {onChain.error} The figures above are incomplete.
          </div>
        ) : null}
        {onChain.sampled ? (
          <div className="mt-3 text-[12.5px] text-faint">
            Wallet list was capped, so these are a floor rather than a total.
          </div>
        ) : null}
      </div>

      <Section title="People">
        <Stat label="Signed up" value={count(users.total)} />
        <Stat
          label="New to crypto"
          value={percent(users.newToCryptoPct)}
          note={`${count(users.newToCrypto)} of ${count(users.walletStatusKnown)} known`}
        />
        <Stat label="Countries reached" value={count(users.countries)} />
        {/* Two different things: one counts who was shown the guide, the other
            who actually worked through it. */}
        <Stat label="Saw the guide" value={count(users.onboarded)} />
        <Stat
          label="Finished the lessons"
          value={count(rewards.finishedLessons)}
        />
      </Section>

      <Section title="Playing">
        <Stat label="Ever played" value={count(activity.everPlayed)} />
        <Stat label="Daily active" value={count(activity.dau)} />
        <Stat
          label={`Active in ${activity.activeWindowDays} days`}
          value={count(activity.activeInWindow)}
        />
        <Stat
          label="Day 1 / Day 7"
          value={`${percent(retention.d1)} / ${percent(retention.d7)}`}
          note={`${count(retention.d1Eligible)} / ${count(retention.d7Eligible)} eligible`}
        />
      </Section>

      <Section title="Given away">
        <Stat label="Value paid out" value={money(rewards.usdDistributed)} />
        <Stat label="Claims settled" value={count(rewards.confirmedClaims)} />
        <Stat label="People paid" value={count(rewards.recipients)} />
        <Stat label="Welcome rewards" value={count(rewards.welcomeRewarded)} />
      </Section>

      <p className="mt-6 px-0.5 text-[12px] leading-[1.6] text-faint">
        Holdings are read from Robinhood Chain, not from our own records: the
        database says what was paid, the chain says what is still held. Prices
        are current mids from Robinhood&rsquo;s asset API. Wallets checked:{" "}
        {count(onChain.walletsChecked)}. Generated{" "}
        {new Date(metrics.generatedAt).toLocaleString("en-GB")}.
      </p>
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-3">
      <h2 className="mb-2 mt-5 px-0.5 text-[11px] font-bold tracking-[0.09em] text-faint">
        {title.toUpperCase()}
      </h2>
      <div className="grid grid-cols-2 gap-2.5">{children}</div>
    </section>
  );
}

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="rounded-[16px] border border-hairline bg-card p-[15px]">
      <div className="text-[12px] font-bold text-muted">{label}</div>
      <div className="tnum mt-1.5 text-[24px] font-extrabold tracking-[-0.03em]">
        {value}
      </div>
      {note ? (
        <div className="tnum mt-1 text-[11.5px] text-faint">{note}</div>
      ) : null}
    </div>
  );
}

function ExportButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-pill border border-hairline bg-card px-[15px] py-[9px] text-[12.5px] font-bold transition-colors hover:bg-wash disabled:text-faint"
    >
      {label}
    </button>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 rounded-[16px] border border-hairline bg-card px-4 py-5 text-[13px] leading-[1.55] text-muted">
      {children}
    </div>
  );
}
