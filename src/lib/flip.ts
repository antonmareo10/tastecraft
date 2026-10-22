// The home page's "switch Qloo off" card. For each recorded run it keeps the three dishes the same
// model suggests with no Qloo data (one quick call) and the three the agent proposes with Qloo, both
// scored with the crowd lift the server computed in that run. Pure, so it is tested on synthetic events.
import { dishLowCount, parseBaselineLines, type TermLift } from "./lift";
import type { AgentEvent } from "./types";

export type FlipDish = {
  dish: string;
  lift: number | null;
  low: boolean; // the lift leans on a term found on fewer than LOW_COUNT_MENUS menus
  term: TermLift | null; // the food term that explains the score, with its menu counts
  why?: string; // no-Qloo side only: the reason the model gave for the dish, verbatim
};

export type FlipSide = { score: number | null; dishes: FlipDish[] };

export type QlooFlip = {
  slug: string;
  restaurant: string;
  city: string;
  goal?: string;
  recordedAt: string;
  crowd_n: number; // restaurants with menu data that this crowd loves most
  city_n: number; // the city's most popular restaurants with menu data
  headline: string; // the agent's one-line read of the crowd
  without: FlipSide;
  with: FlipSide;
};

type Run = { slug: string; restaurant: string; city: string; goal?: string; recordedAt: string; events: readonly AgentEvent[] };
type ScoredDish = { dish: string; lift?: number | null; terms?: readonly TermLift[]; why?: string };

/** The term behind a dish's score: its strongest pull when the crowd favours the dish, its weakest otherwise. */
export function keyTerm(terms: readonly TermLift[] | undefined, lift: number | null): TermLift | null {
  if (!terms?.length || lift == null) return null;
  const up = lift >= 1;
  return [...terms].sort((a, b) => (up ? b.lift - a.lift : a.lift - b.lift) || b.crowd + b.city - (a.crowd + a.city))[0];
}

const side = (score: number | null, dishes: ScoredDish[]): FlipSide => ({
  score,
  dishes: dishes.map(({ dish, lift = null, terms, why }) => ({
    dish,
    lift,
    low: lift != null && dishLowCount(terms),
    term: keyTerm(terms, lift),
    ...(why ? { why } : {}),
  })),
});

/** null when the run has no playbook, no crowd lift, or no scored no-Qloo answer to set against it. */
export function flipOf(run: Run): QlooFlip | null {
  const event = run.events.find((e) => e.type === "playbook") as Extract<AgentEvent, { type: "playbook" }> | undefined;
  const p = event?.playbook;
  const cl = p?.crowd_lift;
  const base = cl?.baseline;
  if (!p || !cl || cl.score == null || !base || base.score == null || !base.dishes.length || !p.menu_moves.length) return null;
  const baselineText = (run.events.find((e) => e.type === "baseline") as Extract<AgentEvent, { type: "baseline" }> | undefined)?.text ?? "";
  const reasons = parseBaselineLines(baselineText);
  const reasonFor = (dish: string, i: number) => (reasons.find((r) => r.dish === dish) ?? reasons[i])?.why || undefined;
  return {
    slug: run.slug,
    restaurant: run.restaurant,
    city: run.city,
    goal: run.goal,
    recordedAt: run.recordedAt,
    crowd_n: cl.crowd_n,
    city_n: cl.city_n,
    headline: p.headline,
    without: side(
      base.score,
      base.dishes.map((d, i) => ({ ...d, why: reasonFor(d.dish, i) })),
    ),
    with: side(
      cl.score,
      p.menu_moves.map((mv) => ({ dish: mv.dish, lift: mv.lift, terms: mv.lift_terms })),
    ),
  };
}

/** Runs whose two answers differ most come first (ratio of the two crowd lifts). */
export function byContrast(a: QlooFlip, b: QlooFlip): number {
  const ratio = (f: QlooFlip) => (f.with.score ?? 0) / Math.max(0.01, f.without.score ?? 1);
  return ratio(b) - ratio(a);
}
