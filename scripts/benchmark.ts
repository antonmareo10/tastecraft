// With-vs-without-Qloo benchmark, scored with the app's own crowd-lift formula (src/lib/lift.ts).
//
//   npm run benchmark                (needs ANTHROPIC_API_KEY and QLOO_API_KEY in the environment)
//   npm run benchmark -- --rescore   no model calls: rescore the dishes saved by the last run (and the
//                                    current local recordings) with the current formula
//
// For each restaurant below (fixed before the run), three sets of three dishes are scored against
// the SAME two Qloo restaurant sets (the crowd's ~150 favourite restaurants vs the city's ~150 most
// popular), using the app's own code paths:
//   A. LLM only        the production model, no tools: the app's genericBaseline() prompt.
//   B. Qloo affinity   the same prompt plus the Qloo affinity data the old Taste-Fit relied on
//                      (dish/cuisine tags and loved places with 0-100 affinity), no city contrast.
//   C. Qloo contrast   the same prompt plus Tastecraft's crowd-vs-city data (taste_gaps output)
//                      and the affinity data from B.
//   Full agent         where a local recording (src/data/demos.json) exists, the dishes of the real
//                      agent's playbook are rescored the same way.
// It also records, per restaurant, the mean Qloo affinity of the audience's top dish tags for the
// audience and for the city overall, to show why an affinity mean could not tell plans apart.
//
// Writes eval/benchmark.local.json (dish names and Qloo-derived counts: gitignored, never published)
// and eval/SUMMARY.md (aggregates only).

import "./load-env";
import fs from "node:fs";
import { baselinePrompt, genericBaseline } from "../src/lib/agent";
import { parseBaselineDishes, planLift, type CrowdSets } from "../src/lib/lift";
import { qlooGet } from "../src/lib/qloo";
import { crowdAndCity, findRestaurant, menuSets, resolveRestaurant } from "../src/lib/qloo-tasks";
import type { AgentRequest, Playbook } from "../src/lib/types";
import { MODEL, RESTAURANTS, affinityData, ask, contrastData, groundedPrompt, usage } from "./bench-common";

/** Mean Qloo affinity of the audience's top dish tags, for the audience and for the city overall (no audience signal). */
async function affinitySaturation(dishTags: { id: string; affinity?: number }[], city: string) {
  const top = dishTags.filter((t) => t.id && t.affinity != null).slice(0, 10);
  if (!top.length) return null;
  const json = await qlooGet<{ results?: { tags?: { tag_id?: string; query?: { affinity?: number } }[] } }>("/v2/insights", {
    "filter.type": "urn:tag",
    "filter.results.tags": top.map((t) => t.id).join(","),
    "signal.location.query": city,
    take: top.length,
  });
  const cityAff = new Map((json.results?.tags ?? []).map((t) => [t.tag_id, t.query?.affinity]));
  const both = top.filter((t) => typeof cityAff.get(t.id) === "number");
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  return {
    n: both.length,
    audience: both.length ? Math.round(mean(both.map((t) => (t.affinity as number) * 100)) * 10) / 10 : null,
    city: both.length ? Math.round(mean(both.map((t) => (cityAff.get(t.id) as number) * 100)) * 10) / 10 : null,
  };
}

function recordedPlaybook(req: AgentRequest): { pb: Playbook; baseline?: string; seconds: number } | null {
  const file = new URL("../src/data/demos.json", import.meta.url);
  if (!fs.existsSync(file)) return null;
  const demos = JSON.parse(fs.readFileSync(file, "utf8")) as { restaurant: string; city: string; events: ({ type: string; t: number } & Record<string, unknown>)[] }[];
  const d = demos.find((x) => x.restaurant === req.restaurant && x.city === req.city);
  const pb = d?.events.find((e) => e.type === "playbook")?.playbook as Playbook | undefined;
  if (!d || !pb?.crowd_lift) return null; // only recordings made with the crowd-lift version
  const baseline = d.events.find((e) => e.type === "baseline")?.text as string | undefined;
  return { pb, baseline, seconds: Math.round((d.events.at(-1)?.t ?? 0) / 1000) };
}

type Arm = { dishes: string[]; lift: number | null; matched: number };
type Row = {
  restaurant: string;
  city: string;
  crowd_n?: number;
  city_n?: number;
  llm_only?: Arm;
  qloo_affinity?: Arm;
  qloo_contrast?: Arm;
  full_agent?: Arm & { seconds: number; shown_in_replay: number | null };
  recorded_baseline?: Arm;
  saturation?: Awaited<ReturnType<typeof affinitySaturation>>;
  error?: string;
};

