"use client";

import { useState, type ReactNode } from "react";
import { AnimatePresence, m } from "motion/react";
import { REVEAL } from "@/lib/motion";
import { IconAlert, IconCheck, IconCopy } from "./icons";
import { InfoPopover } from "./Popover";
import { toast } from "./Toaster";
import type { Evidence } from "@/lib/types";

export function Section({
  icon,
  kicker,
  title,
  children,
  aside,
  id,
}: {
  icon?: ReactNode;
  kicker: string;
  title: string;
  children: ReactNode;
  aside?: ReactNode;
  id?: string;
}) {
  return (
    // Rises into place the first time it scrolls into view (once).
    <m.section
      id={id}
      data-reveal
      initial="hidden"
      whileInView="shown"
      viewport={{ once: true, amount: 0.08, margin: "0px 0px -6% 0px" }}
      variants={REVEAL}
      className="rounded-2xl border border-line bg-card p-5 sm:p-6"
    >
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
    </m.section>
  );
}

export function CopyButton({ text, label = "Copy", done = "Copied to clipboard" }: { text: string; label?: string; done?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          toast(done);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          setCopied(false);
          toast("Couldn’t reach the clipboard: select the text and copy it");
        }
      }}
      className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1.5 text-xs font-medium text-ink-2 transition hover:border-ink-2/40 hover:text-ink active:scale-[0.97] pointer-coarse:min-h-11 pointer-coarse:px-4"
    >
      <span className="relative grid h-3.5 w-3.5 place-items-center">
        <AnimatePresence initial={false} mode="popLayout">
          <m.span
            key={copied ? "done" : "copy"}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ duration: 0.18 }}
            className="grid place-items-center"
          >
            {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
          </m.span>
        </AnimatePresence>
      </span>
      {copied ? "Copied" : label}
    </button>
  );
}

/** Qloo affinity as a short bar that draws in with its group (see InViewGroup). */
export function AffinityBar({ value, index = 0 }: { value?: number; index?: number }) {
  if (typeof value !== "number") return null;
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-paper-2" aria-hidden>
        <span
          className="bar-fill block h-full rounded-full bg-terracotta"
          style={{ width: `${pct}%`, "--i": index } as React.CSSProperties}
        />
      </span>
      <span className="w-6 text-right text-[11px] tabular-nums text-muted">
        {pct}
        <span className="sr-only"> out of 100 Qloo affinity</span>
      </span>
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

/** Popover trigger styled as a small "how is this measured?" link. */
export function HowLink({
  label,
  title,
  children,
  tone = "light",
}: {
  label: string;
  title?: string;
  children: ReactNode;
  tone?: "light" | "dark";
}) {
  return (
    <InfoPopover
      label={label}
      title={title}
      trigger={label}
      width={400}
      className={`relative inline-flex items-center underline decoration-dotted underline-offset-[3px] transition-colors before:absolute before:-inset-x-1 before:-inset-y-3.5 before:content-[''] ${
        tone === "dark" ? "text-paper/85 decoration-paper/50 hover:text-paper" : "text-muted decoration-ink-2/40 hover:text-ink"
      }`}
    >
      {children}
    </InfoPopover>
  );
}

export function EvidenceLine({ evidence }: { evidence: Evidence }) {
  const ok = evidence.verified === true;
  const unknown = evidence.verified === undefined;
  const tone = ok ? "text-olive" : unknown ? "text-saffron" : "text-terracotta";
  const explanation = ok
    ? `Checked: ${evidence.cites.map((c) => (c.score != null ? `${c.name} (${c.score})` : c.name)).join(", ")} returned by Qloo in this run. Other numbers in the sentence are not checked.`
    : unknown
      ? "Not checked"
      : "A cited name or score could not be matched to this run's Qloo responses";
  return (
    <li className="flex gap-2 text-[12px] leading-snug text-muted">
      <InfoPopover
        label={ok ? "Cited Qloo names and scores checked: show what was checked" : unknown ? "Not checked" : "Not verified: show why"}
        title={ok ? "Checked against Qloo" : unknown ? "Not checked" : "Not verified"}
        trigger={ok ? <IconCheck size={13} /> : <IconAlert size={13} />}
        width={280}
        className={`relative mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full ${tone} transition-transform hover:scale-125 before:absolute before:-inset-3.5 before:content-['']`}
      >
        <p>{explanation}</p>
      </InfoPopover>
      <span>{evidence.text}</span>
    </li>
  );
}
