// Held-out check of the benchmark's crowd-vs-city arm (eval/SUMMARY.md, "Held-out check").
//
//   npm run benchmark:holdout                (needs ANTHROPIC_API_KEY and QLOO_API_KEY)
//   npm run benchmark:holdout -- --rescore   no model calls: rescore the saved dishes with the current formula
//   npm run benchmark:holdout -- --summary   no calls at all: rewrite the summary block from the saved results
//
//   npm run eval:heldout                     the pre-registered 30-restaurant run (eval/PREREGISTRATION_30.md):
//                                            the 22 new restaurants of eval/heldout30.restaurants.json first, then
//                                            the original 8; writes eval/holdout30.local.json and eval/HELDOUT_30.md.
//                                            It resumes: restaurants already completed in the local file are kept
//                                            (delete the file to start over). Add `-- --summary` to rewrite the
//                                            report from the saved results without any call.
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

import "./load-env";
import { execSync } from "node:child_process";
import fs from "node:fs";
import { baselinePrompt } from "../src/lib/agent";
import { parseBaselineDishes, planLift, type CrowdSets } from "../src/lib/lift";
import { entityId } from "../src/lib/qloo";
import { crowdAndCity, crowdContrast, findRestaurant, menuSets, resolveRestaurant } from "../src/lib/qloo-tasks";
import type { AgentRequest } from "../src/lib/types";
import { MODEL, NEW_RESTAURANTS, RESTAURANTS, affinityData, ask, contrastJson, groundedPrompt, usage } from "./bench-common";
import { bootstrapRatio, signTest, splitHalves, verdict } from "./holdout-split";

const SEEDS = [1, 2, 3, 4, 5];
const ARMS = ["llm_only", "qloo_affinity", "contrast_all", "contrast_half_a"] as const;
type ArmKey = (typeof ARMS)[number];
// Claude Opus 5.5 list prices per million tokens (October 2026), for the cost line only.
const PRICE = MODEL === "claude-opus-5-5" ? { input: 4, output: 20 } : null;

// The pre-registered 30-restaurant run: the 22 new restaurants first, then the original 8. Before any
// model call each restaurant is checked against the pre-registered exclusion rules.
const EVAL30 = process.argv.includes("--eval30");
const MIN_MENU_PLACES = 40; // excluded when either full set has fewer restaurants with menu data than this

type Group = "new" | "original";
type Req = AgentRequest & { group?: Group };
const LIST: Req[] = EVAL30
  ? [...NEW_RESTAURANTS.map((r) => ({ ...r, group: "new" as const })), ...RESTAURANTS.map((r) => ({ ...r, group: "original" as const }))]
  : RESTAURANTS;

type Arm = { dishes: string[]; lift: number | null; matched: number };
type Split = {
  seed: number;
  a: { crowd: number; city: number }; // restaurants with menu data in half A
  b: { crowd: number; city: number }; // ... and in half B (the scoring half)
  terms_shown: number; // menu terms the held-out arm was shown (crowd favours + avoids, half A)
  arms: Record<ArmKey, Arm>;
};
type Row = {
  restaurant: string;
  city: string;
  group?: Group;
  match?: string; // the app's resolver: exact, close or best_guess name match
  full?: { crowd: number; city: number }; // restaurants with menu data in the full sets
  kept_in_a: number; // shown places found in the sets
  splits: Split[];
  excluded?: string; // a pre-registered exclusion rule, applied before any model call (--eval30)
  error?: string;
};

/** A pre-registered exclusion, decided before any model call. */
class Excluded extends Error {}

const score = (dishes: string[], sets: CrowdSets): Arm => {
  const p = planLift(dishes, sets);
  return { dishes, lift: p.lift, matched: p.matched };
};

const localFile = new URL(EVAL30 ? "../eval/holdout30.local.json" : "../eval/holdout.local.json", import.meta.url);
const rescore = process.argv.includes("--rescore");
const summaryOnly = process.argv.includes("--summary");
const resume = process.argv.includes("--resume");
type Saved = { ranAt: string; rescoredAt?: string; seeds: number[]; usage: typeof usage; rows: Row[] };
const previous =
  rescore || summaryOnly || (resume && fs.existsSync(localFile)) ? (JSON.parse(fs.readFileSync(localFile, "utf8")) as Saved) : null;
