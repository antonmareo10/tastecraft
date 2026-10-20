// The Tastecraft agent: Claude + Qloo tools, driven by the SDK's tool runner.
// Every tool call is mirrored to the UI as events so the user can watch the agent work.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { matchConcerts } from "./concerts";
import { EvidenceLedger } from "./ledger";
import { parseBaselineDishes, planLift } from "./lift";
import { QlooError } from "./qloo";
import type { HarnessError } from "./qloo-harness";
import {
  DOMAINS,
  TAG_FAMILIES,
  audienceAffinity,
  audienceDemographics,
  compareAudiences,
  crowdAndCity,
  menuSets,
  nearbyGames,
  showsConfigured,
  tasteTags,
  findRestaurant,
  nameZones,
  resolveRestaurant,
  restaurantById,
  tasteGaps,
  tasteHeatmap,
  type Lens,
  type RestaurantMatch,
} from "./qloo-tasks";
import { DEFAULT_TREND_DAYS, risingNearby } from "./rising";
import { toTrendLine } from "./trends";
import type { AgentEvent, AgentRequest, CrowdLift, Playbook } from "./types";

const MODEL = process.env.TASTECRAFT_MODEL || "claude-opus-5-5";
// Qloo's hackathon /v2/trending rejects places (filter.type must be a person, artist, brand, movie,
// TV show or podcast), so place trends stay off unless a key that supports them opts in.
const PLACE_TRENDS = process.env.QLOO_PLACE_TRENDS === "1";

const SYSTEM = `You are Tastecraft, the taste-intelligence analyst for independent restaurants. Chains have insight teams; your job is to give a small restaurant the same edge using Qloo's taste graph (cross-domain affinity data across places, brands, music, film, TV, books and more).

How you work:
1. Locate the restaurant with find_restaurant. It auto-selects the best candidate and reports how sure the match is. If the match is ambiguous and another candidate clearly fits the owner's restaurant better (address in the city, same concept), call find_restaurant again with that entity_id. Never switch away from a match the owner confirmed. If nothing matches, say so in a note and work at city level using the concept the owner described.
2. Build the audience's taste DNA with audience_affinity. Always run "place" (local places the same guests love). Then pick the 3 other domains most useful for the owner's goal (usually artist, brand and one of movie/tv_show/podcast). Call independent tools in parallel.
3. If the rising_nearby tool is available, once the "place" results are in, run it with the restaurant's entity_id plus the 3-4 highest-affinity local places, to see which of them are gaining or losing popularity. Rising peers are evidence of what is working nearby ("copy what's working nearby"); describe them as aggregate popularity trends over the window, never as the cause of anything.
4. Run taste_tags for "dishes", "cuisines" and "ambience" (in parallel) to learn which specific dishes, cuisines and vibes this audience over-indexes on in this city, and audience_profile to learn their age and gender skew.
5. Pick the closest rival from the "place" results (similar cuisine and price, high affinity) and run compare_rival to see what only one of the two places is known for in Qloo (positioning, not a measured audience difference).
6. Run taste_gaps. It contrasts the ~150 restaurants this crowd loves most in the city with the city's ~150 most popular restaurants, so you can tell what this crowd specifically favours from what is simply popular everywhere: menu terms the crowd favours (lift above 1) or avoids (lift below 1), and cuisines, formats and vibes their favourite places have that this restaurant lacks.
7. If the nearby_shows tool is available, run it (pass the top artists from the music results; they are only a fallback) and set include_sports when a stadium or arena is likely nearby. It ranks the concerts near the restaurant by fan_match, Qloo's 0-100 affinity of each billed artist for this audience; turn the best-matched ones into pre- or post-event ideas.
8. Run taste_map to see where in the city people with this taste live and go out.
9. If the goal is about a specific audience (younger crowd, families, women, men), run one audience_affinity or taste_gaps call with the matching lens and compare.
10. Finish by calling publish_playbook exactly once.
If a tool returns an error or no data, do not retry it more than once; continue with what you have and mention the gap in caveats.

Rules for the playbook:
- Every menu move, event and marketing idea must be justified by concrete Qloo evidence: name the places, artists or brands and quote their affinity scores (as 0-100) exactly as the tools returned them. Trend changes (percentile points from rising_nearby) and fan_match scores (from nearby_shows) can be cited the same way. Never invent a score, a place or a statistic.
- Each evidence item has a sentence plus "cites": the exact names (spelled exactly as the tools returned them) and the 0-100 scores you quoted. The server checks every cite against this run's Qloo responses and marks unverifiable facts, so only cite what the tools returned.
- Write evidence the way you would tell an owner, not an analyst: "Vermouth scores 95/100 with your crowd", "4 of the 10 places your guests love most serve natural wine (e.g. X, Y)". Never expose internal field names such as weighted_score, share_of_loved_places_pct or entity ids.
- Be specific to this restaurant, this city and the owner's goal. Avoid generic advice that any restaurant could get.
- Menu moves must be realistic for the restaurant's kitchen and price level. Prices and costs are in the local currency.
- High taste_tags affinity alone often just means "popular everywhere" (fries, tiramisu). Use taste_gaps to see what this crowd favours over the city (lift above 1) or avoids (below 1), and weigh it together with the restaurant's identity and kitchen: a good menu move is something this restaurant can credibly serve that its crowd over-indexes on, not a copy of another place's menu. When you use these shares, quote them in the evidence ("on 11% of the menus at your guests' favourite places vs 2% citywide").
- Give each dish a plain, descriptive menu name.
- The shopping list covers the ingredients for testing the three menu moves for one week in a small restaurant (realistic quantities, supplier categories such as produce, meat, fish, dairy, dry goods, drinks).
- target_zones should use the neighborhood names returned by taste_map.
- week_plan turns everything into next week's schedule (supplier order early in the week, launch, posts timed to when the audience goes out, the event, a review of results).
- Qloo affinities describe what people who like this restaurant tend to like, in aggregate. Phrase them as group tendencies ("guests who love this place over-index on vermouth"), never as causal claims or predictions about an individual guest, and never infer sensitive traits (health, finances, politics, religion).
- Keep facts and judgment apart: evidence holds only Qloo facts; "why", "opportunity", the event and the plan are your interpretation, framed as bets to test.
- In caveats, state honestly what the data cannot tell (e.g. missing data, small samples). Always include one line on what these results do not establish (affinity is not demand or sales, so test before scaling), and say so if the restaurant match was ambiguous.
- Write in clear, warm, practical language for a busy owner, in the language the owner asked for (default English). Keep proper names as they are.

Before each group of tool calls, write one short sentence (max 15 words) saying what you are checking and why. After publish_playbook, reply with a single short sentence.`;

