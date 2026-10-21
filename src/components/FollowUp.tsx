"use client";

import { useRef, useState } from "react";
import { readNdjson } from "@/lib/ndjson";
import { stepLabel } from "@/lib/lens";
import type { AgentEvent, AgentRequest, EntityRef, Evidence } from "@/lib/types";
import type { DemoSummary } from "./ReplayCards";
import { IconArrow, IconCheck, IconSpark } from "./icons";
import { EvidenceLine, Section } from "./ui";

type Thread = {
  question: string;
  steps: { id: string; label: string; done: boolean; summary?: string; error?: boolean }[];
  answer?: string;
  evidence?: Evidence[];
  error?: string;
  // Live runs are capped or paused on this demo (HTTP 429/503): say so plainly and offer the replays.
  paused?: boolean;
  running: boolean;
};

const SUGGESTIONS = [
  "What should I change to attract a younger crowd?",
  "Which neighborhood should I target for delivery?",
  "What would families in this area want from us?",
];

export default function FollowUp({
  restaurant,
  city,
  headline,
  language,
  afterReplay = false,
  demos = [],
  onPlayDemo,
}: {
  restaurant: EntityRef;
  city: string;
  headline?: string;
  language?: AgentRequest["language"];
  /** The playbook above is a recorded run: questions here start a live run, so say so. */
  afterReplay?: boolean;
  demos?: DemoSummary[];
  onPlayDemo?: (d: DemoSummary) => void;
}) {
  const [question, setQuestion] = useState("");
  const [threads, setThreads] = useState<Thread[]>([]);
  const busy = threads.some((t) => t.running);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function ask(q: string) {
    const text = q.trim();
    if (!text || busy) return;
    setQuestion("");
    const index = threads.length;
    setThreads((prev) => [...prev, { question: text, steps: [], running: true }]);
    const update = (fn: (t: Thread) => Thread) =>
      setThreads((prev) => prev.map((t, i) => (i === index ? fn(t) : t)));
    try {
      const body: AgentRequest = {
        restaurant: restaurant.name,
        city,
        language,
        followup: {
          question: text,
          restaurant: { entity_id: restaurant.entity_id, name: restaurant.name, tags: restaurant.tags },
          playbook_headline: headline,
        },
      };
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok || !res.body) {
        const info = (await res.json().catch(() => null)) as { error?: string } | null;
        if (res.status === 429 || res.status === 503) {
          update((t) => ({ ...t, paused: true, error: info?.error ?? "Live runs are paused on this demo." }));
          return;
        }
        throw new Error(info?.error ?? `Request failed (${res.status})`);
      }
      for await (const ev of readNdjson<AgentEvent>(res.body)) {
        if (ev.type === "tool_start" && ev.tool !== "answer_owner") {
          update((t) => ({ ...t, steps: [...t.steps, { id: ev.id, label: stepLabel(ev.label, ev.input), done: false }] }));
        } else if (ev.type === "tool_end") {
          update((t) => ({
            ...t,
            steps: t.steps.map((s) => (s.id === ev.id ? { ...s, done: true, summary: ev.summary, error: ev.error } : s)),
          }));
        } else if (ev.type === "answer") {
          update((t) => ({ ...t, answer: ev.answer, evidence: ev.evidence }));
        } else if (ev.type === "error") {
          update((t) => ({ ...t, error: ev.message, paused: /paused|used up/i.test(ev.message) || t.paused }));
        }
      }
    } catch (err) {
      update((t) => ({ ...t, error: err instanceof Error ? err.message : "Something went wrong." }));
    } finally {
      update((t) => ({ ...t, running: false }));
      inputRef.current?.focus();
    }
  }

  return (
    <Section icon={<IconSpark size={16} />} kicker="Ask Tastecraft" title="Ask a follow-up — the agent goes back to the data">
      <div className="no-print">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(question);
          }}
          className="flex gap-2"
        >
          <label htmlFor="followup" className="sr-only">
            Your question
          </label>
          <input
            id="followup"
            ref={inputRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. What if I want to win the after-work crowd?"
            maxLength={300}
            className="min-w-0 flex-1 rounded-lg border border-line bg-paper/60 px-3 py-2.5 text-[15px] outline-none transition focus:border-olive focus:bg-card"
          />
          <button
            type="submit"
            disabled={busy || !question.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-paper transition hover:bg-olive disabled:opacity-50"
          >
            Ask <IconArrow size={14} />
          </button>
        </form>
        {threads.length === 0 && (
          <>
            {afterReplay && (
              <p className="mt-3 text-[12px] leading-snug text-muted">
                <span className="mr-1.5 inline-flex items-center gap-1 rounded-full bg-terracotta/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-terracotta-ink">
                  <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-terracotta" aria-hidden />
                  Live run
                </span>
                The playbook above is a recording; a question starts the agent live on Qloo and Claude and counts towards this
                demo’s daily live-run limit.
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => ask(s)}
                  disabled={busy}
                  className="rounded-full border border-line bg-paper/60 px-3 py-1.5 text-[13px] text-ink-2 transition hover:border-ink-2/40 hover:text-ink"
                >
                  {afterReplay && <span className="sr-only">Live run: </span>}
                  {s}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="mt-5 space-y-5">
        {threads.map((t, i) => (
          <article key={i} className="rise rounded-xl border border-line bg-paper/40 p-4">
            <p className="font-display text-lg leading-snug">“{t.question}”</p>
            {t.steps.length > 0 && (
              <ul className="mt-3 space-y-1">
                {t.steps.map((s) => (
                  <li key={s.id} className="flex items-start gap-2 text-[13px] text-ink-2">
                    <span className="mt-0.5 text-olive">
                      {s.done ? <IconCheck size={13} /> : <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-terracotta" />}
                    </span>
                    <span>
                      {s.label}
                      {s.summary && <span className="text-muted"> — {s.summary}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {t.running && !t.answer && <p className="mt-3 text-sm text-muted">Reading the taste graph…</p>}
            {t.answer && <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed">{t.answer}</p>}
            {t.evidence && t.evidence.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-line pt-3">
                {t.evidence.map((e, j) => (
                  <EvidenceLine key={j} evidence={e} />
                ))}
              </ul>
            )}
            {t.error && t.paused ? (
              <div role="status" className="mt-3 rounded-lg border border-line bg-card px-3 py-2.5 text-sm">
                <p className="text-ink">
                  Live runs are resting for now: this public demo caps them to protect its budget, so the agent can’t answer this one
                  live.
                </p>
                <p className="mt-1 text-[12px] text-muted">{t.error}</p>
                {demos.length > 0 && onPlayDemo && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted">Watch a recorded real run instead:</span>
                    {demos.map((d) => (
                      <button
                        key={d.slug}
                        type="button"
                        onClick={() => onPlayDemo(d)}
                        className="min-h-8 rounded-full border border-line bg-paper px-3 py-1.5 text-xs font-medium text-ink-2 transition hover:border-ink-2/40 hover:text-ink"
                      >
                        {d.restaurant} →
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : t.error ? (
              <p role="alert" className="mt-3 text-sm text-terracotta-ink">
                {t.error}
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </Section>
  );
}
