// Crowd lift: does THIS restaurant's crowd favour a dish more than the city at large?
//
// Why not just Qloo affinity? Tag affinities for a restaurant's audience are percentile-like and
// dominated by what is popular everywhere (fries and tiramisu score ~99 for almost any audience),
// so a mean affinity is ~96-100 for every plan and does not tell plans apart. Crowd lift compares
// the restaurant's audience against a baseline instead:
//
//   crowd set = the ~150 restaurants in the city this restaurant's audience has the highest
//               Qloo affinity for (signal.interests.entities = the restaurant)
//   city set  = the city's ~150 most popular restaurants (same query, no audience signal)
//
// A food term (e.g. "pastrami") is "on the menu" of a place when one of the place's Qloo menu tags
// (specialty dishes, menu highlights) contains it. Its lift is the share of crowd places serving
// it divided by the share of city places serving it, add-one smoothed so that a term seen in
// neither set scores x1.0 rather than infinity. A dish is split into the food terms that local
// menus actually use (a multi-word term must appear on at least 3 local menus, otherwise its
// words are used); its lift is the geometric mean of its terms. A plan's lift is the geometric
// mean over the dishes that matched at least one term.
//
// Everything is computed from Qloo data on the server; the model never writes these numbers.
// This module is pure (no I/O) so the app and scripts/benchmark.mjs share the exact same formula.

export type MenuPlace = { name: string; menu: string[] }; // menu = names of the place's menu tags
export type CrowdSets = { crowd: MenuPlace[]; city: MenuPlace[] };

export type TermLift = {
  term: string; // as written in the dish name (or in a local menu tag)
  crowd: number; // crowd places whose menu mentions the term
  city: number; // city places whose menu mentions the term
  lift: number;
};
export type DishLift = { dish: string; terms: TermLift[]; lift: number | null };
export type PlanLift = {
  lift: number | null; // geometric mean over matched dishes, 2 decimals; null if no dish matched
  dishes: DishLift[];
  matched: number;
  total: number;
  crowd_n: number; // crowd places with menu data
  city_n: number; // city places with menu data
};

const STOP = new Set(
  (
    "a an the and or with of on in for to our your w n " + // en
    "y e o u de del la las el los al con en un una su sus para por sin " + // es
    "da di della delle alla alle il lo le " + // it
    "du des au aux et les" // fr
  ).split(" "),
);

// Words that never stand alone as a food term: preparation, size, format, colour and marketing words.
// They still count inside a longer term ("fried chicken", "black cod").
const NOT_A_DISH = new Set(
  (
    "board platter plate bowl cup flight side combo set special daily house seasonal signature classic " +
    "mini small large big new fresh homemade style chef weekly night late brunch breakfast lunch dinner " +
    "build own happy hour craft double triple " +
    "smoked grilled fried roasted baked braised charred spicy crispy loaded hot cold sweet sour slow " +
    "wood fired stuffed glazed crusted topped dusted whole half square round black white red green golden local " +
    "warm chilled iced autumn fall winter summer spring holiday festive " +
    "casero casera temporada especial plato tabla brasa plancha frito frita picante crujiente " +
    "otono invierno verano primavera caliente templado " +
    "negro rojo verde blanco"
  ).split(" "),
);

const MAX_GRAM = 3;
// A phrase seen on one or two menus is too rare to measure ("fried mozzarella sticks" 1 vs 0),
// so multi-word terms need this many menus across both sets before they beat their own words.
export const MIN_PHRASE_MENUS = 3;
const ch = (code: number) => String.fromCharCode(code);
const range = (from: number, to: number) => `${ch(from)}-${ch(to)}`;
// Latin letters incl. accented ones (Latin-1 Supplement + Latin Extended-A/B), digits.
const WORD = new RegExp(`[A-Za-z0-9${range(0xc0, 0xd6)}${range(0xd8, 0xf6)}${range(0xf8, 0x24f)}]+`, "g");
const COMBINING = new RegExp(`[${range(0x300, 0x36f)}]`, "g");
const DASHES = `${ch(0x2013)}${ch(0x2014)}`; // en dash, em dash

type Tok = { key: string; start: number; end: number };