const ranAt = previous?.ranAt ?? new Date().toISOString();
const rescoredAt = rescore ? new Date().toISOString() : previous?.rescoredAt;
if (previous) Object.assign(usage, previous.usage);

const key = (r: { restaurant: string; city: string }) => `${r.restaurant}|${r.city}`;
const rows: Row[] = summaryOnly && previous ? previous.rows : [];
const limit = Number(process.env.BENCH_LIMIT || LIST.length); // smoke tests and the cost check; the published run uses all
const seeds = previous?.seeds ?? SEEDS.slice(0, Number(process.env.HOLDOUT_SPLITS || SEEDS.length));
const costNow = () => (PRICE ? (usage.input * PRICE.input + usage.output * PRICE.output) / 1e6 : null);

/** Every row: the ones run (or kept) now, then saved ones this run has not reached (resume with BENCH_LIMIT). */
const allRows = (): Row[] => {
  const done = new Set(rows.map(key));
  return resume && previous ? [...rows, ...previous.rows.filter((r) => !done.has(key(r)))] : rows;
};
const saveLocal = () => {
  if (!summaryOnly) fs.writeFileSync(localFile, JSON.stringify({ model: MODEL, ranAt, rescoredAt, seeds, usage, rows: allRows() }, null, 1));
};

for (const req of summaryOnly ? [] : LIST.slice(0, limit)) {
  process.stdout.write(`${req.restaurant}, ${req.city} ... `);
  const row: Row = { restaurant: req.restaurant, city: req.city, ...(req.group ? { group: req.group } : {}), kept_in_a: 0, splits: [] };
  const prev = previous?.rows.find((r) => key(r) === key(req));
  if (resume && prev && (prev.excluded || (!prev.error && prev.splits.length === seeds.length))) {
    rows.push(prev);
    process.stdout.write(`kept from the saved run${prev.excluded ? ` (excluded: ${prev.excluded})` : ""}\n`);
    continue;
  }
  if (rescore && (!prev || prev.error)) {
    rows.push(prev ?? { ...row, error: "not in the previous run" });
    process.stdout.write("skipped (no saved dishes)\n");
    continue;
  }
  try {
    const { selected, resolution } = resolveRestaurant(req.restaurant, req.city, await findRestaurant(req.restaurant, req.city));
    if (!selected) throw new Error("not found in Qloo");
    row.match = resolution.match;
    if (EVAL30 && resolution.match === "best_guess") throw new Excluded("Qloo search found no place with this name");
    const data = await crowdAndCity({ entityId: selected.entity_id, city: req.city });
    const full = menuSets(data);
    row.full = { crowd: full.crowd.length, city: full.city.length };
    if (EVAL30 && (full.crowd.length < MIN_MENU_PLACES || full.city.length < MIN_MENU_PLACES))
      throw new Excluded(`thin Qloo menu data (${full.crowd.length} / ${full.city.length} restaurants with menu tags, fewer than ${MIN_MENU_PLACES})`);
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
      const saved = rescore || resume ? prev?.splits.find((s) => s.seed === seed) : undefined;
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
    if (err instanceof Excluded) row.excluded = err.message;
    else row.error = err instanceof Error ? err.message : String(err);
    process.stdout.write(`${row.excluded ? `EXCLUDED ${row.excluded}` : `ERROR ${row.error}`}\n`);
  }
  rows.push(row);
  saveLocal();
  const c = costNow();
  process.stdout.write(`  [so far: ${usage.calls} model calls, ${usage.input} in / ${usage.output} out${c != null ? `, about US$${c.toFixed(2)}` : ""}]\n`);
}

saveLocal();

