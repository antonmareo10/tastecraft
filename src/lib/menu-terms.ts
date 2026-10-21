// Which crowd-vs-city menu terms to SHOW. Display only: crowd lift (src/lib/lift.ts) and the terms the
// agent receives are computed exactly as before; this only decides which rows of an already-ranked
// list are readable as dishes or foods.
//
// rankTerms() indexes every 1-3 word run of Qloo's menu tags, so the ranked list can surface pieces
// of longer dish names: "Spicy salmon crispy" (from "Spicy salmon crispy rice"), "style tacos" (from
// "Baja style tacos"), "gem" (from "Little gem salad"), or a word already shown inside a longer
// listed dish ("sole" next to "Dover sole"). The rules are deterministic and work on the term text
// alone, so recorded runs and live runs are filtered the same way:
//
//   1. A term that ends in an English preparation/size/marketing word is a cut-off piece of a longer
//      name ("Spicy salmon crispy", "country cured", "Triple triple").
//   2. A term that starts with a word that only follows another one is the tail of a longer name
//      ("style tacos", "fired pizza", "Signature bakes").
//   3. Single words that are not a dish or a food on their own ("gem", "Grandma", "brew").
//   4. A term whose words all appear, in order, inside a longer term that is shown in the same
//      visible rows is folded into it ("sole" into "Dover sole", "onion" into "Onion rings"), but
//      only when the longer term has at least half its count: a strong generic term ("squash",
//      14 places) never disappears behind a weak specific one, nor behind one the reader cannot see.
//
// Format nouns (bowl, board, platter) are not in rule 1, so "Poke bowl" stays; Spanish and Italian
// adjectives follow the noun, so they are not in rule 1 either ("Patatas fritas" stays).

import { foodTokens, isLowCount } from "./lift";

type Term = { term: string; crowd?: number };

/**
 * The same terms with the low-count ones (on fewer than 5 menus in both sets, see lift.ts) moved
 * after the others, each group keeping its order. A term whose counts are unknown stays where it is
 * in the first group. Used before displayMenuTerms() so that a 4-vs-0 term is never the first thing
 * shown when better-supported terms exist.
 */
export function supportedFirst<T extends { term: string; crowd?: number; city?: number }>(terms: readonly T[]): T[] {
  const low = (t: T) => typeof t.crowd === "number" && typeof t.city === "number" && isLowCount({ crowd: t.crowd, city: t.city });
  return [...terms.filter((t) => !low(t)), ...terms.filter(low)];
}

const TRAILING = new Set(
  (
    "smoked grilled fried roasted baked braised charred spicy crispy crunchy loaded hot cold sweet sour slow " +
    "fired stuffed glazed crusted topped dusted cured pulled pickled toasted seared whole half " +
    "double triple mini small large big new fresh homemade style classic signature special daily weekly " +
    "seasonal chef iced warm chilled"
  ).split(" "),
);

const LEADING = new Set("style fired own hour signature".split(" "));

const NOT_FOOD_ALONE = new Set("gem grandma benedict brew double style own".split(" "));

const keysOf = (term: string) => foodTokens(term).map((t) => t.key);

/** True when a term is a piece of a longer dish name rather than a dish or food (rules 1-3). */
export function isMenuFragment(term: string): boolean {
  const keys = keysOf(term);
  if (keys.length === 0) return true;
  if (keys.length === 1) return NOT_FOOD_ALONE.has(keys[0]);
  return TRAILING.has(keys[keys.length - 1]) || LEADING.has(keys[0]);
}

const containsRun = (outer: string[], inner: string[]) => {
  for (let i = 0; i + inner.length <= outer.length; i++) {
    if (inner.every((k, j) => outer[i + j] === k)) return true;
  }
  return false;
};

/**
 * The first `limit` terms worth showing, in their original order: fragments dropped (rules 1-3),
 * then rule 4 within the visible rows. A folded term frees its row for the next one, so this
 * repeats until the visible rows are stable. `count` is the evidence that rule 4 weighs (the crowd
 * count for terms the crowd favours, the city count for terms it avoids); when it is unknown the
 * fold is allowed. Objects are returned untouched, so the counts and lifts on screen are exactly
 * the ones computed by lift.ts.
 */
export function displayMenuTerms<T extends Term>(
  terms: readonly T[],
  limit = Infinity,
  count: (t: T) => number | undefined = (t) => t.crowd,
): T[] {
  const kept = terms.filter((t) => !isMenuFragment(t.term));
  const keys = new Map(kept.map((t) => [t, keysOf(t.term)] as const));
  const folded = new Set<T>();
  const foldsInto = (t: T, o: T) => {
    const [a, b] = [keys.get(t)!, keys.get(o)!];
    if (o === t || b.length <= a.length || !containsRun(b, a)) return false;
    const [ct, co] = [count(t), count(o)];
    return ct == null || co == null || co >= ct / 2;
  };
  for (;;) {
    const visible = kept.filter((t) => !folded.has(t)).slice(0, limit);
    const fold = visible.filter((t) => visible.some((o) => foldsInto(t, o)));
    if (!fold.length) return visible;
    for (const t of fold) folded.add(t);
  }
}

const SUMMARY = /^Your crowd favours: (.+)$/;
const ITEM = /(.+?) ×(\d+(?:\.\d+)?)(?:, |$)/g;

/**
 * The agent log line for taste_gaps ("Your crowd favours: Poke bowl ×7.1, brews ×5.2, sole ×5.2"),
 * rebuilt from the top three shown terms (rule 4 within those three). With the full list
 * (`favours`) those come from it, better-supported terms first; without it (lensed calls), from
 * the line's own items.
 */
export function favoursSummary(summary: string, favours?: readonly { term: string; crowd?: number; city?: number; lift: number }[]): string {
  const m = SUMMARY.exec(summary);
  if (!m) return summary;
  const items = favours?.length
    ? displayMenuTerms(supportedFirst(favours), 3).map((t) => ({ term: t.term, x: t.lift.toFixed(1) }))
    : displayMenuTerms([...m[1].matchAll(ITEM)].map((x) => ({ term: x[1], x: x[2] })), 3);
  return items.length ? `Your crowd favours: ${items.map((t) => `${t.term} ×${t.x}`).join(", ")}` : summary;
}