// Light plural folding so "sandwiches"/"sandwich" and "tacos"/"taco" meet. The same rule runs on
// dish names and menu tags, so an imperfect stem still compares like with like.
export function stem(word: string): string {
  if (word.length <= 3 || word.endsWith("ss")) return word;
  if (/(ch|sh|x|z|ss)es$/.test(word)) return word.slice(0, -2);
  return word.endsWith("s") ? word.slice(0, -1) : word;
}

/** Content tokens of a name: accents folded, lower-cased, stopwords dropped, plurals folded. Positions refer to text.normalize("NFC"). */
export function foodTokens(text: string): Tok[] {
  const out: Tok[] = [];
  const nfc = text.normalize("NFC");
  for (const m of nfc.matchAll(WORD)) {
    const word = m[0].normalize("NFD").replace(COMBINING, "").toLowerCase();
    if (!word || STOP.has(word) || /^\d+$/.test(word)) continue;
    const start = m.index ?? 0;
    out.push({ key: stem(word), start, end: start + m[0].length });
  }
  return out;
}

const HEAD_CUT = new RegExp(`\\s+(?:with|w/|con|served|topped|over|plus)\\s+|[:(,;|+${DASHES}]|\\s-\\s`, "i");

/** The core of a dish name: what comes before garnish/description separators ("X with Y", "X: Y", "X — Y"). */
export function dishHead(dish: string): string {
  const head = dish.split(HEAD_CUT)[0] ?? "";
  return foodTokens(head).length ? head.trim() : dish;
}

/** term key -> { places whose menu mentions it, a readable label as first seen on a menu }. */
export function indexMenus(places: MenuPlace[]): Map<string, { count: number; label: string }> {
  const index = new Map<string, { count: number; label: string }>();
  for (const p of places) {
    const seen = new Map<string, string>();
    for (const tag of p.menu) {
      const nfc = tag.normalize("NFC");
      const toks = foodTokens(nfc);
      for (let n = 1; n <= MAX_GRAM; n++) {
        for (let i = 0; i + n <= toks.length; i++) {
          const key = toks
            .slice(i, i + n)
            .map((t) => t.key)
            .join(" ");
          if (!seen.has(key)) seen.set(key, nfc.slice(toks[i].start, toks[i + n - 1].end));
        }
      }
    }
    for (const [key, label] of seen) {
      const cur = index.get(key);
      if (cur) cur.count += 1;
      else index.set(key, { count: 1, label });
    }
  }
  return index;
}

// Below this many menus (crowd and city counts together) a term's lift rests on a handful of
// restaurants: 4 vs 0 already reads about x4.8 after smoothing. The UI keeps such numbers but marks
// them "low count" and never leads with them. The score itself is unchanged.
export const LOW_COUNT_MENUS = 5;

/** "×1.8": crowd lift with one decimal, as every screen prints it. */
export function liftLabel(v: number): string {
  return `×${(Math.round(v * 10) / 10).toFixed(1)}`;
}

/** True when a term's lift rests on fewer than LOW_COUNT_MENUS menus in both sets together. */
export function isLowCount(t: { crowd: number; city: number }): boolean {
  return t.crowd + t.city < LOW_COUNT_MENUS;
}

/** True when any matched term of a dish is low count (so the dish's lift leans on a few menus). */
export function dishLowCount(terms: readonly { crowd: number; city: number }[] | undefined): boolean {
  return Boolean(terms?.some(isLowCount));
}

/** Add-one smoothed ratio of shares: (a+1)/(nA+2) divided by (b+1)/(nB+2). 1 = no difference. */
export function smoothedLift(a: number, nA: number, b: number, nB: number): number {
  if (nA <= 0 || nB <= 0) return 1;
  return (a + 1) / (nA + 2) / ((b + 1) / (nB + 2));
}

/**
 * The food terms of a dish that local menus actually use: longest-first, non-overlapping n-grams
 * (up to 3 words) of the dish head. `menus(key)` is how many local menus (both sets) mention the
 * term: a single word needs one, a phrase needs MIN_PHRASE_MENUS. Single words in NOT_A_DISH are
 * skipped, and so is any n-gram made only of such words.
 */