// ---- Aggregates (no dish names, no Qloo data) ------------------------------------------------------
const geo = (xs: number[]) => (xs.length ? Math.exp(xs.reduce((s, x) => s + Math.log(x), 0) / xs.length) : NaN);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};
const f = (x: number | null | undefined) => (x == null || Number.isNaN(x) ? "n/a" : `×${x.toFixed(2)}`);
const p2 = (p: number) => (p < 0.001 ? "< 0.001" : p.toFixed(3));
const pv = (p: number) => (p < 0.001 ? "p < 0.001" : `p = ${p.toFixed(3)}`);
const meanOf = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : 0);
const sizes = (r: Row) => `${meanOf(r.splits.map((s) => s.b.crowd))} / ${meanOf(r.splits.map((s) => s.b.city))}`;
const ci = (r: { ratio: number; low: number; high: number }) => `${f(r.ratio)} (95% interval ${f(r.low)} to ${f(r.high)})`;
const others = ["qloo_affinity", "contrast_all", "contrast_half_a"] as const;

/** A restaurant's score for an arm: geometric mean over its splits (splits where no dish matched are left out). */
const perRestaurant = (r: Row, k: ArmKey) => {
  const xs = r.splits.map((s) => s.arms[k].lift).filter((x): x is number => x != null);
  return xs.length ? geo(xs) : null;
};

function analyse(rs: Row[]) {
  const ok = rs.filter((r) => !r.error && !r.excluded && r.splits.length);
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
  const g = Object.fromEntries(ARMS.map((k) => [k, geo(lifts(k))])) as Record<ArmKey, number>;
  return { ok, lifts, versus, matched, plans, planWins, ratio, g };
}

const cost = costNow();
if (EVAL30) writeReport30(allRows());
else writeSummaryBlock(allRows());

