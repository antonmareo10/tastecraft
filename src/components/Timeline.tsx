"use client";

import type { EntityRef } from "@/lib/types";
import { IconAlert, IconCheck } from "./icons";

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

export default function Timeline({
  items,
  running,
  elapsedMs,
}: {
  items: TimelineItem[];
  running: boolean;
  elapsedMs: number;
}) {
  return (
    <section aria-label="What the agent is doing" className="rounded-2xl border border-line bg-card">
      <header className="flex items-center justify-between border-b border-line px-5 py-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Agent log</p>
          <h2 className="font-display text-lg leading-tight">How Tastecraft got here</h2>
        </div>
        <span className="tabular-nums text-xs text-muted">
          {running ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-terracotta" />
              {(elapsedMs / 1000).toFixed(0)}s
            </span>
          ) : elapsedMs > 0 ? (
            `${(elapsedMs / 1000).toFixed(0)}s`
          ) : null}
        </span>
      </header>
      <ol className="max-h-[70vh] space-y-1 overflow-y-auto px-3 py-3">
        {items.length === 0 && running && (
          <li className="px-2 py-3 text-sm text-muted">Waking up the agent…</li>
        )}
        {items.map((item) =>
          item.kind === "note" ? (
            <li key={item.key} className="rise px-2 py-1.5 text-[13px] italic leading-snug text-ink-2">
              {item.text}
            </li>
          ) : (
            <StepRow key={item.step.id} step={item.step} />
          ),
        )}
      </ol>
    </section>
  );
}

function StepRow({ step }: { step: Step }) {
  return (
    <li className="rise rounded-xl px-2 py-2.5 hover:bg-paper/60">
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border ${
            step.error
              ? "border-terracotta/40 bg-terracotta/10 text-terracotta"
              : step.done
                ? "border-olive/30 bg-olive/10 text-olive"
                : "border-line bg-paper text-muted"
          }`}
        >
          {step.error ? (
            <IconAlert size={13} />
          ) : step.done ? (
            <IconCheck size={13} />
          ) : (
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-terracotta" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug">{step.label}</p>
          {step.summary && <p className="mt-0.5 text-[13px] leading-snug text-ink-2">{step.summary}</p>}
          {step.entities && step.entities.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {step.entities.slice(0, 6).map((e) => (
                <li
                  key={e.entity_id}
                  className="rounded-full border border-line bg-paper px-2 py-0.5 text-[11px] text-ink-2"
                  title={e.subtitle}
                >
                  {e.name}
                  {typeof e.affinity === "number" && (
                    <span className="ml-1 tabular-nums text-muted">{Math.round(e.affinity * 100)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </li>
  );
}
