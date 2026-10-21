// Held-out check of the benchmark's crowd-vs-city arm (eval/SUMMARY.md, "Held-out check").
//
//   npm run benchmark:holdout                (needs ANTHROPIC_API_KEY and QLOO_API_KEY)
//   npm run benchmark:holdout -- --rescore   no model calls: rescore the saved dishes with the current formula
//   npm run benchmark:holdout -- --summary   no calls at all: rewrite the summary block from the saved results
//
// In scripts/benchmark.ts the "+ Qloo crowd vs city" arm is shown the same crowd-vs-city contrast its
// dishes are then scored on. Here each restaurant's two Qloo sets (the crowd's ~150 favourite
// restaurants and the city's ~150 most popular) are split in two halves by a seeded hash of the Qloo
// entity id (scripts/holdout-split.ts), so a restaurant falls in the same half of both sets:
//   - the held-out arm is given the contrast computed on half A only;
//   - every arm's dishes are scored on half B only.
// The 10 local places the guests love, which both Qloo arms see by name, always go to half A, so no
// scored restaurant was named to the model. Arms, all fresh calls of the same model at the same effort
// as the app's no-Qloo answer, differing only in the Qloo data appended to its prompt:
//   llm_only          no Qloo data
//   qloo_affinity     dish/cuisine affinity tags and loved local places
//   contrast_all      the same plus the contrast on ALL places (the published arm; it has seen half B)
//   contrast_half_a   the same plus the contrast on half A only (held out from the scoring half)
// Five splits (seeds 1-5), one sample per arm per split.
//
// Writes eval/holdout.local.json (dish names and Qloo-derived counts: gitignored, never published) and
// the held-out block of eval/SUMMARY.md (aggregates only).

import fs from "node:fs";
import { baselinePrompt } from "../src/lib/agent";
import { parseBaselineDishes, planLift, type CrowdSets } from "../src/lib/lift";
import { entityId } from "../src/lib/qloo";
import { crowdAndCity, crowdContrast, findRestaurant, menuSets, resolveRestaurant } from "../src/lib/qloo-tasks";
import { MODEL, RESTAURANTS, affinityData, ask, contrastJson, groundedPrompt, usage } from "./bench-common";
import { bootstrapRatio, signTest, splitHalves } from "./holdout-split";

const SEEDS = [1, 2, 3, 4, 5];
const ARMS = ["llm_only", "qloo_affinity", "contrast_all", "contrast_half_a"] as const;
type ArmKey = (typeof ARMS)[number];
// Claude Opus 5.5 list prices per million tokens (October 2026), for the cost line only.
const PRICE = MODEL === "claude-opus-5-5" ? { input: 4, output: 20 } : null;

type Arm = { dishes: string[]; lift: number | null; matched: number };
type Split = {
  seed: number;
  a: { crowd: number; city: number }; // restaurants with menu data in half A
  b: { crowd: number; city: number }; // ... and in half B (the scoring half)
  terms_shown: number; // menu terms the held-out arm was shown (crowd favours + avoids, half A)
  arms: Record<ArmKey, Arm>;
};
type Row = { restaurant: string; city: string; kept_in_a: number; splits: Split[]; error?: string }; // kept_in_a: shown places found in the sets

const score = (dishes: string[], sets: CrowdSets): Arm => {
  const p = planLift(dishes, sets);
  return { dishes, lift: p.lift, matched: p.matched };
};

const localFile = new URL("../eval/holdout.local.json", import.meta.url);
const rescore = process.argv.includes("--rescore");
const summaryOnly = process.argv.includes("--summary");
type Saved = { ranAt: string; rescoredAt?: string; seeds: number[]; usage: typeof usage; rows: Row[] };
const previous = rescore || summaryOnly ? (JSON.parse(fs.readFileSync(localFile, "utf8")) as Saved) : null;
const ranAt = previous?.ranAt ?? new Date().toISOString();
if (previous) Object.assign(usage, previous.usage);

