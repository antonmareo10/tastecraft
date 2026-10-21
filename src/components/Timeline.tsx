"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import type { EntityRef } from "@/lib/types";
import { EASE_OUT } from "@/lib/motion";
import { Ticker } from "./fx";
import { IconAlert } from "./icons";

export type Step = {
  id: string;
  tool: string;
  label: string;
  done: boolean;
  error?: boolean;
  summary?: string;
  entities?: EntityRef[];
};

export type TimelineItem =
  | { kind: "step"; step: Step }
  | { kind: "note"; text: string; key: string };

// What each agent tool reads (see src/lib/agent.ts and src/lib/qloo-tasks.ts), shown as a chip so
// the log reads like the agent working on Qloo's graph, call by call.
const SOURCE: Record<string, { label: string; qloo: boolean }> = {
  find_restaurant: { label: "Qloo /search", qloo: true },
  audience_affinity: { label: "Qloo /v2/insights", qloo: true },
  taste_tags: { label: "Qloo /v2/insights · tags", qloo: true },
  audience_profile: { label: "Qloo /v2/insights · demographics", qloo: true },
  taste_gaps: { label: "Qloo /v2/insights · crowd vs city", qloo: true },
  taste_map: { label: "Qloo /v2/insights · heatmap", qloo: true },
  compare_rival: { label: "Qloo /v2/analysis/compare", qloo: true },
  rising_nearby: { label: "Qloo /v2/trending", qloo: true },
  nearby_shows: { label: "Ticketmaster + Qloo rank", qloo: true },
  draft_playbook: { label: "Claude", qloo: false },
  publish_playbook: { label: "Claude · cites checked", qloo: false },
  answer_owner: { label: "Claude", qloo: false },
};

const ENTER = { duration: 0.4, ease: EASE_OUT };

export default function Timeline({
  items,
  running,
  elapsedMs,
}: {
  items: TimelineItem[];
  running: boolean;
  elapsedMs: number;
}) {
  const reduce = useReducedMotion();
  const listRef = useRef<HTMLOListElement | null>(null);
  // Follow the newest step while the agent works, unless the reader scrolls back up the log.
  const follow = useRef(true);

  const steps = items.flatMap((i) => (i.kind === "step" ? [i.step] : []));
  const qlooCalls = steps.filter((s) => s.done && SOURCE[s.tool]?.qloo).length;
  const entities = new Set(steps.flatMap((s) => (s.entities ?? []).map((e) => e.entity_id))).size;
  const doneSteps = steps.filter((s) => s.done).length;

  useEffect(() => {
    const el = listRef.current;
    if (!el || !running || !follow.current) return;
    el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [items.length, doneSteps, running, reduce]);

  return (
    <section aria-label="What the agent is doing" className="overflow-hidden rounded-2xl border border-line bg-card">
      <header className="border-b border-line px-5 pb-3.5 pt-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Agent log</p>
          {(running || elapsedMs > 0) && (
            <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-paper px-2.5 py-1 text-[11px] tabular-nums text-ink-2">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${running ? "pulse-dot bg-terracotta" : "bg-olive"}`} />
              {running ? "" : "Done · "}
              {(elapsedMs / 1000).toFixed(0)} s
            </span>
          )}
        </div>
        <h2 className="font-display mt-0.5 text-lg leading-tight">How Tastecraft got here</h2>
        <dl className="mt-3 grid grid-cols-3 gap-1.5">
          {(
            [
              ["Qloo tool calls", qlooCalls],
              ["Entities found", entities],
              ["Steps done", doneSteps],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="rounded-lg bg-paper/70 px-2.5 py-1.5">
              <dt className="text-[10px] leading-tight text-muted">{label}</dt>
              <dd className="font-display text-xl leading-tight text-ink">
                <Ticker value={value} />
              </dd>
            </div>
          ))}
        </dl>
      </header>
      <ol
        ref={listRef}
        data-lenis-prevent
        onWheel={(e) => {
          if (e.deltaY < 0) follow.current = false;
        }}
        onTouchMove={() => {
          follow.current = false;
        }}
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollHeight - el.scrollTop - el.clientHeight < 24) follow.current = true;
        }}
        className="max-h-[62vh] space-y-1 overflow-y-auto px-3 py-3 lg:max-h-[calc(100vh-15rem)]"
      >
        {items.length === 0 && running && (
          <li className="flex items-center gap-3 px-2 py-3 text-sm text-muted">
            <Spinner />
            Waking up the agent…
          </li>
        )}
        {items.map((item) =>
          item.kind === "note" ? (
            <m.li
              key={item.key}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={ENTER}
              className="border-l-2 border-saffron/60 py-1 pl-3 pr-2 text-[13px] italic leading-snug text-ink-2"
            >
              {item.text}
            </m.li>
          ) : (
            <StepRow key={item.step.id} step={item.step} />
          ),
        )}
      </ol>
    </section>
  );
}

