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
//   4. A term whose words all appear, in order, inside a longer term that is shown is folded into
//      it ("sole" into "Dover sole", "onion" into "Onion rings").
//
// Format nouns (bowl, board, platter) are not in rule 1, so "Poke bowl" stays; Spanish and Italian
// adjectives follow the noun, so they are not in rule 1 either ("Patatas fritas" stays).

import { foodTokens } from "./lift";

type Term = { term: string };

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
 * The terms worth showing, in their original order: fragments dropped (rules 1-3), then any term
 * contained in a longer shown term of the same list (rule 4). Objects are returned untouched, so
 * the counts and lifts on screen are the ones computed by lift.ts.
 */
export function displayMenuTerms<T extends Term>(terms: readonly T[]): T[] {
  const kept = terms.filter((t) => !isMenuFragment(t.term));
  const keys = kept.map((t) => keysOf(t.term));
  return kept.filter((_, i) => !keys.some((other, j) => j !== i && other.length > keys[i].length && containsRun(other, keys[i])));
}

const SUMMARY = /^Your crowd favours: (.+)$/;
const ITEM = /(.+?) ×(\d+(?:\.\d+)?)(?:, |$)/g;

/**
 * The agent log line for taste_gaps ("Your crowd favours: Poke bowl ×7.1, brews ×5.2, sole ×5.2"),
 * rebuilt from the shown terms. With the full list (`favours`) the top three shown terms are used;
 * without it, the line's own items are filtered.
 */
export function favoursSummary(summary: string, favours?: readonly { term: string; lift: number }[]): string {
  const m = SUMMARY.exec(summary);
  if (!m) return summary;
  const items = favours?.length
    ? displayMenuTerms(favours).map((t) => ({ term: t.term, x: t.lift.toFixed(1) }))
    : displayMenuTerms([...m[1].matchAll(ITEM)].map((x) => ({ term: x[1], x: x[2] })));
  return items.length ? `Your crowd favours: ${items.slice(0, 3).map((t) => `${t.term} ×${t.x}`).join(", ")}` : summary;
}