export function dishTerms(dish: string, menus: (key: string) => number): { key: string; label: string }[] {
  const head = dishHead(dish).normalize("NFC");
  const toks = foodTokens(head);
  const used = new Array<boolean>(toks.length).fill(false);
  const picked: { key: string; label: string; at: number }[] = [];
  for (let n = Math.min(MAX_GRAM, toks.length); n >= 1; n--) {
    for (let i = 0; i + n <= toks.length; i++) {
      if (used.slice(i, i + n).some(Boolean)) continue;
      const span = toks.slice(i, i + n);
      if (span.every((t) => NOT_A_DISH.has(t.key))) continue;
      const key = span.map((t) => t.key).join(" ");
      if (menus(key) < (n > 1 ? MIN_PHRASE_MENUS : 1)) continue;
      for (let k = i; k < i + n; k++) used[k] = true;
      picked.push({ key, label: head.slice(span[0].start, span[span.length - 1].end), at: i });
    }
  }
  return picked.sort((x, y) => x.at - y.at).map(({ key, label }) => ({ key, label }));
}

const geoMean = (xs: number[]) => Math.exp(xs.reduce((s, x) => s + Math.log(x), 0) / xs.length);
const round2 = (x: number) => Math.round(x * 100) / 100;

/** The terms of both names, each term once (the dish's own name first). */
function mergeTerms(a: { key: string; label: string }[], b: { key: string; label: string }[]): { key: string; label: string }[] {
  const seen = new Set(a.map((t) => t.key));
  return [...a, ...b.filter((t) => !seen.has(t.key) && seen.add(t.key))];
}

/**
 * Crowd lift of every dish and of the plan, from the two Qloo restaurant sets. `alts` holds, per
 * dish, its English name for a playbook written in another language: Qloo's menu tags are mostly
 * English ("skewer", not "brocheta"), so a dish is matched on the terms of both names, each once.
 */
export function planLift(dishes: string[], sets: CrowdSets, alts: readonly (string | undefined)[] = []): PlanLift {
  const crowdIdx = indexMenus(sets.crowd);
  const cityIdx = indexMenus(sets.city);
  const nA = sets.crowd.length;
  const nB = sets.city.length;
  const menus = (k: string) => (crowdIdx.get(k)?.count ?? 0) + (cityIdx.get(k)?.count ?? 0);
  const out: DishLift[] = dishes.map((dish, i) => {
    const alt = alts[i]?.trim();
    const own = dishTerms(dish, menus);
    const picked = alt && alt !== dish ? mergeTerms(own, dishTerms(alt, menus)) : own;
    const terms = picked.map(({ key, label }) => {
      const a = crowdIdx.get(key)?.count ?? 0;
      const b = cityIdx.get(key)?.count ?? 0;
      return { term: label, crowd: a, city: b, lift: round2(smoothedLift(a, nA, b, nB)) };
    });
    const lift = terms.length ? round2(geoMean(terms.map((t) => smoothedLift(t.crowd, nA, t.city, nB)))) : null;
    return { dish, terms, lift };
  });
  const matched = out.filter((d) => d.lift != null);
  return {
    lift: matched.length ? round2(geoMean(matched.map((d) => d.lift as number))) : null,
    dishes: out,
    matched: matched.length,
    total: dishes.length,
    crowd_n: nA,
    city_n: nB,
  };
}

/** The playbook's crowd-lift block: the plan's dishes and, when given, the no-Qloo baseline's, on the same sets. */
export function crowdLiftOf(
  dishes: string[],
  sets: CrowdSets,
  city: string,
  baselineDishes: string[] = [],
  alts: readonly (string | undefined)[] = [],
  baselineAlts: readonly (string | undefined)[] = [],
) {
  const plan = planLift(dishes, sets, alts);
  const baseline = baselineDishes.length ? planLift(baselineDishes, sets, baselineAlts) : null;
  return {
    perDish: plan.dishes,
    summary: {
      score: plan.lift,
      matched: plan.matched,
      total: plan.total,
      crowd_n: plan.crowd_n,
      city_n: plan.city_n,
      city,
      ...(baseline
        ? {
            baseline: {
              score: baseline.lift,
              matched: baseline.matched,
              total: baseline.total,
              dishes: baseline.dishes.map((d) => ({ dish: d.dish, lift: d.lift, terms: d.terms })),
            },
          }
        : {}),
    },
  };
}

/**
 * The food terms on local menus that most separate the crowd from the city, for the agent:
 * `over` = served far more often by the crowd's favourite restaurants, `under` = far less often.
 * A term must be on at least `minCount` menus on its side, and a term that only repeats a longer
 * term's count (e.g. "stick" inside "mozzarella stick") is dropped.
 */
