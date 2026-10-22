"use client";

import { useState, type KeyboardEvent } from "react";
import { m } from "motion/react";
import { gainPct, HELD_OUT } from "@/lib/benchmark";
import type { FlipDish, QlooFlip } from "@/lib/flip";
import { liftLabel } from "@/lib/lift";
import { EASE_OUT, SPRING } from "@/lib/motion";
import { Reveal } from "./fx";
import { IconArrow } from "./icons";

// The meter is log-scaled from ×0.5 to ×4, so ×1 (as common as at the city's most popular
// restaurants) sits a third of the way along and ×2 and ×0.5 are the same distance from it.
const LO = Math.log2(0.5);
const HI = Math.log2(4);
const meterPct = (v: number | null) => (v == null ? 0 : Math.min(98, Math.max(2, ((Math.log2(v) - LO) / (HI - LO)) * 100)));
const CITY_PCT = meterPct(1);

const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

const liftTone = (v: number | null) =>
  v == null ? "border-line text-muted" : v >= 1.2 ? "border-olive/30 bg-olive/10 text-olive" : v <= 0.85 ? "border-terracotta/25 bg-terracotta/5 text-terracotta-ink" : "border-line text-ink-2";

/**
 * One recorded run with Qloo switched on (the agent's three dishes) or off (the same model's three
 * dishes from one quick call with no Qloo data), both scored with the crowd lift the server computed
 * in that run. The card stacks both answers in one grid cell and fades between them, so the page
 * never jumps and both answers are in the HTML.
 */