const rows: Row[] = summaryOnly && previous ? previous.rows : [];
const limit = Number(process.env.BENCH_LIMIT || RESTAURANTS.length); // smoke tests only; the published run uses all
const seeds = previous?.seeds ?? SEEDS.slice(0, Number(process.env.HOLDOUT_SPLITS || SEEDS.length));
for (const req of summaryOnly ? [] : RESTAURANTS.slice(0, limit)) {
  process.stdout.write(`${req.restaurant}, ${req.city} ... `);
  const row: Row = { restaurant: req.restaurant, city: req.city, kept_in_a: 0, splits: [] };
  const prev = previous?.rows.find((r) => r.restaurant === req.restaurant && r.city === req.city);
  if (previous && (!prev || prev.error)) {
    rows.push(prev ?? { ...row, error: "not in the previous run" });
    process.stdout.write("skipped (no saved dishes)\n");
    continue;
  }
  try {
    const { selected } = resolveRestaurant(req.restaurant, req.city, await findRestaurant(req.restaurant, req.city));
    if (!selected) throw new Error("not found in Qloo");
    const data = await crowdAndCity({ entityId: selected.entity_id, city: req.city });
    const aff = await affinityData(selected, req.city);
    const shown = new Set(aff.placeIds);
    row.kept_in_a = new Set([...data.crowd, ...data.city].map(entityId).filter((id) => shown.has(id))).size;
    const base = baselinePrompt(req);
    const all = contrastJson(crowdContrast(data, selected), req.city);

    for (const seed of seeds) {
      const { a, b } = splitHalves(data, seed, shown);
      const setsA = menuSets(a);
      const setsB = menuSets(b);
      if (!setsB.crowd.length || !setsB.city.length) throw new Error("no menu data in half B");
      const halfA = contrastJson(crowdContrast(a, selected), req.city);
      const saved = prev?.splits.find((s) => s.seed === seed);
      const dishes: Record<ArmKey, string[]> = saved
        ? (Object.fromEntries(ARMS.map((k) => [k, saved.arms[k].dishes])) as Record<ArmKey, string[]>)
        : (Object.fromEntries(
            await Promise.all(
              (
                [
                  ["llm_only", base],
                  ["qloo_affinity", groundedPrompt(base, aff.data)],
                  ["contrast_all", groundedPrompt(base, { ...aff.data, crowd_vs_city: all })],
                  ["contrast_half_a", groundedPrompt(base, { ...aff.data, crowd_vs_city: halfA })],
                ] as const
              ).map(async ([k, prompt]) => [k, parseBaselineDishes(await ask(prompt))]),
            ),
          ) as Record<ArmKey, string[]>);
      row.splits.push({
        seed,
        a: { crowd: setsA.crowd.length, city: setsA.city.length },
        b: { crowd: setsB.crowd.length, city: setsB.city.length },
        terms_shown: halfA.menu_terms_crowd_favours.length + halfA.menu_terms_crowd_avoids.length,
        arms: Object.fromEntries(ARMS.map((k) => [k, score(dishes[k], setsB)])) as Record<ArmKey, Arm>,
      });
    }
    process.stdout.write(
      ARMS.map((k) => `${k} ${row.splits.map((s) => s.arms[k].lift ?? "n/a").join("/")}`).join(" · ") + "\n",
    );
  } catch (err) {
    row.error = err instanceof Error ? err.message : String(err);
    process.stdout.write(`ERROR ${row.error}\n`);
  }
  rows.push(row);
}

const rescoredAt = rescore ? new Date().toISOString() : previous?.rescoredAt;
if (!summaryOnly) fs.writeFileSync(localFile, JSON.stringify({ model: MODEL, ranAt, rescoredAt, seeds, usage, rows }, null, 1));

// ---- Summary block (aggregates only) --------------------------------------------------------------
const geo = (xs: number[]) => (xs.length ? Math.exp(xs.reduce((s, x) => s + Math.log(x), 0) / xs.length) : NaN);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};
const f = (x: number | null | undefined) => (x == null || Number.isNaN(x) ? "n/a" : `×${x.toFixed(2)}`);
const p2 = (p: number) => (p < 0.001 ? "< 0.001" : p.toFixed(3));