const score = (dishes: string[], sets: CrowdSets): Arm => {
  const p = planLift(dishes, sets);
  return { dishes, lift: p.lift, matched: p.matched };
};

const localFile = new URL("../eval/benchmark.local.json", import.meta.url);
const rescore = process.argv.includes("--rescore");
const previous = rescore ? (JSON.parse(fs.readFileSync(localFile, "utf8")) as { ranAt: string; usage: typeof usage; rows: Row[] }) : null;
const ranAt = previous?.ranAt ?? new Date().toISOString();
if (previous) Object.assign(usage, previous.usage);

const rows: Row[] = [];
const limit = Number(process.env.BENCH_LIMIT || RESTAURANTS.length); // smoke tests only; the published run uses all
for (const req of RESTAURANTS.slice(0, limit)) {
  process.stdout.write(`${req.restaurant}, ${req.city} ... `);
  const row: Row = { restaurant: req.restaurant, city: req.city };
  const prev = previous?.rows.find((r) => r.restaurant === req.restaurant && r.city === req.city);
  if (previous && (!prev || prev.error || !prev.llm_only || !prev.qloo_affinity || !prev.qloo_contrast)) {
    rows.push(prev ?? { ...row, error: "not in the previous run" });
    process.stdout.write("skipped (no saved dishes)\n");
    continue;
  }
  try {
    const { selected } = resolveRestaurant(req.restaurant, req.city, await findRestaurant(req.restaurant, req.city));
    if (!selected) throw new Error("not found in Qloo");
    const sets = menuSets(await crowdAndCity({ entityId: selected.entity_id, city: req.city }));
    row.crowd_n = sets.crowd.length;
    row.city_n = sets.city.length;
    if (!sets.crowd.length || !sets.city.length) throw new Error("no menu data for this city");

    if (prev?.llm_only && prev.qloo_affinity && prev.qloo_contrast) {
      row.saturation = prev.saturation;
      row.llm_only = score(prev.llm_only.dishes, sets);
      row.qloo_affinity = score(prev.qloo_affinity.dishes, sets);
      row.qloo_contrast = score(prev.qloo_contrast.dishes, sets);
    } else {
    const base = baselinePrompt(req);
    const aff = await affinityData(selected, req.city);
    const contrast = await contrastData(selected, req.city);
    row.saturation = await affinitySaturation(aff.dishTags, req.city);

    const llmOnly = parseBaselineDishes(await genericBaseline(req));
    usage.calls += 1; // genericBaseline logs its own token counts
    const withAffinity = parseBaselineDishes(await ask(groundedPrompt(base, aff.data)));
    const withContrast = parseBaselineDishes(await ask(groundedPrompt(base, { ...aff.data, crowd_vs_city: contrast })));
    row.llm_only = score(llmOnly, sets);
    row.qloo_affinity = score(withAffinity, sets);
    row.qloo_contrast = score(withContrast, sets);
    }

    const rec = recordedPlaybook(req);
    if (rec) {
      row.full_agent = { ...score(rec.pb.menu_moves.map((m) => m.dish), sets), seconds: rec.seconds, shown_in_replay: rec.pb.crowd_lift?.score ?? null };
      const rb = rec.baseline ? parseBaselineDishes(rec.baseline) : [];
      if (rb.length) row.recorded_baseline = score(rb, sets);
    }
    process.stdout.write(`LLM-only ${row.llm_only.lift} · affinity ${row.qloo_affinity.lift} · contrast ${row.qloo_contrast.lift}${row.full_agent ? ` · agent ${row.full_agent.lift}` : ""}\n`);
  } catch (err) {
    row.error = err instanceof Error ? err.message : String(err);
    process.stdout.write(`ERROR ${row.error}\n`);
  }
  rows.push(row);
}

const rescoredAt = rescore ? new Date().toISOString() : undefined;
fs.writeFileSync(localFile, JSON.stringify({ model: MODEL, ranAt, rescoredAt, usage, rows }, null, 1));

