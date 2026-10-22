"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { m } from "motion/react";
import type { QlooFlip } from "@/lib/flip";
import type { AgentEvent, AgentRequest } from "@/lib/types";
import { gainPct, HELD_OUT } from "@/lib/benchmark";
import { readNdjson } from "@/lib/ndjson";
import { stepLabel } from "@/lib/lens";
import { favoursSummary } from "@/lib/menu-terms";
import { EASE_OUT, REVEAL, STAGGER } from "@/lib/motion";
import { scrollToElement } from "@/lib/scroll";
import type { Step, TimelineItem } from "./Timeline";
import type { LiveState } from "./PlaybookView";
import HeroLight from "./HeroLight";
import QlooSwitch from "./QlooSwitch";
import ReplayCards, { type DemoSummary } from "./ReplayCards";
import { KineticText, MagneticButton, Reveal } from "./fx";
import { IconAlert, IconArrow } from "./icons";

export type { DemoSummary };

const GOALS = [
  "Fill quiet weeknights",
  "Launch a new seasonal special",
  "Win a younger crowd",
  "Grow delivery orders",
  "Plan a second location",
];

const SAMPLES: AgentRequest[] = [
  { restaurant: "Katz's Delicatessen", city: "New York", goal: "Fill quiet weeknights" },
  { restaurant: "Gjelina", city: "Los Angeles", goal: "Win a younger crowd" },
  { restaurant: "Casa Lucio", city: "Madrid", goal: "Launch a new seasonal special" },
];

// The data and tools behind every playbook, for the footer.
const CREDITS = [
  "Built for the Qloo Agentic Hackathon",
  "Taste data by Qloo",
  "Reasoning by Claude",
  "Maps © OpenStreetMap contributors",
  "Concerts via Ticketmaster",
];

const HEADLINE = "Know who loves your restaurant, and what they crave.";

// The agent's workspace (log, playbook, constellation, share images, follow-up) is only needed once a
// run starts, so it loads on demand: warmed as soon as the visitor reaches for the form or a replay.
const loadTimeline = () => import("./Timeline");
const loadPlaybook = () => import("./PlaybookView");
const loadFollowUp = () => import("./FollowUp");
const Timeline = dynamic(loadTimeline, { loading: () => <div className="shimmer h-64 rounded-2xl border border-line bg-card" /> });
const PlaybookView = dynamic(loadPlaybook, { loading: () => <SkeletonCards /> });
const FollowUp = dynamic(loadFollowUp);
const warmWorkspace = () => {
  void loadTimeline();
  void loadPlaybook();
  void loadFollowUp();
};

type Phase = "idle" | "running" | "done" | "error";

const timestamp = () => Date.now();

