// Recomputes the crowd-lift fields of the recorded playbooks in src/data/demos.json with the current
// formula (src/lib/lift.ts) and fresh Qloo restaurant sets, so replays show the same score a live run
// would show today. Only those server-derived fields change: the model's output and the Qloo facts
// in the recording are left as they were. Qloo calls only, no model calls.
//
//   npm run rescore-demos        (needs QLOO_API_KEY; then `npm run pack-demos` for deployments)
import fs from "node:fs";
import { crowdLiftOf, parseBaselineDishes } from "../src/lib/lift";
import { crowdAndCity, menuSets } from "../src/lib/qloo-tasks";
import type { AgentEvent, Playbook } from "../src/lib/types";

type Recorded = { slug: string; city: string; events: (AgentEvent & { t: number })[] };

const file = new URL("../src/data/demos.json", import.meta.url);
const demos = JSON.parse(fs.readFileSync(file, "utf8")) as Recorded[];

for (const d of demos) {
  const entity = d.events.find((e): e is Extract<AgentEvent, { type: "restaurant" }> & { t: number } => e.type === "restaurant")?.entity;
  const pbEvent = d.events.find((e): e is Extract<AgentEvent, { type: "playbook" }> & { t: number } => e.type === "playbook");
  const baseline = d.events.find((e): e is Extract<AgentEvent, { type: "baseline" }> & { t: number } => e.type === "baseline")?.text;
  if (!entity || !pbEvent) {
    console.log(`${d.slug}: no restaurant or playbook, skipped`);
    continue;
  }
  const pb: Playbook = pbEvent.playbook;
  const sets = menuSets(await crowdAndCity({ entityId: entity.entity_id, city: d.city }));
  const { perDish, summary } = crowdLiftOf(
    pb.menu_moves.map((m) => m.dish),
    sets,
    d.city,
    baseline ? parseBaselineDishes(baseline) : [],
  );
  const before = `${pb.crowd_lift?.score ?? "none"} / baseline ${pb.crowd_lift?.baseline?.score ?? "none"}`;
  pb.menu_moves.forEach((m, i) => {
    m.lift = perDish[i]?.lift ?? null;
    m.lift_terms = perDish[i]?.terms ?? [];
  });
  pb.crowd_lift = summary;
  console.log(`${d.slug}: crowd lift ${before} -> ${summary.score} / baseline ${summary.baseline?.score ?? "none"}`);
}

fs.writeFileSync(file, JSON.stringify(demos) + "\n");