// ---- Summary (aggregates only) ----------------------------------------------------------------
const ok = rows.filter((r) => !r.error && r.llm_only && r.qloo_affinity && r.qloo_contrast);
const geo = (xs: number[]) => (xs.length ? Math.exp(xs.reduce((s, x) => s + Math.log(x), 0) / xs.length) : NaN);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};
const lifts = (k: "llm_only" | "qloo_affinity" | "qloo_contrast") => ok.map((r) => r[k]?.lift).filter((x): x is number => x != null);
const f = (x: number | null | undefined) => (x == null || Number.isNaN(x) ? "n/a" : `×${x.toFixed(2)}`);
const wins = (k: "qloo_affinity" | "qloo_contrast") => ok.filter((r) => (r[k]?.lift ?? 0) > (r.llm_only?.lift ?? 0)).length;
const matched = (k: "llm_only" | "qloo_affinity" | "qloo_contrast") => ok.reduce((s, r) => s + (r[k]?.matched ?? 0), 0);
const agents = rows.filter((r) => r.full_agent);
const sat = ok.filter((r) => r.saturation?.audience != null);

const table = ok
  .map(
    (r) =>
      `| ${r.restaurant}, ${r.city} | ${r.crowd_n} / ${r.city_n} | ${f(r.llm_only?.lift)} (${r.llm_only?.matched}/3) | ${f(r.qloo_affinity?.lift)} (${r.qloo_affinity?.matched}/3) | ${f(r.qloo_contrast?.lift)} (${r.qloo_contrast?.matched}/3) | ${r.full_agent ? `${f(r.full_agent.lift)} (${r.full_agent.matched}/3)` : "—"} |`,
  )
  .join("\n");

