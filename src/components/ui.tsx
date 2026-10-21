"use client";

import { useState, type ReactNode } from "react";
import { IconAlert, IconCheck, IconCopy } from "./icons";
import type { Evidence } from "@/lib/types";

export function Section({
  icon,
  kicker,
  title,
  children,
  aside,
}: {
  icon?: ReactNode;
  kicker: string;
  title: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="rise rounded-2xl border border-line bg-card p-5 sm:p-6">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {icon && (
            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-paper text-olive">
              {icon}
            </span>
          )}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{kicker}</p>
            <h3 className="font-display text-xl leading-tight sm:text-2xl">{title}</h3>
          </div>
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          setCopied(false);
        }
      }}
      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1.5 text-xs font-medium text-ink-2 transition hover:border-ink-2/40 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive"
    >
      {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
      {copied ? "Copied" : label}
    </button>
  );
}

export function AffinityBar({ value }: { value?: number }) {
  if (typeof value !== "number") return null;
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <span className="inline-flex items-center gap-2" title={`Qloo affinity ${pct}/100`}>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-paper-2">
        <span className="block h-full rounded-full bg-terracotta" style={{ width: `${pct}%` }} />
      </span>
      <span className="w-6 text-right text-[11px] tabular-nums text-muted">{pct}</span>
    </span>
  );
}

export function Pill({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "olive" | "terracotta" }) {
  const tones = {
    plain: "border-line bg-paper text-ink-2",
    olive: "border-olive/25 bg-olive/10 text-olive",
    terracotta: "border-terracotta/25 bg-terracotta/10 text-terracotta",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function EvidenceLine({ evidence }: { evidence: Evidence }) {
  const ok = evidence.verified === true;
  const unknown = evidence.verified === undefined;
  return (
    <li className="flex gap-2 text-[12px] leading-snug text-muted">
      <span
        className={`mt-0.5 shrink-0 ${ok ? "text-olive" : unknown ? "text-saffron" : "text-terracotta"}`}
        title={
          ok
            ? `Checked: ${evidence.cites.map((c) => (c.score != null ? `${c.name} (${c.score})` : c.name)).join(", ")} returned by Qloo in this run. Other numbers in the sentence are not checked.`
            : unknown
              ? "Not checked"
              : "A cited name or score could not be matched to this run's Qloo responses"
        }
      >
        {ok ? <IconCheck size={13} /> : <IconAlert size={13} />}
        <span className="sr-only">{ok ? "Cited Qloo names and scores checked:" : "Not verified:"}</span>
      </span>
      <span>{evidence.text}</span>
    </li>
  );
}