// ---- The 8-restaurant held-out block of eval/SUMMARY.md ---------------------------------------------
function writeSummaryBlock(rs: Row[]) {
  const { ok, lifts, versus, matched, plans, planWins, ratio, g } = analyse(rs);
  const held = versus("contrast_half_a", "llm_only");
  const allVsHeld = versus("contrast_all", "contrast_half_a");
  const rHeld = ratio("contrast_half_a", "llm_only");
  const rHeldAff = ratio("contrast_half_a", "qloo_affinity");
  const rAll = ratio("contrast_all", "contrast_half_a");

  const table = ok
    .map((r) => `| ${r.restaurant}, ${r.city} | ${sizes(r)} | ${ARMS.map((k) => f(perRestaurant(r, k))).join(" | ")} |`)
    .join("\n");

  const block = `<!-- holdout:start (generated by scripts/benchmark-holdout.ts) -->
## Held-out check: does the crowd-vs-city gain survive on restaurants the model never saw?

The "+ Qloo crowd vs city" arm above is shown the same Qloo contrast its dishes are then scored on, so its result is partly circular. \`npm run benchmark:holdout\` (scripts/benchmark-holdout.ts, run on ${ranAt.slice(0, 10)}${rescoredAt ? `, rescored on ${rescoredAt.slice(0, 10)}` : ""}) measures how much of the gain survives without that overlap. Each restaurant's crowd and city sets are split in two halves by a seeded hash of the Qloo entity id, so a restaurant falls in the same half of both sets. The held-out arm is given the contrast computed on half A only, and every arm's dishes are scored on half B only, with the same crowd-lift formula. The local places the guests love, which both Qloo arms see by name, are always kept in half A, so no scored restaurant was named to the model. ${seeds.length} splits (seeds ${seeds.join(", ")}) with one fresh sample per arm per split: ${usage.calls} calls of the same model (\`${MODEL}\`) at the same effort as above, ${usage.input} input and ${usage.output} output tokens${cost != null ? ` (about US$${cost.toFixed(2)} at list prices)` : ""}. ${ok.length} of ${rs.length} restaurants completed${rs.length - ok.length ? ` (${rs.filter((r) => r.error).map((r) => `${r.restaurant}: ${r.error}`).join("; ")})` : ""}.

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
    marked.test(summary) ? summary.replace(marked, () => block) : summary.includes(anchor) ? summary.replace(anchor, `\n${block}\n${anchor}`) : `${summary}\n${block}\n`,
  );
  console.log(
    `\nWrote the held-out block of eval/SUMMARY.md. Model calls: ${usage.calls} (${usage.input} in / ${usage.output} out${cost != null ? `, about US$${cost.toFixed(2)}` : ""}).`,
  );
  console.log(ARMS.map((k) => `${k}: ${f(g[k])}`).join(" · "));
}

// ---- The pre-registered 30-restaurant report: eval/HELDOUT_30.md ------------------------------------
function writeReport30(rs: Row[]) {
  const info = new Map(NEW_RESTAURANTS.map((r) => [key(r), r]));
  const fresh = rs.filter((r) => r.group === "new");
  const N = analyse(fresh);
  const O = analyse(rs.filter((r) => r.group === "original"));
  const A = analyse(rs);
  const cols = [N, O, A];
  const H = "contrast_half_a" as const;
  const L = "llm_only" as const;
  const lockCommit = (() => {
    try {
      return execSync("git log -1 --format=%h -- eval/heldout30.restaurants.json", { cwd: new URL("../", import.meta.url), encoding: "utf8" }).trim();
    } catch {
      return "";
    }
  })();

  const rNew = N.ratio(H, L);
  const rAll = A.ratio(H, L);
  const decision = verdict(rNew);
  const vNew = N.versus(H, L);
  const vAll = A.versus(H, L);
  // Pre-registered: the headline is the lower of the two ratios, the new restaurants' or all restaurants'.
  const headline =
    rNew.ratio < rAll.ratio
      ? { label: `the ${N.ok.length} new restaurants`, r: rNew, v: vNew, n: N.ok.length }
      : { label: `all ${A.ok.length} restaurants`, r: rAll, v: vAll, n: A.ok.length };
  const verdictLine = {
    confirmed: "confirmed: the whole 95% interval is above ×1",
    "not shown": "not shown: the 95% interval includes ×1, so this sample cannot tell the gain from no difference",
    reversed: "reversed: the whole 95% interval is below ×1",
  }[decision];
  const dropped = rs.filter((r) => r.excluded || r.error);
  const splitsWon = (r: Row) => r.splits.filter((sp) => (sp.arms[H].lift ?? 0) > (sp.arms[L].lift ?? 0)).length;
  const matchedOf = (r: Row, k: ArmKey) => r.splits.reduce((t, sp) => t + sp.arms[k].matched, 0);
  const ratioOf = (r: Row) => {
    const x = perRestaurant(r, H);
    const y = perRestaurant(r, L);
    return x != null && y != null ? x / y : null;
  };
  const row3 = (label: string, cell: (s: ReturnType<typeof analyse>) => string) => `| ${label} | ${cols.map(cell).join(" | ")} |`;
  const iv = (r: { ratio: number; low: number; high: number }) => `${f(r.ratio)} (${f(r.low)} to ${f(r.high)})`;

  const perTable = A.ok
    .map(
      (r) =>
        `| ${r.restaurant}, ${r.city} | ${r.group ?? ""} | ${sizes(r)} | ${ARMS.map((k) => f(perRestaurant(r, k))).join(" | ")} | ${f(ratioOf(r))} |`,
    )
    .join("\n");
  const losers = A.ok.filter((r) => (ratioOf(r) ?? 0) <= 1).sort((x, y) => (ratioOf(x) ?? 0) - (ratioOf(y) ?? 0));
  const loserTable = losers
    .map(
      (r) =>
        `| ${r.restaurant}, ${r.city} | ${r.group ?? ""} | ${f(perRestaurant(r, L))} | ${f(perRestaurant(r, H))} | ${f(ratioOf(r))} | ${splitsWon(r)} / ${r.splits.length} | ${sizes(r)} | ${matchedOf(r, H)} / ${matchedOf(r, L)} (of ${r.splits.length * 3}) |`,
    )
    .join("\n");

  const sub = (label: string, keep: (r: { country: string; price: string }) => boolean) => {
    const s = analyse(
      fresh.filter((r) => {
        const i = info.get(key(r));
        return i != null && keep(i);
      }),
    );
    return `| ${label} | ${s.ok.length} | ${s.ok.length ? iv(s.ratio(H, L)) : "n/a"} | ${s.versus(H, L).wins} / ${s.ok.length} |`;
  };

  const block = `<!-- heldout30:start (generated by scripts/benchmark-holdout.ts --eval30) -->
The list of 22 new restaurants, the metrics and the decision rule were committed${lockCommit ? ` (${lockCommit})` : ""} before any model call: [PREREGISTRATION_30.md](PREREGISTRATION_30.md). The run uses the protocol of the 8-restaurant held-out check in [SUMMARY.md](SUMMARY.md) unchanged. Each restaurant's two Qloo sets (the ~150 restaurants its audience loves most and the city's ~150 most popular) are split in half by a seeded hash of the Qloo entity id. The held-out arm sees the crowd-vs-city contrast of half A only, and every arm's three dishes are scored on half B only, with the crowd-lift formula the app shows (src/lib/lift.ts). There are ${seeds.length} splits (seeds ${seeds.join(", ")}) with one fresh sample per arm per split. Every arm is the same model (\`${MODEL}\`) at the same low effort with the app's own no-Qloo prompt; the arms differ only in the Qloo data appended to it.