export function rankTerms(
  sets: CrowdSets,
  opts: { minCount?: number; limit?: number; own?: string[] } = {},
): { over: (TermLift & { on_your_menu: boolean })[]; under: TermLift[] } {
  const minCount = opts.minCount ?? 4;
  const limit = opts.limit ?? 12;
  const crowdIdx = indexMenus(sets.crowd);
  const cityIdx = indexMenus(sets.city);
  const own = indexMenus([{ name: "own", menu: opts.own ?? [] }]);
  const nA = sets.crowd.length;
  const nB = sets.city.length;
  const rows = [...new Set([...crowdIdx.keys(), ...cityIdx.keys()])]
    .filter((key) => !(key.split(" ").length === 1 && NOT_A_DISH.has(key)))
    .map((key) => {
      const a = crowdIdx.get(key)?.count ?? 0;
      const b = cityIdx.get(key)?.count ?? 0;
      const label = crowdIdx.get(key)?.label ?? cityIdx.get(key)?.label ?? key;
      return { key, term: label, crowd: a, city: b, lift: round2(smoothedLift(a, nA, b, nB)) };
    });
  const subsumed = (r: (typeof rows)[number], side: "crowd" | "city") =>
    rows.some((o) => o.key !== r.key && o[side] === r[side] && ` ${o.key} `.includes(` ${r.key} `));
  const over = rows
    .filter((r) => r.crowd >= minCount && r.lift > 1 && !subsumed(r, "crowd"))
    .sort((x, y) => y.lift - x.lift || y.crowd - x.crowd)
    .slice(0, limit)
    .map(({ term, crowd, city, lift, key }) => ({ term, crowd, city, lift, on_your_menu: own.has(key) }));
  const under = rows
    .filter((r) => r.city >= minCount + 2 && r.lift < 1 && !subsumed(r, "city"))
    .sort((x, y) => x.lift - y.lift || y.city - x.city)
    .slice(0, Math.ceil(limit / 2))
    .map(({ term, crowd, city, lift }) => ({ term, crowd, city, lift }));
  return { over, under };
}

const BASELINE_LINE = new RegExp(`^\\s*(?:[-*${ch(0x2022)}]\\s*)?(?:\\*\\*)?(?:dish|plato)\\s*\\d\\s*(?:\\*\\*)?\\s*[:.)${DASHES}-]\\s*(.+)$`, "i");
const BASELINE_SPLIT = new RegExp(`\\s+\\|\\s+|\\s+[${DASHES}]\\s+|\\s+-\\s+`);
const DECOR = new RegExp(`[*_"${ch(0x201c)}${ch(0x201d)}]`, "g");

/** The generic baseline's dishes with the one-line reason the model gave for each ("Dish 1: <name> | <why>"). */
export function parseBaselineLines(text: string): { dish: string; why: string }[] {
  const out: { dish: string; why: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = BASELINE_LINE.exec(line);
    if (!m) continue;
    const sep = BASELINE_SPLIT.exec(m[1]);
    const dish = (sep ? m[1].slice(0, sep.index) : m[1]).replace(DECOR, "").trim();
    const why = sep ? m[1].slice(sep.index + sep[0].length).replace(DECOR, "").trim() : "";
    if (dish) out.push({ dish, why });
  }
  return out.slice(0, 3);
}

const GLOSS = /^(.*?\S)\s*\(([^()]+)\)$/;

/**
 * A baseline dish written as "<name> (<English name>)", the format the baseline is asked for when the
 * playbook is not in English: { dish: "Cachopo para compartir", en: "Sharing cachopo" }. Without a
 * trailing parenthesis the name is returned as it is.
 */
export function splitGloss(name: string): { dish: string; en?: string } {
  const m = GLOSS.exec(name.trim());
  return m ? { dish: m[1].trim(), en: m[2].trim() } : { dish: name.trim() };
}

/** Pulls the three dish names out of the generic baseline ("Dish 1: <name> | <why>"). */
export function parseBaselineDishes(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = BASELINE_LINE.exec(line);
    if (!m) continue;
    const name = m[1].split(BASELINE_SPLIT)[0].replace(DECOR, "").trim();
    if (name) out.push(name);
  }
  return out.slice(0, 3);
}