const summary = `# Tastecraft benchmark: dishes with and without Qloo

Run on ${ranAt.slice(0, 10)} with \`npm run benchmark\` (scripts/benchmark.ts), model \`${MODEL}\`.${rescoredAt ? ` Scores recomputed on ${rescoredAt.slice(0, 10)} with \`npm run benchmark -- --rescore\` (same saved dishes, no new model calls; the full-agent column reflects the local recordings at that time).` : ""} ${ok.length} of ${rows.length} restaurants completed${rows.length - ok.length ? ` (${rows
  .filter((r) => r.error)
  .map((r) => `${r.restaurant}: ${r.error}`)
  .join("; ")})` : ""}. ${usage.calls} model calls (the two Qloo-grounded arms used ${usage.input} input and ${usage.output} output tokens in total). The restaurants were fixed before the run: the ten in eval/restaurants.json minus the second pick in New York and in Los Angeles (Joe's Pizza, AC Barbeque), so each city counts once.

## What is measured

**Crowd lift**, the score Tastecraft shows on every playbook (src/lib/lift.ts): Qloo gives two sets of restaurants in the same city, the ~150 that this restaurant's audience has the highest affinity for (the crowd) and the city's ~150 most popular ones; only those with menu tags in Qloo count (second column below). Each dish name is split into the food terms local Qloo menu tags use; a term's lift is the share of crowd restaurants whose menu tags mention it divided by the share of city restaurants that do (add-one smoothed); dishes and plans use geometric means. ×1.00 = no different from the city; above 1 = this crowd's favourite places serve it more often.

Every arm is scored by the same function against the same two sets. All arms use the same model, the same effort and the app's own baseline prompt ("suggest three dishes to add and one event idea"); they differ only in the Qloo data appended to the prompt:

- **LLM only**: no Qloo data (the same prompt, model and effort as the app's quick no-Qloo answer).
- **+ Qloo affinity**: the audience's dish and cuisine tags and loved local places with Qloo affinity, i.e. what the earlier Taste-Fit score was built on.
- **+ Qloo crowd vs city**: the same, plus Tastecraft's crowd-vs-city contrast (the taste_gaps tool output).
- **Full agent**: the dishes of a real recorded Tastecraft playbook for that restaurant, rescored now (only where a local recording exists).

## Results

| Restaurant | Crowd / city restaurants with menu data | LLM only | + Qloo affinity | + Qloo crowd vs city | Full agent |
|---|---|---|---|---|---|
${table}

(matched = dishes with at least one food term on local menus, out of 3)

| Aggregate over ${ok.length} restaurants | LLM only | + Qloo affinity | + Qloo crowd vs city |
|---|---|---|---|
| Geometric mean crowd lift | ${f(geo(lifts("llm_only")))} | ${f(geo(lifts("qloo_affinity")))} | ${f(geo(lifts("qloo_contrast")))} |
| Median crowd lift | ${f(median(lifts("llm_only")))} | ${f(median(lifts("qloo_affinity")))} | ${f(median(lifts("qloo_contrast")))} |
| Restaurants where it beats LLM only | — | ${wins("qloo_affinity")} / ${ok.length} | ${wins("qloo_contrast")} / ${ok.length} |
| Dishes matched on local menus | ${matched("llm_only")} / ${ok.length * 3} | ${matched("qloo_affinity")} / ${ok.length * 3} | ${matched("qloo_contrast")} / ${ok.length * 3} |
${agents.length ? `\nFull agent (recorded playbooks, n = ${agents.length}): geometric mean ${f(geo(agents.map((r) => r.full_agent!.lift).filter((x): x is number => x != null)))}; the same runs' own no-Qloo baselines: ${f(geo(agents.map((r) => r.recorded_baseline?.lift).filter((x): x is number => x != null)))}. Recorded run times: ${agents.map((r) => `${r.full_agent!.seconds} s`).join(", ")}.\n` : ""}
These results are in-sample: the "+ Qloo crowd vs city" arm (and the full agent) are scored on the same restaurant sets whose contrast they were shown. The held-out check below, when present, scores every arm on restaurants the model was not shown.

## Why the old Taste-Fit score could not tell plans apart

For the top ${sat[0]?.saturation?.n ?? 10} dish tags of each audience, the mean Qloo affinity was ${sat.length ? `${(sat.reduce((s, r) => s + (r.saturation!.audience as number), 0) / sat.length).toFixed(1)} for the restaurant's audience and ${(sat.reduce((s, r) => s + (r.saturation!.city as number), 0) / sat.length).toFixed(1)} for the city overall (no audience signal), averaged over ${sat.length} restaurants` : "not available"}. Affinity puts what is popular everywhere near the top for almost any audience, so a mean affinity of cited facts reads ~96-100 for any plan.

## Limitations: what these results do not establish

- **Crowd lift is a proxy, not demand.** It says the crowd's favourite restaurants serve dishes like these more often than the city's most popular ones; it does not predict covers, revenue or whether guests will order the dish here.
- **The in-sample "crowd vs city" result is partly circular.** That arm sees the same Qloo contrast its dishes are scored on. Dish names are scored independently of what the model cites, so a high score still requires naming dishes the crowd's places actually serve, but the arm is expected to do well. The held-out check above removes the overlap; use its numbers for what the contrast is worth on restaurants the model has not seen.
- **The term matcher is a heuristic.** Dish names are matched to local menu tags by words (accents, case and simple plurals folded; preparation, season and format words ignored on their own). Creative names can match nothing (excluded from the score) or match a generic word.
- **Small samples.** ${ok.length} restaurants, one sample per arm, ~150 restaurants per set; per-term counts are often single digits. Differences per restaurant are noisy; look at the aggregate.
- **Coverage varies by city.** Qloo menu tags are richer in some cities than others.
- **The full-agent column** rescores the dish names of local recordings made during development; it is only shown where one exists.${(() => {
  const drift = agents.filter((r) => r.full_agent!.shown_in_replay != null && Math.abs((r.full_agent!.shown_in_replay as number) - (r.full_agent!.lift ?? 0)) > 0.01);
  return drift.length
    ? ` A replay shows the score computed when it was recorded; ${drift.map((r) => `${r.restaurant}'s replay shows ${f(r.full_agent!.shown_in_replay)}`).join(", ")} because it was recorded before the final list of ignored words.`
    : "";
})()}

Raw per-restaurant results (dish names, term counts) contain Qloo-derived data and stay in eval/benchmark.local.json, which is not committed.
`;
// The held-out block of the summary is written by scripts/benchmark-holdout.ts: keep it.
const summaryFile = new URL("../eval/SUMMARY.md", import.meta.url);
const heldOut = fs.existsSync(summaryFile) ? /<!-- holdout:start[\s\S]*?<!-- holdout:end -->/.exec(fs.readFileSync(summaryFile, "utf8"))?.[0] : undefined;
const anchor = "\n## Why the old Taste-Fit score could not tell plans apart";
fs.writeFileSync(summaryFile, heldOut ? summary.replace(anchor, `\n${heldOut}\n${anchor}`) : summary);
console.log(`\nWrote eval/SUMMARY.md. Model calls: ${usage.calls} (ask() tokens: ${usage.input} in / ${usage.output} out).`);