export default function TastecraftApp({ demos = [], flips = [] }: { demos?: DemoSummary[]; flips?: QlooFlip[] }) {
  const [form, setForm] = useState<AgentRequest>({ restaurant: "", city: "", goal: GOALS[0], language: "English" });
  const [phase, setPhase] = useState<Phase>("idle");
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Live runs refused by the demo's caps or paused (HTTP 429/503, or a "paused" message mid-run).
  const [capped, setCapped] = useState(false);
  const [replay, setReplay] = useState<DemoSummary | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const [logOpen, setLogOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (phase !== "running") return;
    const t = setInterval(() => setNow(timestamp()), 500);
    return () => clearInterval(t);
  }, [phase]);

  const { items, live } = useMemo(() => derive(events), [events]);
  const doneEvent = events.find((e) => e.type === "done") as Extract<AgentEvent, { type: "done" }> | undefined;
  const elapsed = doneEvent ? doneEvent.elapsed_ms : phase === "running" && startedAt ? now - startedAt : 0;

  async function run(req: AgentRequest, demo?: DemoSummary) {
    if (!req.restaurant.trim() || !req.city.trim()) return;
    warmWorkspace();
    setReplay(demo ?? null);
    setLogOpen(false);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setEvents([]);
    setError(null);
    setCapped(false);
    setPhase("running");
    const t0 = timestamp();
    setStartedAt(t0);
    setNow(t0);
    // The form hands over to the agent's workspace: one continuous glide down to it.
    requestAnimationFrame(() => {
      if (resultsRef.current) scrollToElement(resultsRef.current, 16);
    });
    try {
      const res = demo
        ? await fetch(`/api/demo/${demo.slug}`, { signal: controller.signal })
        : await fetch("/api/agent", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(req),
            signal: controller.signal,
          });
      if (!res.ok || !res.body) {
        const info = (await res.json().catch(() => null)) as { error?: string } | null;
        if (res.status === 429 || res.status === 503) setCapped(true);
        throw new Error(info?.error ?? `The agent could not start (${res.status}).`);
      }
      for await (const ev of readNdjson<AgentEvent>(res.body)) {
        setEvents((prev) => [...prev, ev]);
        if (ev.type === "error") {
          setError(ev.message);
          if (/paused|used up/i.test(ev.message)) setCapped(true);
        }
      }
      setPhase((p) => (p === "running" ? "done" : p));
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setPhase("error");
    }
  }

  function playDemo(d: DemoSummary) {
    const req = { restaurant: d.restaurant, city: d.city, goal: d.goal };
    setForm(req);
    run(req, d);
  }

  const started = phase !== "idle";
  const running = phase === "running";
  // On phones the agent log sits above the playbook; once the run is over it folds into one line so
  // the playbook's headline comes first. Desktop keeps it open in the sidebar.
  const logFolded = phase === "done" && !logOpen;
  const stepCount = items.filter((i) => i.kind === "step").length;

  return (
    <div className="relative isolate flex min-h-screen flex-col overflow-x-clip">
      <HeroLight className="absolute inset-x-0 top-0 -z-10 h-[760px] w-full sm:h-[880px]" />
      {/* The resting light where the cursor one is off (touch screens, reduced motion): plain CSS. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-[38%] top-0 -z-10 h-[560px] w-[560px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(221,154,46,0.17),rgba(192,83,44,0.05)_45%,transparent_68%)] [@media(hover:hover)_and_(pointer:fine)_and_(prefers-reduced-motion:no-preference)]:hidden"
      />

      <header className="no-print mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-5 sm:px-6">
        <Link href="/" className="group flex items-center gap-2.5 pointer-coarse:min-h-11" aria-label="Tastecraft home">
          <Logo />
          <span className="font-display text-xl tracking-tight">Tastecraft</span>
        </Link>
        <nav className="flex items-center gap-4 text-xs text-muted">
          <span className="hidden sm:inline">Qloo taste graph × Claude</span>
          <Link
            href="/about"
            className="inline-flex min-h-9 items-center rounded-full border border-line bg-card/70 px-3.5 py-1 text-ink-2 backdrop-blur transition hover:border-ink-2/40 hover:text-ink pointer-coarse:min-h-11 pointer-coarse:px-4"
          >
            About
          </Link>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-20 sm:px-6">
        <section
          onPointerOver={warmWorkspace}
          onFocusCapture={warmWorkspace}
          onTouchStartCapture={warmWorkspace}
          className={`no-print grid gap-10 ${started ? "py-4" : "py-10 sm:py-16"} lg:grid-cols-[1.1fr_1fr] lg:items-center`}
        >
          <div>
            <p className="fade-up text-[11px] font-semibold uppercase tracking-[0.18em] text-terracotta-ink">For independent restaurants</p>
            <KineticText
              as="h1"
              text={HEADLINE}
              delayMs={60}
              className="font-display mt-3 text-[2.6rem] leading-[1.04] tracking-tight sm:text-6xl"
              accent={(word, i) => (i === HEADLINE.split(" ").length - 1 ? <Squiggle word={word} /> : null)}
            />
            {/* Static on purpose: readable from the first frame while the headline animates. */}
            <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-ink-2">
              Chains have insight teams. You have Tastecraft: an AI agent that reads Qloo’s taste graph around your
              restaurant and turns it into menu moves, events, local marketing and a supplier shopping list, with the
              evidence behind every call.
            </p>
            {/* Phones: the replay buttons in the form are a screen and a half down, so offer them here too. */}
            {!started && demos.length > 0 && (
              <div className="fade-up mt-6 lg:hidden" style={{ "--d": "480ms" } as React.CSSProperties}>
                <p className="text-[13px] font-medium text-ink">Watch a real recorded run, replayed in about 15 seconds:</p>
                <ReplayCards demos={demos} onPlay={playDemo} variant="list" />
              </div>
            )}
            {!started && (
              <div
                className="fade-up mt-7 flex max-w-xl items-center gap-5 rounded-2xl border border-line bg-card/90 p-4 shadow-[0_18px_40px_-30px_rgba(29,27,23,0.35)] backdrop-blur-sm sm:p-5"
                style={{ "--d": "560ms" } as React.CSSProperties}
              >
                <div className="shrink-0 text-center">
                  {/* Final values, revealed by CSS from the first paint: no frame ever shows a wrong number. */}
                  <div className="fade-up font-display text-5xl leading-none tabular-nums text-olive" style={{ "--d": "760ms" } as React.CSSProperties}>
                    {gainPct(HELD_OUT.ratio)}
                  </div>
                  <div className="mt-1 max-w-[7.5rem] text-[11px] leading-tight text-muted">vs the same model alone</div>
                </div>
                <p className="text-[13px] leading-snug text-ink-2">
                  <span className="font-semibold text-ink">Measured on restaurants it never saw.</span> With Qloo’s crowd-vs-city
                  signal, Claude’s dish ideas lean {gainPct(HELD_OUT.ratio).slice(1)} further towards what each restaurant’s crowd
                  favours than without it (95% CI {gainPct(HELD_OUT.ciLow)} to {gainPct(HELD_OUT.ciHigh)}), better in {HELD_OUT.better} of{" "}
                  {HELD_OUT.restaurants} restaurants. The ruler is Qloo’s own menu tags: how often the crowd’s favourite places serve a
                  dish compared with the city’s most popular ones ·{" "}
                  <a
                    href={HELD_OUT.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline decoration-line underline-offset-2 hover:text-ink"
                  >
                    method
                  </a>
                </p>
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(form);
            }}
            className="fade-up rounded-2xl border border-line bg-card p-5 shadow-[0_1px_0_rgba(29,27,23,0.04),0_24px_50px_-30px_rgba(29,27,23,0.4)] sm:p-6"
            style={{ "--d": "200ms" } as React.CSSProperties}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Restaurant">
                <input
                  required
                  value={form.restaurant}
                  onChange={(e) => setForm({ ...form, restaurant: e.target.value, entity_id: undefined })}
                  placeholder="e.g. Casa Lucio"
                  className="w-full rounded-lg border border-line bg-paper/60 px-3 py-2.5 text-[15px] outline-none transition focus:border-olive focus:bg-card focus-visible:ring-4 focus-visible:ring-olive/15"
                />
              </Field>
              <Field label="City">
                <input
                  required
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value, entity_id: undefined })}
                  placeholder="e.g. Madrid"
                  className="w-full rounded-lg border border-line bg-paper/60 px-3 py-2.5 text-[15px] outline-none transition focus:border-olive focus:bg-card focus-visible:ring-4 focus-visible:ring-olive/15"
                />
              </Field>
            </div>
            <fieldset className="mt-4">
              <legend className="mb-2 text-xs font-medium text-ink-2">What do you want to achieve?</legend>
              <div className="flex flex-wrap gap-2">
                {GOALS.map((g) => (
                  <button
                    key={g}
                    type="button"
                    aria-pressed={form.goal === g}
                    onClick={() => setForm({ ...form, goal: g })}
                    className={`rounded-full border px-3 py-1.5 text-[13px] transition duration-200 active:scale-[0.97] pointer-coarse:min-h-11 ${
                      form.goal === g
                        ? "border-olive bg-olive text-paper"
                        : "border-line bg-paper/60 text-ink-2 hover:border-ink-2/40 hover:text-ink"
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="mt-4 flex items-center gap-3 text-xs text-ink-2">
              <span>Playbook language</span>
              <div role="radiogroup" aria-label="Playbook language" className="inline-flex rounded-full border border-line bg-paper/60 p-0.5">
                {(["English", "Español"] as const).map((l) => (
                  <button
                    key={l}
                    type="button"
                    role="radio"
                    aria-checked={(form.language ?? "English") === l}
                    onClick={() => setForm({ ...form, language: l })}
                    className={`rounded-full px-3 py-1 transition pointer-coarse:min-h-10 pointer-coarse:px-4 ${(form.language ?? "English") === l ? "bg-ink text-paper" : "text-ink-2 hover:text-ink"}`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <MagneticButton
              type="submit"
              disabled={running}
              className="group mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-ink px-5 py-3.5 text-[15px] font-medium text-paper transition-colors duration-300 hover:bg-olive disabled:cursor-wait disabled:opacity-70"
            >
              {running ? (
                <>
                  <span className="pulse-dot h-2 w-2 rounded-full bg-saffron" /> Reading the taste graph…
                </>
              ) : (
                <>
                  Build my taste playbook
                  <IconArrow size={16} className="transition-transform duration-300 ease-out group-hover:translate-x-1" />
                </>
              )}
            </MagneticButton>
            <div className={`mt-5 border-t border-line pt-4 ${started ? "" : "hidden lg:block"}`}>
              {demos.length ? (
                <>
                  <p className="mb-2.5 text-[13px] font-medium text-ink">Instant replays of real runs</p>
                  {/* Phones keep the full-width rows; three cards side by side do not fit 390 px. */}
                  <div className="sm:hidden">
                    <ReplayCards demos={demos} onPlay={playDemo} disabled={running} variant="list" />
                  </div>
                  <div className="hidden sm:block">
                    <ReplayCards demos={demos} onPlay={playDemo} disabled={running} variant="grid" />
                  </div>
                </>
              ) : (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-muted">
                  <span>Try:</span>
                  {SAMPLES.map((s) => (
                    <button
                      key={s.restaurant}
                      type="button"
                      onClick={() => {
                        const req = { restaurant: s.restaurant, city: s.city, goal: s.goal };
                        setForm(req);
                        run(req);
                      }}
                      disabled={running}
                      className="group inline-flex items-center gap-1 text-ink-2 underline decoration-line underline-offset-4 hover:text-ink hover:decoration-ink-2"
                    >
                      {s.restaurant}, {s.city} <IconArrow size={12} className="transition-transform group-hover:translate-x-0.5" />
                    </button>
                  ))}
                </div>
              )}
              <p className="mt-2.5 text-[12px] text-muted">
                {demos.length
                  ? "Replays are recorded real runs, sped up. A live run reads Qloo for about 2 minutes."
                  : "A live run reads Qloo for about 2 minutes."}
              </p>
            </div>
          </form>
        </section>

        {!started && flips.length > 0 && (
          <QlooSwitch
            flips={flips}
            onPlay={(slug) => {
              const d = demos.find((x) => x.slug === slug);
              if (d) playDemo(d);
            }}
          />
        )}

        {!started && <HowItWorks />}

        {/* At least a screen tall once a run starts, so the glide down to it is never cut short. */}
        <div ref={resultsRef} className={started ? "min-h-screen" : undefined}>
          {started && (
            <m.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: EASE_OUT }}
              className="grid grid-cols-1 gap-5 lg:grid-cols-[340px_minmax(0,1fr)] lg:items-start"
            >
              <div className="no-print min-w-0 lg:sticky lg:top-4">
                {logFolded && (
                  <button
                    type="button"
                    onClick={() => setLogOpen(true)}
                    aria-expanded={false}
                    className="flex w-full items-center justify-between gap-3 rounded-2xl border border-line bg-card px-4 py-3 text-left lg:hidden"
                  >
                    <span>
                      <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Agent log</span>
                      <span className="block text-sm text-ink-2">
                        {stepCount} steps in {(elapsed / 1000).toFixed(0)} s · show how Tastecraft got here
                      </span>
                    </span>
                    <span aria-hidden className="grid h-8 w-8 place-items-center rounded-full border border-line text-lg leading-none text-ink-2">
                      +
                    </span>
                  </button>
                )}
                <div className={logFolded ? "hidden lg:block" : undefined}>
                  <Timeline items={items} running={running} elapsedMs={elapsed} />
                </div>
              </div>
              <div className="min-w-0">
                {replay && (
                  <p className="mb-4 flex items-start gap-2.5 rounded-xl border border-line bg-card px-4 py-2.5 text-[13px] text-ink-2">
                    <span className="rec-dot mt-1.5 shrink-0" aria-hidden />
                    <span>
                      Instant replay of a real Tastecraft run recorded on{" "}
                      {new Date(replay.recordedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}{" "}
                      (live Qloo + Claude data, sped up). Use the form to run it live for any restaurant.
                    </span>
                  </p>
                )}
                {error && (
                  <m.div
                    role="alert"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, ease: EASE_OUT }}
                    className="mb-5 flex gap-3.5 rounded-2xl border border-terracotta/30 bg-terracotta/5 px-5 py-4 text-sm"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-terracotta/10 text-terracotta">
                      <IconAlert size={17} />
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold text-terracotta-ink">
                        {capped ? "Live runs are resting right now" : "The agent hit a problem"}
                      </p>
                      {capped && (
                        <p className="mt-1 text-ink-2">
                          This public demo caps live runs to protect its budget. Every replay below is a real recorded run and plays
                          instantly.
                        </p>
                      )}
                      <p className={capped ? "mt-1 text-[12px] text-muted" : "mt-1 text-ink-2"}>{error}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {!capped && (
                          <button
                            type="button"
                            onClick={() => run(form)}
                            className="min-h-8 rounded-full border border-ink bg-ink px-3.5 py-1.5 text-xs font-medium text-paper transition hover:bg-olive"
                          >
                            Try again
                          </button>
                        )}
                        {/* If live mode is down or busy, a judge can still see a real run instantly. */}
                        {demos.length > 0 && (
                          <>
                            <span className="text-xs text-muted">{capped ? "Watch a recorded real run:" : "or watch a recorded real run:"}</span>
                            {demos.slice(0, 3).map((d) => (
                              <button
                                key={d.slug}
                                type="button"
                                onClick={() => playDemo(d)}
                                className="min-h-8 rounded-full border border-line bg-card px-3 py-1.5 text-xs font-medium text-ink-2 transition hover:border-ink-2/40 hover:text-ink"
                              >
                                {d.restaurant} →
                              </button>
                            ))}
                          </>
                        )}
                      </div>
                    </div>
                  </m.div>
                )}
                <PlaybookView
                  live={live}
                  running={running}
                  language={form.language}
                  onPickAlternative={
                    replay
                      ? undefined
                      : (alt) => {
                          const req = { ...form, restaurant: alt.name, entity_id: alt.entity_id };
                          setForm(req);
                          run(req);
                        }
                  }
                />
                {phase === "done" && live.playbook && live.restaurant && (
                  <div className="mt-5">
                    <FollowUp
                      restaurant={live.restaurant}
                      city={form.city}
                      headline={live.playbook.headline}
                      language={form.language}
                      afterReplay={replay != null}
                      demos={demos}
                      onPlayDemo={playDemo}
                    />
                  </div>
                )}
                {running && !live.restaurant && !error && <SkeletonCards />}
              </div>
            </m.div>
          )}
        </div>
      </main>

      <footer className="no-print border-t border-line py-6 text-xs text-muted">
        <div className="marquee overflow-hidden">
          <div className="marquee-track">
            {[0, 1].map((copy) => (
              <ul key={copy} aria-hidden={copy === 1 ? true : undefined} className={`flex shrink-0 items-center ${copy ? "marquee-dup" : ""}`}>
                {CREDITS.map((c) => (
                  <li key={c} className="flex items-center gap-6 whitespace-nowrap px-3">
                    <span aria-hidden className="h-1 w-1 rounded-full bg-saffron" />
                    {c}
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}

function derive(events: AgentEvent[]): { items: TimelineItem[]; live: LiveState } {
  const items: TimelineItem[] = [];
  const steps = new Map<string, Step>();
  const lensed = new Set<string>(); // steps run with a demographic lens
  const live: LiveState = { dna: {}, tags: {} };
  events.forEach((ev, i) => {
    switch (ev.type) {
      case "note":
        items.push({ kind: "note", text: ev.text, key: `note-${i}` });
        break;
      case "tool_start": {
        // Older recordings carry raw lens values ("(lens: 24_and_younger)"); show them in plain words.
        const step: Step = { id: ev.id, tool: ev.tool, label: stepLabel(ev.label, ev.input), done: false };
        steps.set(ev.id, step);
        if (ev.input?.lens_age || ev.input?.lens_gender) lensed.add(ev.id);
        items.push({ kind: "step", step });
        break;
      }
      case "tool_end": {
        const step = steps.get(ev.id);
        if (step) {
          step.done = true;
          step.error = ev.error;
          step.summary =
            ev.tool === "taste_map" && ev.summary?.startsWith("Hotspots: ")
              ? `Hotspots: ${[...new Set(ev.summary.slice(10).split(", "))].join(", ")}`
              : ev.tool === "taste_gaps" && ev.summary
                ? // Same readable terms as the crowd-vs-city list (the unlensed call's list arrives just before).
                  favoursSummary(ev.summary, lensed.has(ev.id) ? undefined : live.crowdMenu?.favours)
                : ev.summary?.replace(/^1 concerts /, "1 concert ");
          // For the restaurant search, show the pick and only the runner-ups Qloo tags as restaurants
          // (older recordings carry no tag: they show the pick alone, not the landmarks a city search returns).
          step.entities =
            ev.tool === "find_restaurant"
              ? ev.entities?.filter((e, i) => i === 0 || (e as { is_restaurant?: boolean }).is_restaurant === true)
              : ev.entities;
        }
        if (ev.domain && ev.entities?.length && !ev.error) {
          live.dna[ev.domain] = mergeEntities(live.dna[ev.domain], ev.entities);
        }
        break;
      }
      case "restaurant":
        live.restaurant = ev.entity;
        live.resolution = ev.resolution;
        break;
      case "heatmap":
        // Older recordings can name the same neighborhood twice: keep the strongest one per name.
        live.heatmap = { cells: ev.cells, zones: ev.zones.filter((z, i, all) => all.findIndex((x) => x.label === z.label) === i), center: ev.center };
        break;
      case "baseline":
        live.baseline = ev.text;
        break;
      case "demographics":
        live.demographics = { age: ev.age, gender: ev.gender };
        break;
      case "taste_tags":
        live.tags[ev.family] = ev.tags;
        break;
      case "crowd_menu":
        live.crowdMenu = { city: ev.city, crowd_n: ev.crowd_n, city_n: ev.city_n, favours: ev.favours, avoids: ev.avoids };
        break;
      case "compare":
        live.compare = { a: ev.a, b: ev.b, only_a: ev.only_a ?? [], only_b: ev.only_b ?? [], shared: ev.shared ?? [] };
        break;
      case "shows":
        live.shows = ev.shows;
        break;
      case "trends": {
        // A later rising_nearby call (e.g. for the rival) adds to the list; the newest series per place wins.
        const byId = new Map((live.trends ?? []).map((t) => [t.entity_id, t]));
        for (const t of ev.series) byId.set(t.entity_id, t);
        live.trends = [...byId.values()];
        break;
      }
      case "playbook":
        live.playbook = ev.playbook;
        break;
      case "playbook_draft":
        live.draft = ev.draft;
        break;
    }
  });
  return { items, live };
}

function mergeEntities(a: LiveState["dna"][string] | undefined, b: LiveState["dna"][string]) {
  const seen = new Map((a ?? []).map((e) => [e.entity_id, e]));
  for (const e of b) if (!seen.has(e.entity_id)) seen.set(e.entity_id, e);
  return [...seen.values()].sort((x, y) => (y.affinity ?? 0) - (x.affinity ?? 0));
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-ink-2">{label}</span>
      {children}
    </label>
  );
}

// The headline's last word gets a hand-drawn saffron stroke that draws in after the words land.
function Squiggle({ word }: { word: string }) {
  const bare = word.replace(/[.,!?]+$/, "");
  return (
    <>
      <span className="relative inline-block">
        {bare}
        <svg
          aria-hidden
          viewBox="0 0 200 14"
          preserveAspectRatio="none"
          className="squiggle pointer-events-none absolute -bottom-[0.1em] left-[-2%] h-[0.22em] w-[104%] overflow-visible text-saffron"
        >
          <path
            d="M3 9 C 40 3, 70 13, 104 7 S 165 3, 197 8"
            pathLength={1}
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </span>
      {word.slice(bare.length)}
    </>
  );
}

function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden>
      <circle cx="16" cy="16" r="15" fill="#2f4a35" />
      <circle cx="16" cy="16" r="9.5" fill="none" stroke="#f6f1e7" strokeWidth="1.6" />
      <path
        d="M16 6.5v19M6.5 16h19"
        stroke="#dd9a2e"
        strokeWidth="1.6"
        strokeLinecap="round"
        className="origin-center transition-transform duration-500 ease-out group-hover:rotate-45 motion-reduce:transition-none"
      />
      <circle cx="16" cy="16" r="3" fill="#c0532c" />
    </svg>
  );
}

function HowItWorks() {
  const steps = [
    ["Find", "Locates your restaurant inside Qloo’s taste graph of hundreds of millions of places, brands, artists and titles."],
    ["Profile", "Reads what your guests also love — nearby places, music, brands, movies — with real affinity scores."],
    ["Map", "Draws where people with your guests’ taste live and go out, neighborhood by neighborhood."],
    ["Act", "Turns it into three dishes to test, an event, a ready-to-post campaign and a supplier shopping list."],
  ];
  return (
    <section aria-label="How it works" className="grid gap-6 border-t border-line py-10 sm:grid-cols-2 lg:grid-cols-4">
      {steps.map(([t, d], i) => (
        <Reveal key={t} delay={i * STAGGER * 1.6}>
          <p className="font-display text-3xl text-terracotta">{String(i + 1).padStart(2, "0")}</p>
          <p className="mt-1 font-semibold">{t}</p>
          <p className="mt-1 text-sm leading-relaxed text-ink-2">{d}</p>
        </Reveal>
      ))}
    </section>
  );
}

// Shaped like what is about to arrive: the playbook's olive header and a section card.
function SkeletonCards() {
  return (
    <m.div
      aria-hidden
      initial="hidden"
      animate="shown"
      variants={REVEAL}
      className="space-y-5"
    >
      <div className="shimmer rounded-2xl bg-olive px-6 py-6 sm:px-8 sm:py-8">
        <div className="h-2.5 w-28 rounded-full bg-paper/25" />
        <div className="mt-3 h-8 w-56 max-w-full rounded-lg bg-paper/30" />
        <div className="mt-2.5 h-3 w-80 max-w-full rounded-full bg-paper/20" />
        <div className="mt-4 flex gap-1.5">
          {[64, 92, 56, 76].map((w) => (
            <div key={w} className="h-5 rounded-full bg-paper/15" style={{ width: w }} />
          ))}
        </div>
      </div>
      <div className="shimmer rounded-2xl border border-line bg-card p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-paper-2" />
          <div>
            <div className="h-2.5 w-24 rounded-full bg-paper-2" />
            <div className="mt-2 h-5 w-52 max-w-full rounded-md bg-paper-2" />
          </div>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 rounded-xl bg-paper-2/70" />
          ))}
        </div>
      </div>
    </m.div>
  );
}