const ok = rows.filter((r) => !r.error && r.splits.length);
/** A restaurant's score for an arm: geometric mean over its splits (splits where no dish matched are left out). */
const perRestaurant = (r: Row, k: ArmKey) => {
  const xs = r.splits.map((s) => s.arms[k].lift).filter((x): x is number => x != null);
  return xs.length ? geo(xs) : null;
};
const lifts = (k: ArmKey) => ok.map((r) => perRestaurant(r, k)).filter((x): x is number => x != null);
const versus = (k: ArmKey, than: ArmKey) => {
  let wins = 0;
  let losses = 0;
  for (const r of ok) {
    const x = perRestaurant(r, k);
    const y = perRestaurant(r, than);
    if (x == null || y == null || x === y) continue;
    if (x > y) wins += 1;
    else losses += 1;
  }
  return { wins, losses, p: signTest(wins, losses) };
};
const matched = (k: ArmKey) => ok.reduce((s, r) => s + r.splits.reduce((t, sp) => t + sp.arms[k].matched, 0), 0);
const plans = ok.reduce((s, r) => s + r.splits.length, 0);
const meanOf = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : 0);
const sizes = (r: Row) => `${meanOf(r.splits.map((s) => s.b.crowd))} / ${meanOf(r.splits.map((s) => s.b.city))}`;
const cost = PRICE ? (usage.input * PRICE.input + usage.output * PRICE.output) / 1e6 : null;

const planWins = (k: ArmKey, than: ArmKey) =>
  ok.reduce((n, r) => n + r.splits.filter((sp) => (sp.arms[k].lift ?? 0) > (sp.arms[than].lift ?? 0)).length, 0);
/** Per-restaurant ratio of two arms (geometric mean over restaurants) with a 95% bootstrap interval over restaurants. */
const ratio = (k: ArmKey, than: ArmKey) => {
  const logs = ok
    .map((r) => [perRestaurant(r, k), perRestaurant(r, than)] as const)
    .filter((xy): xy is readonly [number, number] => xy[0] != null && xy[1] != null)
    .map(([x, y]) => Math.log(x) - Math.log(y));
  return bootstrapRatio(logs);
};
const ci = (r: { ratio: number; low: number; high: number }) => `${f(r.ratio)} (95% interval ${f(r.low)} to ${f(r.high)})`;

const held = versus("contrast_half_a", "llm_only");
const allVsHeld = versus("contrast_all", "contrast_half_a");
const rHeld = ratio("contrast_half_a", "llm_only");
const rHeldAff = ratio("contrast_half_a", "qloo_affinity");
const rAll = ratio("contrast_all", "contrast_half_a");
const g = Object.fromEntries(ARMS.map((k) => [k, geo(lifts(k))])) as Record<ArmKey, number>;
const others = ["qloo_affinity", "contrast_all", "contrast_half_a"] as const;

const table = ok
  .map((r) => `| ${r.restaurant}, ${r.city} | ${sizes(r)} | ${ARMS.map((k) => f(perRestaurant(r, k))).join(" | ")} |`)
  .join("\n");

