// Shared by scripts/benchmark.ts and scripts/benchmark-holdout.ts: the restaurants, the model call
// and the two blocks of Qloo data the grounded arms append to the app's baseline prompt.

import Anthropic from "@anthropic-ai/sdk";
import { audienceAffinity, tasteGaps, tasteTags, type CrowdContrast, type RestaurantMatch } from "../src/lib/qloo-tasks";
import type { AgentRequest } from "../src/lib/types";

// Declared before the first run. eval/restaurants.json (the older ablation list) has ten restaurants,
// two of them in New York and two in Los Angeles; the benchmark keeps one per city (eight cities) and
// leaves out the second pick in each (Joe's Pizza, AC Barbeque). Goals match the app's samples where
// a recording exists, otherwise eval/restaurants.json.
export const RESTAURANTS: AgentRequest[] = [
  { restaurant: "Katz's Delicatessen", city: "New York", goal: "Fill quiet weeknights" },
  { restaurant: "Gjelina", city: "Los Angeles", goal: "Win a younger crowd" },
  { restaurant: "Casa Lucio", city: "Madrid", goal: "Launch a new seasonal special" },
  { restaurant: "Au Cheval", city: "Chicago", goal: "Grow delivery orders" },
  { restaurant: "Franklin Barbecue", city: "Austin", goal: "Launch a new seasonal special" },
  { restaurant: "Zuni Café", city: "San Francisco", goal: "Win a younger crowd" },
  { restaurant: "Dishoom", city: "London", goal: "Launch a new seasonal special" },
  { restaurant: "Mama's Fish House", city: "Maui", goal: "Grow delivery orders" },
];

export const MODEL = process.env.TASTECRAFT_MODEL || "claude-opus-5-5";
export const usage = { calls: 0, input: 0, output: 0 };

let client: Anthropic | null = null;

/** One model call at the same model and effort as the app's genericBaseline(), so arms differ only by the Qloo data in the prompt. */
export async function ask(prompt: string): Promise<string> {
  client ??= new Anthropic();
  const res = await client.messages.create({ model: MODEL, max_tokens: 1200, output_config: { effort: "low" }, messages: [{ role: "user", content: prompt }] });
  usage.calls += 1;
  usage.input += res.usage.input_tokens;
  usage.output += res.usage.output_tokens;
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

export const pct = (x: number, n: number) => (n ? Math.round((x / n) * 100) : 0);
const a100 = (a?: number) => (a == null ? null : Math.round(a * 100));

/** Arm B's data: the audience's dish and cuisine tags and the local places it loves, with Qloo affinity. */
export async function affinityData(r: RestaurantMatch, city: string) {
  const [dishes, cuisines, places] = await Promise.all([
    tasteTags({ entityId: r.entity_id, city, family: "dishes", take: 12 }).catch(() => []),
    tasteTags({ entityId: r.entity_id, city, family: "cuisines", take: 8 }).catch(() => []),
    audienceAffinity({ entityIds: [r.entity_id], domain: "place", city, take: 10 }).catch(() => []),
  ]);
  return {
    data: {
      restaurant: { name: r.name, address: r.subtitle, tags: r.all_tags.slice(0, 15) },
      dishes_this_audience_has_affinity_for: dishes.map((t) => ({ dish: t.name, affinity_0_100: a100(t.affinity) })),
      cuisines_this_audience_has_affinity_for: cuisines.map((t) => ({ cuisine: t.name, affinity_0_100: a100(t.affinity) })),
      local_places_guests_also_love: places.map((p) => ({ name: p.name, affinity_0_100: a100(p.affinity), tags: (p.tags ?? []).slice(0, 4) })),
    },
    dishTags: dishes,
    placeIds: places.map((p) => p.entity_id),
  };
}

/** Arm C's extra data: Tastecraft's crowd-vs-city contrast, in the shape the taste_gaps tool gives the agent. */
export function contrastJson(g: CrowdContrast, city: string) {
  return {
    how: `crowd = the ${g.crowd_n} restaurants in ${city} this restaurant's guests love most (Qloo affinity); city = the ${g.city_n} most popular restaurants there. pct = share of each set whose Qloo tags include it; lift = how many times more often the crowd's restaurants have it.`,
    menu_terms_crowd_favours: g.menu.over.map((t) => ({ term: t.term, crowd_pct: pct(t.crowd, g.crowd_n), city_pct: pct(t.city, g.city_n), lift: t.lift, already_on_your_menu: t.on_your_menu })),
    menu_terms_crowd_avoids: g.menu.under.map((t) => ({ term: t.term, crowd_pct: pct(t.crowd, g.crowd_n), city_pct: pct(t.city, g.city_n), lift: t.lift })),
    gaps: g.gaps.slice(0, 8).map((x) => ({ tag: x.tag, crowd_pct: x.crowd_pct, city_pct: x.city_pct, lift: x.lift })),
  };
}

export async function contrastData(r: RestaurantMatch, city: string) {
  return contrastJson(await tasteGaps({ restaurant: r, city }), city);
}

/** The prompt of a Qloo-grounded arm: the app's baseline prompt plus the Qloo data as JSON. */
export const groundedPrompt = (base: string, data: unknown) =>
  `${base}\n\nQloo taste data about this restaurant's audience (JSON):\n${JSON.stringify(data)}\n\nUse it to choose dishes this restaurant's guests are likely to love.`;