Run on ${ranAt.slice(0, 10)}${rescoredAt ? ` (rescored on ${rescoredAt.slice(0, 10)})` : ""} with \`npm run eval:heldout\`: ${usage.calls} model calls, ${usage.input} input and ${usage.output} output tokens${cost != null ? `, about US$${cost.toFixed(2)} at list prices` : ""}. ${A.ok.length} of ${rs.length} restaurants completed${dropped.length ? `; ${dropped.map((r) => `${r.restaurant} (${r.excluded ? `excluded by a pre-registered rule: ${r.excluded}` : `failed: ${r.error}`})`).join("; ")}` : ""}.

### Result

**Decision on the new restaurants, by the pre-registered rule: ${verdictLine}.** On the ${N.ok.length} new restaurants the held-out arm's dishes score ${f(N.g[H])} on half B against ${f(N.g[L])} for the same model with no Qloo data: per restaurant, ${ci(rNew)}. It beats the model alone in ${vNew.wins} of ${vNew.wins + vNew.losses} new restaurants (exact two-sided sign test, ${pv(vNew.p)}) and in ${N.planWins(H, L)} of ${N.plans} plans.

Headline, by the pre-registered rule (the lower of the new-restaurant and all-restaurant ratios): ${headline.label}, ${ci(headline.r)}, better in ${headline.v.wins} of ${headline.n}.

| Scored on half B | ${N.ok.length} new restaurants (primary) | Original ${O.ok.length}, run again | All ${A.ok.length} |
|---|---|---|---|
${row3("LLM only: geometric mean crowd lift", (s) => f(s.g.llm_only))}
${row3("+ Qloo affinity", (s) => f(s.g.qloo_affinity))}
${row3("+ crowd vs city, all places (has seen half B)", (s) => f(s.g.contrast_all))}
${row3("+ crowd vs city, half A only (held out)", (s) => f(s.g.contrast_half_a))}
${row3("Held out ÷ LLM only, per restaurant (95% bootstrap interval)", (s) => iv(s.ratio(H, L)))}
${row3("Held out ÷ Qloo affinity (95% interval)", (s) => iv(s.ratio(H, "qloo_affinity")))}
${row3("Qloo affinity ÷ LLM only (95% interval)", (s) => iv(s.ratio("qloo_affinity", L)))}
${row3("All places ÷ held out (95% interval)", (s) => iv(s.ratio("contrast_all", H)))}
${row3("Restaurants where held out beats LLM only", (s) => {
  const v = s.versus(H, L);
  return `${v.wins} / ${s.ok.length} (sign test ${pv(v.p)})`;
})}
${row3("Plans where held out beats LLM only", (s) => `${s.planWins(H, L)} / ${s.plans}`)}
${row3("Median crowd lift, held out / LLM only", (s) => `${f(median(s.lifts(H)))} / ${f(median(s.lifts(L)))}`)}
${row3("Dishes matched on local menus, held out / LLM only", (s) => `${s.matched(H)} / ${s.matched(L)} (of ${s.plans * 3})`)}

For comparison, the 8-restaurant run of 2026-10-21 reported held out ÷ LLM only ×1.27 (×1.07 to ×1.48), better in 6 of 8. The "Original" column runs those 8 again with fresh model samples.

### Per restaurant

| Restaurant | Group | Half B: crowd / city restaurants with menu data | LLM only | + Qloo affinity | + crowd vs city, all places | + crowd vs city, half A only (held out) | Held out ÷ LLM only |
|---|---|---|---|---|---|---|---|
${perTable}

(each arm's cell: geometric mean over the ${seeds.length} splits of the plan's crowd lift on half B)

### Restaurants where the held-out arm did not beat the model alone

${
  losers.length
    ? `| Restaurant | Group | LLM only | Held out | Ratio | Splits won by held out | Half B with menu data | Dishes matched, held out / LLM only |