const block = `<!-- holdout:start (generated by scripts/benchmark-holdout.ts) -->
## Held-out check: does the crowd-vs-city gain survive on restaurants the model never saw?

The "+ Qloo crowd vs city" arm above is shown the same Qloo contrast its dishes are then scored on, so its result is partly circular. \`npm run benchmark:holdout\` (scripts/benchmark-holdout.ts, run on ${ranAt.slice(0, 10)}${rescoredAt ? `, rescored on ${rescoredAt.slice(0, 10)}` : ""}) measures how much of the gain survives without that overlap. Each restaurant's crowd and city sets are split in two halves by a seeded hash of the Qloo entity id, so a restaurant falls in the same half of both sets. The held-out arm is given the contrast computed on half A only, and every arm's dishes are scored on half B only, with the same crowd-lift formula. The local places the guests love, which both Qloo arms see by name, are always kept in half A, so no scored restaurant was named to the model. ${seeds.length} splits (seeds ${seeds.join(", ")}) with one fresh sample per arm per split: ${usage.calls} calls of the same model (\`${MODEL}\`) at the same effort as above, ${usage.input} input and ${usage.output} output tokens${cost != null ? ` (about US$${cost.toFixed(2)} at list prices)` : ""}. ${ok.length} of ${rows.length} restaurants completed${rows.length - ok.length ? ` (${rows.filter((r) => r.error).map((r) => `${r.restaurant}: ${r.error}`).join("; ")})` : ""}.

| Restaurant | Half B: crowd / city restaurants with menu data | LLM only | + Qloo affinity | + crowd vs city, all places (has seen half B) | + crowd vs city, half A only (held out) |
|---|---|---|---|---|---|
${table}

(each cell: geometric mean over the ${seeds.length} splits of the plan's crowd lift on half B)

| Aggregate over ${ok.length} restaurants, scored on half B | LLM only | + Qloo affinity | + crowd vs city, all places | + crowd vs city, half A only |
|---|---|---|---|---|
| Geometric mean crowd lift | ${ARMS.map((k) => f(g[k])).join(" | ")} |
| Median crowd lift | ${ARMS.map((k) => f(median(lifts(k)))).join(" | ")} |
| Ratio to LLM only, per restaurant (95% bootstrap interval over restaurants) | — | ${others.map((k) => { const r = ratio(k, "llm_only"); return `${f(r.ratio)} (${f(r.low)}–${f(r.high)})`; }).join(" | ")} |
| Restaurants where it beats LLM only | — | ${others.map((k) => `${versus(k, "llm_only").wins} / ${ok.length}`).join(" | ")} |
| Plans where it beats LLM only | — | ${others.map((k) => `${planWins(k, "llm_only")} / ${plans}`).join(" | ")} |
| Dishes matched on local menus | ${ARMS.map((k) => `${matched(k)} / ${plans * 3}`).join(" | ")} |

**Reading.** ${
  rHeld.low > 1
    ? "On restaurants it was not shown, the contrast still moves the model's dishes towards what this crowd's favourite places serve, but by much less than the in-sample result above suggests."
    : "On restaurants it was not shown, the contrast's effect cannot be told apart from noise."
} The held-out arm scores ${f(g.contrast_half_a)} on half B against ${f(g.llm_only)} for the same model with no Qloo data: per restaurant, ${ci(rHeld)}. It beats LLM only in ${held.wins} of ${held.wins + held.losses} restaurants (exact two-sided sign test p = ${p2(held.p)}, little power with ${ok.length}) and in ${planWins("contrast_half_a", "llm_only")} of ${plans} plans. Against Qloo affinity data alone (${f(g.qloo_affinity)}) the ratio is ${ci(rHeldAff)}${rHeldAff.low <= 1 && rHeldAff.high >= 1 ? ", which this sample cannot tell apart from no difference" : ""}. The arm that saw all places scores ${f(g.contrast_all)} on the same half B and beats the held-out arm in ${allVsHeld.wins} of ${allVsHeld.wins + allVsHeld.losses} restaurants, ${ci(rAll)}: that gap is what seeing the scored places, and a contrast built on twice as many restaurants, adds, and it is why the in-sample result above overstates what the contrast is worth on restaurants the model has not seen.

Limits of this check: half-size sets make each term count noisier; one sample per arm per split; the intervals are over these ${ok.length} restaurants and say nothing about other cities or kinds of restaurant; and both halves come from the same city and the same Qloo audience signal, so this tests whether the contrast carries over to other restaurants this crowd loves, not whether guests would order the dishes.
<!-- holdout:end -->`;

const summaryFile = new URL("../eval/SUMMARY.md", import.meta.url);
const summary = fs.readFileSync(summaryFile, "utf8");
const marked = /<!-- holdout:start[\s\S]*?<!-- holdout:end -->/;
const anchor = "\n## Why the old Taste-Fit score could not tell plans apart";
fs.writeFileSync(
  summaryFile,
  marked.test(summary) ? summary.replace(marked, block) : summary.includes(anchor) ? summary.replace(anchor, `\n${block}\n${anchor}`) : `${summary}\n${block}\n`,
);
console.log(
  `\nWrote the held-out block of eval/SUMMARY.md. Model calls: ${usage.calls} (${usage.input} in / ${usage.output} out${cost != null ? `, about US$${cost.toFixed(2)}` : ""}).`,
);
console.log(ARMS.map((k) => `${k}: ${f(g[k])}`).join(" · "));