export default function QlooSwitch({ flips, onPlay }: { flips: QlooFlip[]; onPlay: (slug: string) => void }) {
  const [pick, setPick] = useState(0);
  const [on, setOn] = useState(true);
  const f = flips[Math.min(pick, flips.length - 1)];
  if (!f) return null;
  const score = on ? f.with.score : f.without.score;

  // Arrow keys move between the recorded runs, like native radio buttons.
  const onPickerKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (pick + step + flips.length) % flips.length;
    setPick(next);
    (e.currentTarget.querySelectorAll<HTMLButtonElement>("[role=radio]")[next] ?? null)?.focus();
  };

  return (
    <section
      aria-labelledby="qloo-switch-title"
      className="no-print grid gap-8 border-t border-line py-12 sm:py-16 lg:grid-cols-[0.85fr_1.15fr] lg:grid-rows-[auto_1fr] lg:gap-x-12 lg:gap-y-6"
    >
      {/* Phones read top to bottom: the switch, then the card it changes, then the fine print. */}
      <Reveal className="lg:col-start-1 lg:row-start-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-terracotta-ink">Same question, same model</p>
        <h2 id="qloo-switch-title" className="font-display mt-3 text-4xl leading-[1.05] tracking-tight sm:text-5xl">
          Now switch Qloo off.
        </h2>
        <p className="mt-4 max-w-md text-[16px] leading-relaxed text-ink-2">
          Without Qloo, the model answers from the cuisine, so every deli gets roughly the same ideas. With Qloo, the agent starts
          from who actually loves this restaurant and what else they love.
        </p>

        <div role="radiogroup" aria-label="Recorded run" onKeyDown={onPickerKey} className="mt-6 flex flex-wrap gap-2">
          {flips.map((x, i) => (
            <button
              key={x.slug}
              type="button"
              role="radio"
              aria-checked={i === pick}
              tabIndex={i === pick ? 0 : -1}
              onClick={() => setPick(i)}
              className={`rounded-full border px-3.5 py-1.5 text-[13px] transition duration-200 active:scale-[0.97] pointer-coarse:min-h-11 ${
                i === pick ? "border-ink bg-ink text-paper" : "border-line bg-card/70 text-ink-2 hover:border-ink-2/40 hover:text-ink"
              }`}
            >
              {x.restaurant}
              <span className={i === pick ? "text-paper/70" : "text-muted"}> · {x.city}</span>
            </button>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label="Qloo taste data"
            onClick={() => setOn((v) => !v)}
            className="group inline-flex min-h-12 items-center gap-3 rounded-full border border-line bg-card py-2 pl-2 pr-5 shadow-[0_12px_30px_-22px_rgba(29,27,23,0.45)] transition hover:border-ink-2/40 active:scale-[0.98]"
          >
            <span className={`relative h-8 w-14 shrink-0 rounded-full transition-colors duration-300 ${on ? "bg-olive" : "bg-ink-2/30"}`}>
              <m.span
                aria-hidden
                initial={false}
                animate={{ x: on ? 24 : 0 }}
                transition={SPRING}
                className="absolute left-1 top-1 h-6 w-6 rounded-full bg-paper shadow-[0_2px_6px_rgba(29,27,23,0.25)]"
              />
            </span>
            <span className="text-[15px] font-medium text-ink">{on ? "Qloo is on" : "Qloo is off"}</span>
          </button>
          <span className="text-[13px] text-muted">{on ? "Switch it off: same model, no Qloo data." : "Switch it back on."}</span>
        </div>
      </Reveal>

      <Reveal delay={0.08} className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
        <div
          className={`rounded-2xl border p-5 shadow-[0_24px_50px_-34px_rgba(29,27,23,0.45)] transition-colors duration-500 sm:p-6 ${
            on ? "border-olive/30 bg-olive/[0.06]" : "border-line bg-paper-2/60"
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="grid min-w-0">
              <Fade show={on}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-olive">Tastecraft, grounded in Qloo</p>
              </Fade>
              <Fade show={!on}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Same model, no Qloo · one quick call</p>
              </Fade>
              <p className="col-start-1 row-start-2 mt-1 text-[13px] text-ink-2">
                {f.restaurant}, {f.city}
                {f.goal ? ` · ${f.goal}` : ""}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <div className="grid justify-items-end">
                <Fade show={on}>
                  <span className="font-display text-5xl leading-none tabular-nums text-olive">{liftLabel(f.with.score ?? 0)}</span>
                </Fade>
                <Fade show={!on}>
                  <span className="font-display text-5xl leading-none tabular-nums text-terracotta-ink">{liftLabel(f.without.score ?? 0)}</span>
                </Fade>
              </div>
              <p className="mt-1 text-[11px] text-muted">crowd lift, this run</p>
            </div>
          </div>

          <Meter score={score} on={on} />

          <div className="mt-5 grid">
            <Fade show={on}>
              <p className="text-[12px] font-medium text-muted">The agent’s read of the crowd, from Qloo</p>
              <p className="mt-1 text-[15px] leading-snug text-ink">“{f.headline}”</p>
              <DishList dishes={f.with.dishes} flip={f} />
            </Fade>
            <Fade show={!on}>
              <p className="text-[12px] font-medium text-muted">No Qloo data</p>
              <p className="mt-1 text-[15px] leading-snug text-ink-2">
                The same model answers from the cuisine and the goal, with no idea who actually eats here.
              </p>
              <DishList dishes={f.without.dishes} flip={f} />
            </Fade>
          </div>
          <p className="sr-only" aria-live="polite">
            {on ? `With Qloo: crowd lift ${liftLabel(f.with.score ?? 0)}.` : `Without Qloo: crowd lift ${liftLabel(f.without.score ?? 0)}.`}
          </p>
        </div>
      </Reveal>

      <Reveal className="lg:col-start-1 lg:row-start-2">
        <p className="max-w-md text-[12px] leading-snug text-muted">
          Both scores use the same crowd-lift formula on this run’s Qloo data. They are in-sample and not like-for-like: the agent saw the
          crowd-vs-city contrast it is scored on, and the no-Qloo answer is one quick, low-effort call. On restaurants the model never saw,
          the fair test measured {gainPct(HELD_OUT.ratio)} for Qloo over the same model alone ·{" "}
          <a href={HELD_OUT.url} target="_blank" rel="noopener noreferrer" className="underline decoration-line underline-offset-2 hover:text-ink">
            method
          </a>
        </p>

        <button
          type="button"
          onClick={() => onPlay(f.slug)}
          className="group mt-6 inline-flex min-h-11 items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-[14px] font-medium text-paper transition-colors duration-300 hover:bg-olive active:scale-[0.98]"
        >
          Watch this run in full
          <span className="text-paper/70">· 15 s replay</span>
          <IconArrow size={14} className="transition-transform duration-300 group-hover:translate-x-1" />
        </button>
      </Reveal>
    </section>
  );
}

/** Both states share one grid cell; the hidden one fades out and is hidden from assistive tech. */
function Fade({ show, children }: { show: boolean; children: React.ReactNode }) {
  return (
    <m.div
      aria-hidden={!show}
      initial={false}
      animate={{ opacity: show ? 1 : 0, y: show ? 0 : 6 }}
      transition={{ duration: 0.32, ease: EASE_OUT }}
      className={`col-start-1 row-start-1 min-w-0 ${show ? "" : "pointer-events-none select-none"}`}
    >
      {children}
    </m.div>
  );
}

function Meter({ score, on }: { score: number | null; on: boolean }) {
  const pct = meterPct(score);
  return (
    <div className="mt-6" aria-hidden>
      <div className="relative mb-1.5 h-4 text-[11px] font-medium text-ink-2">
        <span className="absolute -translate-x-1/2" style={{ left: `${CITY_PCT}%` }}>
          ×1
        </span>
      </div>
      <div className="relative h-2.5 rounded-full bg-ink/[0.07]">
        <m.div
          initial={false}
          animate={{ scaleX: pct / 100 }}
          transition={SPRING}
          className={`absolute inset-0 origin-left rounded-full transition-colors duration-300 ${on ? "bg-olive/45" : "bg-terracotta/35"}`}
        />
        <span className="absolute -top-1.5 h-[22px] w-px bg-ink-2/50" style={{ left: `${CITY_PCT}%` }} />
        <m.div initial={false} animate={{ x: `${pct}%` }} transition={SPRING} className="absolute inset-0">
          <span
            className={`absolute left-0 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full ring-4 transition-colors duration-300 ${
              on ? "bg-olive ring-olive/20" : "bg-terracotta ring-terracotta/20"
            }`}
          />
        </m.div>
      </div>
      <div className="mt-2 flex justify-between gap-4 text-[11px] leading-tight text-muted">
        <span className="max-w-[45%]">more common citywide</span>
        <span className="max-w-[45%] text-right">more common where your crowd eats</span>
      </div>
    </div>
  );
}

function DishList({ dishes, flip }: { dishes: FlipDish[]; flip: QlooFlip }) {
  return (
    <ul className="mt-4">
      {dishes.map((d) => (
        <li key={d.dish} className="flex items-start justify-between gap-3 border-t border-line/70 py-2.5">
          <div className="min-w-0">
            <p className="text-[15px] font-semibold leading-snug text-ink">{d.dish}</p>
            {d.why && <p className="mt-0.5 text-[13px] italic leading-snug text-ink-2">“{d.why}”</p>}
            <p className="mt-0.5 text-[12px] leading-snug text-muted">
              {d.term
                ? `${capitalize(d.term.term)}: on ${d.term.crowd} of ${flip.crowd_n} restaurants your guests love most vs ${d.term.city} of ${flip.city_n} of the city’s most popular`
                : "None of its food terms is on these menus"}
            </p>
          </div>
          <span className={`mt-0.5 shrink-0 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[12px] font-semibold tabular-nums ${liftTone(d.lift)}`}>
            {d.lift != null ? liftLabel(d.lift) : "n/a"}
            {d.low && <span className="font-normal text-muted"> · low count</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