|---|---|---|---|---|---|---|---|
${loserTable}

The reason for each, in one line, is under "Where it fails" below this block.`
    : "None."
}

### Exploratory breakdown of the new restaurants (planned, not a test)

| New restaurants | n | Held out ÷ LLM only (95% interval) | Better than LLM only |
|---|---|---|---|
${sub("In the US", (i) => i.country === "US")}
${sub("Outside the US", (i) => i.country !== "US")}
${sub("Price $ or $$", (i) => i.price.length <= 2)}
${sub("Price $$$ or $$$$", (i) => i.price.length >= 3)}

### Limits

- Crowd lift is a proxy: it says the crowd's favourite restaurants serve dishes like these more often than the city's most popular ones, with Qloo's own menu tags as the ruler. It does not measure demand, covers or whether guests would order the dish.
- Half-size sets make each term count noisier, and there is one sample per arm per split.
- The intervals are over these restaurants. They say nothing about cities or kinds of restaurant this list does not cover.
- Both halves come from the same city and the same Qloo audience signal, so this tests whether the contrast carries over to other restaurants this crowd loves.
<!-- heldout30:end -->`;

  const reportFile = new URL("../eval/HELDOUT_30.md", import.meta.url);
  const existing = fs.existsSync(reportFile) ? fs.readFileSync(reportFile, "utf8") : "";
  const marked = /<!-- heldout30:start[\s\S]*?<!-- heldout30:end -->/;
  fs.writeFileSync(
    reportFile,
    marked.test(existing)
      ? existing.replace(marked, () => block) // a function, so "$$" in the text is not read as a replacement pattern
      : `# Held-out check on 30 restaurants (pre-registered)\n\n${block}\n\n## Where it fails\n\n(one line per restaurant above, written after reading the results)\n`,
  );
  const r4 = (r: { ratio: number; low: number; high: number }) => ({ ratio: +r.ratio.toFixed(4), low: +r.low.toFixed(4), high: +r.high.toFixed(4) });
  const out = {
    decision,
    headline: { label: headline.label, ...r4(headline.r), better: headline.v.wins, n: headline.n },
    new: { n: N.ok.length, ...r4(rNew), better: vNew.wins, withQloo: +N.g[H].toFixed(4), alone: +N.g[L].toFixed(4) },
    all: { n: A.ok.length, ...r4(rAll), better: vAll.wins, withQloo: +A.g[H].toFixed(4), alone: +A.g[L].toFixed(4) },
    original: { n: O.ok.length, ...r4(O.ratio(H, L)), better: O.versus(H, L).wins },
  };
  console.log(`\nWrote eval/HELDOUT_30.md. Model calls: ${usage.calls} (${usage.input} in / ${usage.output} out${cost != null ? `, about US$${cost.toFixed(2)}` : ""}).`);
  console.log(JSON.stringify(out));
}