const EvidenceSchema = z.object({
  text: z.string().describe("Owner-friendly sentence, e.g. 'Vermouth scores 95/100 with your crowd'"),
  cites: z
    .array(z.object({ name: z.string(), score: z.number().nullable() }))
    .min(1)
    .describe("Exact Qloo names (entity or tag, spelled exactly as the tool returned them) this sentence relies on, each with the 0-100 score you quoted, or null if none"),
});

const PlaybookSchema = z.object({
  restaurant: z.object({
    name: z.string(),
    city: z.string(),
    concept: z.string().describe("One line: cuisine, style and price point"),
    qloo_entity_id: z.string().nullable(),
  }),
  currency: z.string().describe("ISO 4217 code for the city, e.g. EUR, USD, GBP"),
  headline: z.string().describe("The single most important insight, one sentence"),
  audience_dna: z.object({
    summary: z.string().describe("2-3 sentences describing the guests' taste, citing evidence"),
    signals: z.array(z.object({ domain: z.string(), items: z.array(z.string()) })),
  }),
  taste_gaps: z
    .array(z.object({ tag: z.string(), evidence: z.string(), opportunity: z.string() }))
    .describe("2-4 gaps"),
  menu_moves: z
    .array(
      z.object({
        dish: z.string(),
        description: z.string(),
        price: z.number(),
        why: z.string(),
        evidence: z.array(EvidenceSchema).describe("2-3 concrete Qloo facts"),
        ingredients: z.array(
          z.object({ item: z.string(), qty: z.number(), unit: z.string(), supplier_category: z.string() }),
        ),
      }),
    )
    .describe("Exactly 3 dishes"),
  experience: z.object({
    event_idea: z.string().describe("Short title of one event or series"),
    event_why: z.string(),
    playlist: z.array(z.string()).describe("Artists from the Qloo music results"),
    ambience: z.string(),
    show_tieins: z
      .array(z.object({ artist: z.string(), event: z.string(), date: z.string(), venue: z.string(), idea: z.string() }))
      .describe("Only from nearby_shows results: a pre- or post-event menu or offer per concert or game. Empty array if none."),
  }),
  marketing: z.object({
    target_zones: z.array(z.object({ name: z.string(), reason: z.string() })),
    instagram_post: z.string().describe("Ready to post, max 70 words, 2-4 hashtags"),
    collab_partners: z.array(z.object({ name: z.string(), why: z.string() })),
  }),
  shopping_list: z.array(
    z.object({
      item: z.string(),
      qty: z.number(),
      unit: z.string(),
      supplier_category: z.string(),
      est_cost: z.number(),
    }),
  ),
  week_plan: z
    .array(
      z.object({
        day: z.enum(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]),
        action: z.string().describe("One concrete action, max 18 words"),
        owner: z.string().describe("Who does it: Owner, Kitchen, Front of house or Marketing"),
      }),
    )
    .describe("A 7-day launch plan for next week: order from suppliers, prep, launch dishes, post, run the event, review"),
  caveats: z.array(z.string()),
});

type Emit = (e: AgentEvent) => void;

const FOLLOWUP_SYSTEM = `You are Tastecraft, the taste-intelligence analyst for an independent restaurant. The owner already received a taste playbook and now asks a follow-up question.
Use the Qloo tools to get fresh evidence for this specific question (for example, re-run audience_affinity or taste_tags with a demographic lens, or taste_map). Call independent tools in parallel and keep it to the few calls the question needs.
Then call answer_owner exactly once with a direct, practical answer (max 160 words) and 2-4 concrete Qloo facts, phrased as aggregate tendencies of the restaurant's audience, never as predictions about an individual guest; for each fact list in "cites" the exact names and 0-100 scores as the tools returned them (the server verifies them). Never invent data. Answer in the language the owner asked for (default English).
Before each group of tool calls, write one short sentence (max 15 words) saying what you are checking.`;

function lensFromGoal(req: AgentRequest): Lens | undefined {
  return req.lens && (req.lens.age || req.lens.gender) ? req.lens : undefined;
}

// Harness failures become plain "Error: ..." text for the model. They never stop the run: a 403 on an
// optional workflow (e.g. a key without /v2/trending) is a caveat, not a fatal problem.
function harnessMessage(err: HarnessError, what: string): string {
  const hint =
    err.code === "QLOO_AUTH"
      ? `Qloo refused this request; the key may not include it. Treat ${what} as unavailable and say so in caveats.`
      : err.code === "QLOO_RATE_LIMIT"
        ? "Qloo rate limit reached; skip this for now."
        : err.retryable
          ? "Temporary Qloo problem; do not retry more than once."
          : "Continue without it and mention the gap in caveats.";
  return `${what} unavailable (${err.code}): ${err.message.slice(0, 200)} ${hint}`;
}