function Spinner() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden className="motion-safe:animate-spin">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function StatusIcon({ step }: { step: Step }) {
  const state = step.error ? "error" : step.done ? "done" : "running";
  return (
    <span
      className={`relative mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border transition-colors duration-300 ${
        state === "error"
          ? "border-terracotta/40 bg-terracotta/10 text-terracotta"
          : state === "done"
            ? "border-olive/30 bg-olive/10 text-olive"
            : "ring-pulse border-terracotta/30 bg-card text-terracotta"
      }`}
    >
      <span className="sr-only">{state === "error" ? "Failed:" : state === "done" ? "Done:" : "In progress:"}</span>
      <AnimatePresence initial={false} mode="wait">
        <m.span
          key={state}
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.5 }}
          transition={{ duration: 0.18 }}
          className="grid place-items-center"
        >
          {state === "error" ? (
            <IconAlert size={13} />
          ) : state === "done" ? (
            <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden>
              <m.path
                d="M5 12.5l4.5 4.5L19 7.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.35, ease: EASE_OUT, delay: 0.05 }}
              />
            </svg>
          ) : (
            <Spinner />
          )}
        </m.span>
      </AnimatePresence>
    </span>
  );
}

function StepRow({ step }: { step: Step }) {
  const source = SOURCE[step.tool];
  return (
    <m.li
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={ENTER}
      className="rounded-xl px-2 py-2.5 transition-colors hover:bg-paper/60"
    >
      <div className="flex items-start gap-3">
        <StatusIcon step={step} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug">{step.label}</p>
          {source && (
            <span
              className={`mt-1 inline-flex items-center gap-1 rounded-md border px-1.5 py-px font-mono text-[10.5px] leading-[1.5] ${
                source.qloo ? "border-olive/20 bg-olive/[0.06] text-olive" : "border-plum/20 bg-plum/[0.06] text-plum"
              }`}
            >
              <span aria-hidden className={`h-1 w-1 rounded-full ${source.qloo ? "bg-olive" : "bg-plum"}`} />
              {source.label}
            </span>
          )}
          {step.summary && (
            <m.p
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={ENTER}
              className="mt-1 text-[13px] leading-snug text-ink-2"
            >
              {step.summary}
            </m.p>
          )}
          {step.entities && step.entities.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {step.entities.slice(0, 6).map((e, i) => (
                <m.li
                  key={e.entity_id}
                  initial={{ opacity: 0, scale: 0.9, y: 4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ ...ENTER, delay: i * 0.05 }}
                  className="rounded-full border border-line bg-paper px-2 py-0.5 text-[11px] text-ink-2"
                  title={e.subtitle}
                >
                  {e.name}
                  {typeof e.affinity === "number" && (
                    <span className="ml-1 tabular-nums text-muted">{Math.round(e.affinity * 100)}</span>
                  )}
                </m.li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </m.li>
  );
}