function shortMessage(err: unknown): string {
  if (err instanceof QlooError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

export type RunOptions = {
  // The "same model, no Qloo" answer generated in parallel; scored with the same crowd-lift formula.
  baseline?: Promise<string | null>;
};

export async function runTastecraft(req: AgentRequest, emit: Emit, signal?: AbortSignal, opts: RunOptions = {}): Promise<void> {
  const client = new Anthropic();
  const fu = req.followup;
  let restaurant: RestaurantMatch | null = fu
    ? { entity_id: fu.restaurant.entity_id, name: fu.restaurant.name, tags: fu.restaurant.tags, all_tags: fu.restaurant.tags ?? [] }
    : null;
  let published = false;
  const ledger = new EvidenceLedger();

  // A rejected or missing Qloo key will not fix itself: stop the run instead of writing a playbook without data.
  const stopper = new AbortController();
  let fatal: string | null = null;
  const short = (err: unknown): string => {
    if (err instanceof QlooError && (err.code === "QLOO_AUTH" || err.code === "QLOO_CONFIG") && !fatal) {
      fatal = err.message;
      setTimeout(() => stopper.abort(), 0);
    }
    return shortMessage(err);
  };

  const findTool = betaZodTool({
    name: "find_restaurant",
    description:
      "Search Qloo's taste graph for a restaurant by name and city. Returns up to 8 candidates with Qloo entity id, address, tags (cuisine, style), price level and rating, the auto-selected candidate and how sure that match is. Call this first. To switch to another candidate, call it again with that candidate's entity_id.",
    inputSchema: z.object({
      name: z.string(),
      city: z.string(),
      entity_id: z.string().optional().describe("Switch to this candidate (from a previous find_restaurant result)"),
    }),
    run: async ({ name, city, entity_id }, ctx) => {
      const id = ctx?.toolUse.id ?? crypto.randomUUID();
      emit({ type: "tool_start", id, tool: "find_restaurant", label: `Locating ${name} in Qloo’s taste graph`, input: { name, city } });
      try {
        let matches = await findRestaurant(name, city);
        // The owner's own pick always wins over the agent's.
        const preferred = req.entity_id ?? entity_id;
        if (preferred && !matches.some((m) => m.entity_id === preferred)) {
          const direct = await restaurantById(preferred).catch(() => null);
          if (direct) matches = [direct, ...matches];
        }
        const { selected, resolution } = resolveRestaurant(name, city, matches, preferred);
        if (req.entity_id && selected?.entity_id === req.entity_id) resolution.match = "owner_confirmed";
        for (const m of [...(selected ? [selected] : []), ...matches.slice(0, 3)]) {
          ledger.record(m.name, "search", m.popularity != null ? m.popularity * 100 : null);
          m.all_tags.forEach((t) => ledger.record(t, "search"));
        }
        if (selected) {
          restaurant = selected;
          emit({ type: "restaurant", entity: selected, resolution });
        }
        const how = { owner_confirmed: "Confirmed by you", exact: "Exact match", close: "Close match", best_guess: "Best guess" }[resolution.match];
        emit({
          type: "tool_end",
          id,
          tool: "find_restaurant",
          summary: selected
            ? `${how}: ${selected.name}${selected.subtitle ? ` · ${selected.subtitle}` : ""}${resolution.status === "ambiguous" ? " (other candidates fit too)" : ""}`
            : "No match found",
          entities: selected ? [selected, ...matches.filter((m) => m.entity_id !== selected.entity_id)].slice(0, 3) : [],
        });
        return JSON.stringify({
          selected_entity_id: selected?.entity_id ?? null,
          match: resolution.match,
          status: resolution.status,
          note:
            resolution.match === "owner_confirmed"
              ? "The owner confirmed this restaurant. Do not switch."
              : resolution.status === "ambiguous"
                ? "Several candidates could be this restaurant. Keep the selection unless another one clearly fits better; the owner can switch in the app. Mention the ambiguity in caveats."
                : undefined,
          candidates: matches.map((m) => ({
            entity_id: m.entity_id,
            name: m.name,
            address: m.subtitle,
            price_level: m.price_level,
            rating: m.rating,
            popularity: m.popularity,
            tags: m.all_tags.slice(0, 15),
          })),
        });
      } catch (err) {
        emit({ type: "tool_end", id, tool: "find_restaurant", summary: short(err), error: true });
        return `Error: ${short(err)}`;
      }
    },
  });

  const affinityTool = betaZodTool({
    name: "audience_affinity",
    description:
      "What else do people who love the given Qloo entities love? Returns entities of the chosen domain ranked by Qloo affinity (0-1). For domain 'place' results are restricted to the city. Optional demographic lens (age bucket like '24_and_younger', '25_to_29', '30_to_34', '35_to_44', '45_to_54', '55_and_older'; gender 'male' or 'female').",
    inputSchema: z.object({
      entity_ids: z.array(z.string()).min(1).max(5),
      domain: z.enum(DOMAINS),
      city: z.string().optional(),
      take: z.number().int().min(3).max(25).optional(),
      lens_age: z.string().optional(),
      lens_gender: z.enum(["male", "female"]).optional(),
    }),
    run: async (input, ctx) => {
      const id = ctx?.toolUse.id ?? crypto.randomUUID();
      const lens: Lens | undefined =
        input.lens_age || input.lens_gender ? { age: input.lens_age, gender: input.lens_gender } : lensFromGoal(req);
      const label = {
        place: "Places your guests also love nearby",
        brand: "Brands your guests love",
        artist: "Music your guests love",
        movie: "Movies your guests love",
        tv_show: "TV your guests love",
        book: "Books your guests love",
        podcast: "Podcasts your guests love",
        destination: "Places your guests travel to",
      }[input.domain];
      emit({ type: "tool_start", id, tool: "audience_affinity", label: lens ? `${label} (lens: ${[lens.age, lens.gender].filter(Boolean).join(", ")})` : label, input });
      try {
        const results = await audienceAffinity({
          entityIds: input.entity_ids,
          domain: input.domain,
          city: input.city ?? req.city,
          take: input.take,
          lens,
        });
        for (const r of results) {
          ledger.record(r.name, "insights", r.affinity != null ? r.affinity * 100 : null, { affinity: true });
          if (r.popularity != null) ledger.record(r.name, "insights", r.popularity * 100);
          r.tags?.forEach((t) => ledger.record(t, "insights"));
        }
        emit({
          type: "tool_end",
          id,
          tool: "audience_affinity",
          summary: results.length ? `${results.length} results` : "No results",
          entities: results.slice(0, 8),
          domain: lens ? undefined : input.domain,
        });
        return JSON.stringify(
          results.map((r) => ({
            name: r.name,
            entity_id: r.entity_id,
            affinity_0_100: r.affinity != null ? Math.round(r.affinity * 100) : null,
            popularity_0_100: r.popularity != null ? Math.round(r.popularity * 100) : null,
            info: r.subtitle,
            tags: r.tags,
          })),
        );
      } catch (err) {
        emit({ type: "tool_end", id, tool: "audience_affinity", summary: short(err), error: true });
        return `Error: ${short(err)}`;
      }
    },
  });

  const gapsTool = betaZodTool({
    name: "taste_gaps",
    description:
      "Crowd vs city: compares the ~150 restaurants in the city the restaurant's guests love most (Qloo affinity) with the city's ~150 most popular restaurants. Returns menu terms (dishes, ingredients) the crowd's favourite restaurants serve far more or far less often than the city's (lift), and gap tags (cuisines, formats, vibes) over-represented among the crowd's places that this restaurant lacks, each with crowd_pct, city_pct, lift and examples.",
    inputSchema: z.object({
      city: z.string(),
      lens_age: z.string().optional(),
      lens_gender: z.enum(["male", "female"]).optional(),
    }),
    run: async (input, ctx) => {
      const id = ctx?.toolUse.id ?? crypto.randomUUID();
      emit({ type: "tool_start", id, tool: "taste_gaps", label: `Finding taste gaps in ${input.city}`, input });
      if (!restaurant) {
        emit({ type: "tool_end", id, tool: "taste_gaps", summary: "Needs a restaurant first", error: true });
        return "Error: call find_restaurant first.";
      }
      try {
        const lens = input.lens_age || input.lens_gender ? { age: input.lens_age, gender: input.lens_gender } : undefined;
        const { gaps, sampled, menu, crowd_n, city_n } = await tasteGaps({ restaurant, city: input.city, lens });
        for (const g of gaps) {
          ledger.record(g.tag, "taste_gaps", g.crowd_pct);
          ledger.record(g.tag, "taste_gaps", g.city_pct);
          ledger.record(g.tag, "taste_gaps", g.lift);
          g.examples.forEach((ex) => ledger.record(ex, "taste_gaps"));
        }
        for (const t of [...menu.over, ...menu.under]) {
          ledger.record(t.term, "taste_gaps", (t.crowd / Math.max(1, crowd_n)) * 100);
          ledger.record(t.term, "taste_gaps", (t.city / Math.max(1, city_n)) * 100);
          ledger.record(t.term, "taste_gaps", t.lift);
        }
        for (const e of sampled) ledger.record(e.name, "taste_gaps", e.affinity != null ? e.affinity * 100 : null, { affinity: true });
        const pct = (x: number, n: number) => (n ? Math.round((x / n) * 100) : 0);
        const fav = menu.over.slice(0, 3).map((t) => `${t.term} ×${t.lift.toFixed(1)}`);
        emit({
          type: "tool_end",
          id,
          tool: "taste_gaps",
          summary: fav.length
            ? `Your crowd favours: ${fav.join(", ")}`
            : gaps.length
              ? `Top gaps: ${gaps.slice(0, 3).map((g) => g.tag).join(", ")}`
              : "No clear gaps",
          entities: sampled.slice(0, 5),
        });
        return JSON.stringify({
          how: `crowd = the ${crowd_n} restaurants in ${input.city} this restaurant's guests love most (Qloo affinity); city = the ${city_n} most popular restaurants there. pct = share of each set whose Qloo tags include it; lift = how many times more often the crowd's restaurants have it (1 = same as the city, below 1 = the crowd avoids it).`,
          restaurant_tags: restaurant.all_tags.slice(0, 15),
          menu_terms_crowd_favours: menu.over.map((t) => ({
            term: t.term,
            crowd_pct: pct(t.crowd, crowd_n),
            city_pct: pct(t.city, city_n),
            lift: t.lift,
            already_on_your_menu: t.on_your_menu,
          })),
          menu_terms_crowd_avoids: menu.under.map((t) => ({ term: t.term, crowd_pct: pct(t.crowd, crowd_n), city_pct: pct(t.city, city_n), lift: t.lift })),
          gaps: gaps.map((g) => ({ tag: g.tag, crowd_pct: g.crowd_pct, city_pct: g.city_pct, lift: g.lift, examples: g.examples })),
        });
      } catch (err) {
        emit({ type: "tool_end", id, tool: "taste_gaps", summary: short(err), error: true });
        return `Error: ${short(err)}`;
      }
    },
  });

  const mapTool = betaZodTool({
    name: "taste_map",
    description:
      "Heatmap of where in the city people with this restaurant's audience taste concentrate (Qloo heatmap by geohash), plus the names of the top distinct neighborhoods. Use for local marketing, delivery radius and second-location ideas.",
    inputSchema: z.object({ city: z.string() }),
    run: async ({ city }, ctx) => {
      const id = ctx?.toolUse.id ?? crypto.randomUUID();
      emit({ type: "tool_start", id, tool: "taste_map", label: `Mapping where your taste audience lives in ${city}`, input: { city } });
      if (!restaurant) {
        emit({ type: "tool_end", id, tool: "taste_map", summary: "Needs a restaurant first", error: true });
        return "Error: call find_restaurant first.";
      }
      try {
        const { cells, top } = await tasteHeatmap({ entityId: restaurant.entity_id, city, lens: lensFromGoal(req) });
        const zones = await nameZones(top);
        for (const z of zones) ledger.record(z.label, "heatmap", z.affinity * 100, { affinity: true });
        if (cells.length) {
          const center: [number, number] =
            restaurant.lat != null && restaurant.lon != null
              ? [restaurant.lat, restaurant.lon]
              : [cells.reduce((s, c) => s + c.lat, 0) / cells.length, cells.reduce((s, c) => s + c.lon, 0) / cells.length];
          emit({ type: "heatmap", cells, zones, center });
        }
        emit({
          type: "tool_end",
          id,
          tool: "taste_map",
          summary: zones.length ? `Hotspots: ${zones.map((z) => z.label).join(", ")}` : "No heatmap data",
        });
        return JSON.stringify({
          cells_analyzed: cells.length,
          top_zones: zones.map((z) => ({ name: z.label, relative_affinity_0_100: Math.round(z.affinity * 100) })),
        });
      } catch (err) {
        emit({ type: "tool_end", id, tool: "taste_map", summary: short(err), error: true });
        return `Error: ${short(err)}`;
      }
    },
  });

  const tagsTool = betaZodTool({
    name: "taste_tags",
    description:
      "Qloo taste analysis: which tags of a family the restaurant's audience over-indexes on, localised to the city. Families: 'dishes' (specialty dishes and menu highlights), 'cuisines', 'ambience' (vibe, good-for, setting). Returns tags with Qloo affinity (0-1).",
    inputSchema: z.object({
      family: z.enum(Object.keys(TAG_FAMILIES) as [keyof typeof TAG_FAMILIES, ...(keyof typeof TAG_FAMILIES)[]]),
      city: z.string(),
      lens_age: z.string().optional(),
      lens_gender: z.enum(["male", "female"]).optional(),
    }),
    run: async (input, ctx) => {
      const id = ctx?.toolUse.id ?? crypto.randomUUID();
      const label = { dishes: "Dishes your audience craves", cuisines: "Cuisines your audience favours", ambience: "The vibe your audience looks for" }[input.family];
      emit({ type: "tool_start", id, tool: "taste_tags", label, input });
      if (!restaurant) {
        emit({ type: "tool_end", id, tool: "taste_tags", summary: "Needs a restaurant first", error: true });
        return "Error: call find_restaurant first.";
      }
      try {
        const lens = input.lens_age || input.lens_gender ? { age: input.lens_age, gender: input.lens_gender } : undefined;
        const tags = await tasteTags({ entityId: restaurant.entity_id, city: input.city, family: input.family, lens });
        for (const t of tags) ledger.record(t.name, "taste_analysis", t.affinity != null ? t.affinity * 100 : null, { affinity: true });
        if (!lens && tags.length) emit({ type: "taste_tags", family: input.family, tags: tags.map((t) => ({ name: t.name, affinity: t.affinity })) });
        emit({
          type: "tool_end",
          id,
          tool: "taste_tags",
          summary: tags.length ? tags.slice(0, 4).map((t) => t.name).join(" · ") : "No tag data",
        });
        return JSON.stringify(tags.map((t) => ({ tag: t.name, type: t.type, affinity_0_100: t.affinity != null ? Math.round(t.affinity * 100) : null })));
      } catch (err) {
        emit({ type: "tool_end", id, tool: "taste_tags", summary: short(err), error: true });
        return `Error: ${short(err)}`;
      }
    },
  });

  const profileTool = betaZodTool({
    name: "audience_profile",
    description:
      "Qloo demographics for the restaurant's audience: how much each age bucket and gender over-indexes (positive) or under-indexes (negative) compared with the general population.",
    inputSchema: z.object({}),
    run: async (_input, ctx) => {
      const id = ctx?.toolUse.id ?? crypto.randomUUID();
      emit({ type: "tool_start", id, tool: "audience_profile", label: "Who your guests are", input: {} });
      if (!restaurant) {
        emit({ type: "tool_end", id, tool: "audience_profile", summary: "Needs a restaurant first", error: true });
        return "Error: call find_restaurant first.";
      }
      try {
        const d = await audienceDemographics(restaurant.entity_id);
        if (!d) {
          emit({ type: "tool_end", id, tool: "audience_profile", summary: "No demographic data" });
          return "No demographic data available for this restaurant.";
        }
        for (const [k, v] of Object.entries(d.age)) ledger.record(k, "demographics", v * 100);
        for (const [k, v] of Object.entries(d.gender)) ledger.record(k, "demographics", v * 100);
        emit({ type: "demographics", age: d.age, gender: d.gender });
        const topAge = Object.entries(d.age).sort((a, b) => b[1] - a[1])[0];
        emit({ type: "tool_end", id, tool: "audience_profile", summary: topAge ? `Strongest age group: ${topAge[0].replaceAll("_", " ")}` : "Profile ready" });
        return JSON.stringify(d);
      } catch (err) {
        emit({ type: "tool_end", id, tool: "audience_profile", summary: short(err), error: true });
        return `Error: ${short(err)}`;
      }
    },
  });

  const compareTool = betaZodTool({
    name: "compare_rival",
    description:
      "Qloo head-to-head (/v2/analysis/compare) between the restaurant and a rival place: the Qloo tags (vibe, cuisine, occasion, crowd) only the restaurant carries, only the rival carries, and the ones they share. Tags only, no scores. Use the rival's entity_id from audience_affinity results.",
    inputSchema: z.object({ rival_entity_id: z.string(), rival_name: z.string(), city: z.string() }),
    run: async ({ rival_entity_id, rival_name, city }, ctx) => {
      const id = ctx?.toolUse.id ?? crypto.randomUUID();
      emit({ type: "tool_start", id, tool: "compare_rival", label: `Head-to-head with ${rival_name}`, input: { rival_name } });
      if (!restaurant) {
        emit({ type: "tool_end", id, tool: "compare_rival", summary: "Needs a restaurant first", error: true });
        return "Error: call find_restaurant first.";
      }
      try {
        const h2h = await compareAudiences({ a: restaurant.entity_id, b: rival_entity_id, city });
        ledger.record(rival_name, "compare");
        for (const t of [...h2h.onlyA, ...h2h.onlyB, ...h2h.shared]) ledger.record(t, "compare");
        if (h2h.onlyA.length || h2h.onlyB.length) {
          emit({ type: "compare", a: restaurant.name, b: rival_name, only_a: h2h.onlyA, only_b: h2h.onlyB, shared: h2h.shared });
        }
        emit({
          type: "tool_end",
          id,
          tool: "compare_rival",
          summary:
            h2h.onlyA.length || h2h.onlyB.length
              ? `Only you: ${h2h.onlyA.slice(0, 3).join(", ") || "none"} · only ${rival_name}: ${h2h.onlyB.slice(0, 3).join(", ") || "none"}`
              : "No comparison data",
        });
        return JSON.stringify({
          restaurant: restaurant.name,
          rival: rival_name,
          how: "Each place's own Qloo tags compared by name. They describe how Qloo characterises each place (positioning), not a measured difference between their audiences, and carry no score.",
          only_restaurant: h2h.onlyA,
          only_rival: h2h.onlyB,
          shared: h2h.shared,
        });
      } catch (err) {
        emit({ type: "tool_end", id, tool: "compare_rival", summary: short(err), error: true });
        return `Error: ${short(err)}`;
      }
    },
  });

  const risingTool = betaZodTool({
    name: "rising_nearby",
    description:
      "Qloo popularity trends (Qloo's official harness trends workflow over /v2/trending) for 1-5 Qloo place entity_ids: the restaurant plus its highest-affinity local places from audience_affinity, or the rival. For each place: direction (rising, falling, steady or no_data) and the change in popularity percentile points between the first and the last ~30 days of the window. Aggregate popularity, not a cause.",
    inputSchema: z.object({
      entity_ids: z.array(z.string()).min(1).max(5).describe("Qloo place entity_ids exactly as find_restaurant / audience_affinity returned them"),
      days: z.number().int().min(30).max(365).optional().describe("Window length in days, ending today (default 180)"),
    }),
    run: async ({ entity_ids, days }, ctx) => {
      const id = ctx?.toolUse.id ?? crypto.randomUUID();
      emit({ type: "tool_start", id, tool: "rising_nearby", label: "Which places nearby are rising", input: { entity_ids, days: days ?? DEFAULT_TREND_DAYS } });
      const r = await risingNearby(entity_ids, days ?? DEFAULT_TREND_DAYS);
      if (!r.ok && r.kind === "needs_input") {
        emit({ type: "tool_end", id, tool: "rising_nearby", summary: `Needs clearer input: ${r.message}`, error: true });
        return `Error: ${r.message}. Pass entity_ids exactly as find_restaurant or audience_affinity returned them.`;
      }
      if (!r.ok) {
        emit({ type: "tool_end", id, tool: "rising_nearby", summary: `Trends unavailable (${r.error.code})`, error: true });
        return `Error: ${harnessMessage(r.error, "Qloo trends")}`;
      }
      const { window } = r;
      const rows = r.rows.map((row) => ({ s: row, sum: row.summary }));
      for (const { s, sum } of rows) {
        ledger.record(s.name, "trends");
        if (sum.change != null) {
          ledger.record(s.name, "trends", sum.change);
          ledger.record(s.name, "trends", Math.abs(sum.change));
        }
        if (sum.metric === "percentile" && sum.recent != null) ledger.record(s.name, "trends", sum.recent);
      }
      const lines = rows.map(({ s, sum }) => toTrendLine(s, sum));
      if (lines.length) emit({ type: "trends", series: lines });
      const moving = rows.filter(({ sum }) => sum.direction === "rising" || sum.direction === "falling");
      emit({
        type: "tool_end",
        id,
        tool: "rising_nearby",
        summary: moving.length
          ? moving
              .slice(0, 3)
              .map(({ s, sum }) => `${s.name} ${sum.direction === "rising" ? "↑" : "↓"}${Math.abs(sum.change ?? 0)}`)
              .join(" · ")
          : rows.some(({ sum }) => sum.direction === "steady")
            ? "Steady popularity, no big movers"
            : "No trend data from Qloo",
      });
      return JSON.stringify({
        window,
        how: "change = mean popularity percentile (0-100) over the last ~30 days minus the first ~30 days of the data Qloo returned (rank positions gained if Qloo returned only ranks). Steady = within 2 points.",
        places: rows.map(({ s, sum }) => ({
          entity_id: s.entityId,
          name: s.name,
          direction: sum.direction,
          change: sum.change,
          metric: sum.metric,
          recent_level: sum.recent,
          data_points: sum.points.length,
          from: sum.points[0]?.date ?? null,
          to: sum.points.at(-1)?.date ?? null,
        })),
        note: "Aggregate popularity trends: they show momentum, not why it happens.",
      });
    },
  });

  const showsTool = betaZodTool({
    name: "nearby_shows",
    description:
      "Live events near the restaurant (Ticketmaster + Qloo). Lists every concert within ~25 km in the next 5 weeks, ranks the billed artists for this restaurant's audience with Qloo in one call, and returns the best-matched concerts with fan_match (0-100: Qloo affinity of the artist for this audience). With include_sports, also big sports fixtures within ~15 km. `artists` (top artists from audience_affinity with domain 'artist') are only used for a keyword search if Qloo ranking is unavailable.",
    inputSchema: z.object({ artists: z.array(z.string()).min(1).max(8), city: z.string(), include_sports: z.boolean().optional() }),
    run: async ({ artists, city, include_sports }, ctx) => {
      const id = ctx?.toolUse.id ?? crypto.randomUUID();
      emit({
        type: "tool_start",
        id,
        tool: "nearby_shows",
        label: include_sports ? "Concerts your guests would love, and game days nearby" : "Concerts nearby that your guests would love",
        input: { city },
      });
      try {
        let lat = restaurant?.lat;
        let lon = restaurant?.lon;
        if (lat == null || lon == null) {
          const g = await geocodeCity(city);
          lat = g?.lat;
          lon = g?.lon;
        }
        if (lat == null || lon == null) {
          emit({ type: "tool_end", id, tool: "nearby_shows", summary: "No location for the restaurant", error: true });
          return "Error: no location available.";
        }
        const match = await matchConcerts({ lat, lon, city, restaurantId: restaurant?.entity_id, artists });
        const games = include_sports ? await nearbyGames({ lat, lon }) : [];
        const shows = [...match.shows, ...games];
        for (const sh of shows) {
          ledger.record(sh.artist, "ticketmaster", sh.fan_match ?? null, { affinity: true });
          ledger.record(sh.venue, "ticketmaster");
          ledger.record(sh.event, "ticketmaster");
        }
        for (const sc of match.scores) {
          if (sc.fanMatch == null) continue;
          ledger.record(sc.input, "qloo_rank", sc.fanMatch, { affinity: true });
          ledger.record(sc.name, "qloo_rank", sc.fanMatch, { affinity: true });
        }
        if (shows.length) emit({ type: "shows", shows });
        const top = match.shows[0];
        emit({
          type: "tool_end",
          id,
          tool: "nearby_shows",
          summary:
            match.strategy === "qloo_rank"
              ? top
                ? `${match.shows.length} concerts ranked for your crowd · best: ${top.artist}${top.fan_match != null ? ` (fan match ${top.fan_match})` : ""}${games.length ? ` · ${games.length} game days` : ""}`
                : (match.note ?? "No matched concerts nearby")
              : shows.length
                ? `${shows.length} upcoming shows (keyword search) · next: ${shows[0].artist}, ${shows[0].date}`
                : "No upcoming shows nearby",
        });
        return JSON.stringify({
          strategy: match.strategy,
          how:
            match.strategy === "qloo_rank"
              ? "Concerts are ordered by fan_match: Qloo's affinity (0-100) of the billed artist for this restaurant's audience, from one ranking call, so the scores are comparable. Cite fan_match as the score."
              : "Qloo ranking was unavailable, so these are keyword matches for the artists you supplied, without fan_match.",
          note: match.note,
          artists_not_matched_in_qloo: match.dropped.length ? match.dropped : undefined,
          shows: shows.map((s) => ({ artist: s.artist, event: s.event, venue: s.venue, date: s.date, distance_km: s.distance_km, kind: s.kind, fan_match: s.fan_match })),
        });
      } catch (err) {
        emit({ type: "tool_end", id, tool: "nearby_shows", summary: short(err), error: true });
        return `Error: ${short(err)}`;
      }
    },
  });

  const publishTool = {
    ...betaZodTool({
    name: "publish_playbook",
    description: "Publish the final taste playbook to the restaurant owner. Call exactly once, at the end.",
    inputSchema: PlaybookSchema,
    run: async (playbook, ctx) => {
      const id = ctx?.toolUse.id ?? crypto.randomUUID();
      emit({ type: "tool_start", id, tool: "publish_playbook", label: "Writing your playbook", input: {} });
      published = true;
      const pb = playbook as Playbook;
      let checked = 0;
      let verified = 0;
      pb.menu_moves = pb.menu_moves.map((m) => {
        const v = ledger.verify(m.evidence);
        checked += v.checked;
        verified += v.verified;
        return { ...m, evidence: v.items };
      });
      pb.verification = { checked, verified, qloo_facts: ledger.size };
      pb.crowd_lift = await crowdLiftFor(pb, restaurant?.entity_id ?? pb.restaurant.qloo_entity_id, req.city, opts.baseline);
      emit({ type: "playbook", playbook: pb });
      emit({ type: "tool_end", id, tool: "publish_playbook", summary: "Playbook ready" });
      return "Published.";
    },
    }),
    // Stream the playbook as it is written so the UI can draft it live.
    eager_input_streaming: true,
  };

  const answerTool = betaZodTool({
    name: "answer_owner",
    description: "Deliver the answer to the owner's follow-up question. Call exactly once, at the end.",
    inputSchema: z.object({
      answer: z.string().describe("Direct, practical answer, max 160 words"),
      evidence: z.array(EvidenceSchema).describe("2-4 concrete Qloo facts"),
    }),
    run: async ({ answer, evidence }, ctx) => {
      const id = ctx?.toolUse.id ?? crypto.randomUUID();
      emit({ type: "tool_start", id, tool: "answer_owner", label: "Answering your question", input: {} });
      published = true;
      emit({ type: "answer", question: fu?.question ?? "", answer, evidence: ledger.verify(evidence).items });
      emit({ type: "tool_end", id, tool: "answer_owner", summary: "Answer ready" });
      return "Delivered.";
    },
  });

  const goal = req.goal?.trim() || "grow the business";
  const userMessage = `Restaurant: ${req.restaurant}\nCity: ${req.city}\nOwner's goal: ${goal}
Playbook language: ${req.language ?? "English"}${
    req.lens?.age || req.lens?.gender ? `\nAudience lens: ${JSON.stringify(req.lens)}` : ""
  }\n\nBuild their taste playbook.`;

  const followupMessage = fu
    ? `Restaurant: ${fu.restaurant.name} (Qloo entity_id ${fu.restaurant.entity_id})
City: ${req.city}
Tags: ${(fu.restaurant.tags ?? []).join(", ")}
Playbook headline so far: ${fu.playbook_headline ?? "n/a"}
Answer language: ${req.language ?? "English"}

Owner's question: ${fu.question}`
    : null;

  const runner = client.beta.messages.toolRunner(
    {
      model: MODEL,
      max_tokens: 16000,
      max_iterations: fu ? 8 : 16,
      system: fu ? FOLLOWUP_SYSTEM : SYSTEM,
      cache_control: { type: "ephemeral" },
      output_config: { effort: "medium" },
      thinking: { type: "adaptive", display: "updates" },
      betas: ["server-side-fallback-2026-07-01", "thinking-display-updates-2026-08-18"],
      fallbacks: "default",
      stream: true,
      tools: fu
        ? [affinityTool, tagsTool, profileTool, compareTool, gapsTool, mapTool, ...(PLACE_TRENDS ? [risingTool] : []), answerTool]
        : [
            findTool,
            affinityTool,
            tagsTool,
            profileTool,
            compareTool,
            gapsTool,
            mapTool,
            ...(PLACE_TRENDS ? [risingTool] : []),
            ...(showsConfigured() ? [showsTool] : []),
            publishTool,
          ],
      messages: [{ role: "user", content: followupMessage ?? userMessage }],
    },
    { signal: signal ? AbortSignal.any([signal, stopper.signal]) : stopper.signal },
  );

  let lastDraftAt = 0;
  let draftId: string | null = null;
  const usage = { input: 0, cache_write: 0, cache_read: 0, output: 0, turns: 0 };
  try {
    for await (const stream of runner) {
      stream.on("streamEvent", (event, snapshot) => {
        if (event.type !== "content_block_delta" || event.delta.type !== "input_json_delta") return;
        const block = snapshot.content[event.index];
        if (!block || block.type !== "tool_use" || block.name !== "publish_playbook") return;
        if (!draftId) {
          draftId = `draft-${block.id}`;
          emit({ type: "tool_start", id: draftId, tool: "draft_playbook", label: "Drafting your playbook", input: {} });
        }
        const now = Date.now();
        if (now - lastDraftAt < 700) return;
        lastDraftAt = now;
        emit({ type: "playbook_draft", draft: (block.input ?? {}) as Record<string, unknown> });
      });
      const message = await stream.finalMessage();
      usage.turns += 1;
      usage.input += message.usage.input_tokens ?? 0;
      usage.cache_write += message.usage.cache_creation_input_tokens ?? 0;
      usage.cache_read += message.usage.cache_read_input_tokens ?? 0;
      usage.output += message.usage.output_tokens ?? 0;
      if (draftId) {
        emit({ type: "tool_end", id: draftId, tool: "draft_playbook", summary: "Draft complete" });
        draftId = null;
      }
      for (const block of message.content) {
        if (block.type === "text" && block.text.trim()) emit({ type: "note", text: block.text.trim() });
        if (block.type === "thinking" && block.thinking.trim()) emit({ type: "note", text: block.thinking.trim() });
      }
      if (message.stop_reason === "refusal") {
        emit({ type: "error", message: "The model declined this request. Try another restaurant." });
        return;
      }
    }
  } catch (err) {
    if (fatal) {
      emit({ type: "error", message: fatal });
      return;
    }
    throw err;
  } finally {
    // Token accounting for budget tracking (counts only: no content, no keys).
    console.info(`[tastecraft] ${fu ? "followup" : "playbook"} usage ${MODEL}: ${JSON.stringify(usage)}`);
  }
  if (fatal && !published) {
    emit({ type: "error", message: fatal });
    return;
  }
  if (!published) emit({ type: "error", message: fu ? "The agent stopped before answering. Please try again." : "The agent stopped before publishing a playbook. Please try again." });
}

async function geocodeCity(city: string): Promise<{ lat: number; lon: number } | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(city)}`,
      { headers: { "User-Agent": "Tastecraft/1.0 (Qloo hackathon demo)" }, signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return null;
    const [hit] = (await res.json()) as Array<{ lat: string; lon: string }>;
    return hit ? { lat: Number(hit.lat), lon: Number(hit.lon) } : null;
  } catch {
    return null;
  }
}

// Crowd lift of the plan's dishes and, with the same Qloo sets, of the no-Qloo baseline's dishes.
// Best effort: a Qloo failure here leaves the playbook without a score rather than failing it.
async function crowdLiftFor(
  pb: Playbook,
  entityId: string | null | undefined,
  city: string,
  baseline: Promise<string | null> | undefined,
): Promise<CrowdLift | undefined> {
  if (!entityId) return undefined;
  try {
    const sets = menuSets(await crowdAndCity({ entityId, city }));
    if (!sets.crowd.length || !sets.city.length) return undefined;
    const plan = planLift(
      pb.menu_moves.map((m) => m.dish),
      sets,
    );
    pb.menu_moves.forEach((m, i) => {
      m.lift = plan.dishes[i]?.lift ?? null;
      m.lift_terms = plan.dishes[i]?.terms ?? [];
    });
    const result: CrowdLift = {
      score: plan.lift,
      matched: plan.matched,
      total: plan.total,
      crowd_n: plan.crowd_n,
      city_n: plan.city_n,
      city,
    };
    const text = baseline
      ? await Promise.race([baseline.catch(() => null), new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000))])
      : null;
    const dishes = text ? parseBaselineDishes(text) : [];
    if (dishes.length) {
      const b = planLift(dishes, sets);
      result.baseline = {
        score: b.lift,
        matched: b.matched,
        total: b.total,
        dishes: b.dishes.map((d) => ({ dish: d.dish, lift: d.lift, terms: d.terms })),
      };
    }
    return result;
  } catch (err) {
    console.warn(`[tastecraft] crowd lift unavailable: ${shortMessage(err)}`);
    return undefined;
  }
}

// Same model, no tools, no Qloo: the "generic AI" answer we show side by side. The fixed line
// format lets Tastecraft score its three dishes with the same crowd-lift formula as the playbook.
export function baselinePrompt(req: AgentRequest): string {
  return `I own the restaurant "${req.restaurant}" in ${req.city}. My goal: ${req.goal || "grow the business"}. Suggest three dishes to add and one event idea. Plain text, max 90 words, no markdown. Answer in ${req.language ?? "English"}, but keep these English line labels exactly:
Dish 1: <dish name> | <why, one short sentence>
Dish 2: <dish name> | <why>
Dish 3: <dish name> | <why>
Event: <event idea>`;
}

export async function genericBaseline(req: AgentRequest): Promise<string> {
  const client = new Anthropic();
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1200,
    output_config: { effort: "low" },
    messages: [{ role: "user", content: baselinePrompt(req) }],
  });
  console.info(`[tastecraft] baseline usage ${MODEL}: ${JSON.stringify({ input: res.usage.input_tokens, output: res.usage.output_tokens })}`);
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}
