// The Tastecraft agent: Claude + Qloo tools, driven by the SDK's tool runner.
// Every tool call is mirrored to the UI as events so the user can watch the agent work.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { QlooError } from "./qloo";
import {
  DOMAINS,
  TAG_FAMILIES,
  audienceAffinity,
  audienceDemographics,
  compareAudiences,
  nearbyShows,
  showsConfigured,
  tasteTags,
  findRestaurant,
  nameZones,
  tasteGaps,
  tasteHeatmap,
  type Lens,
  type RestaurantMatch,
} from "./qloo-tasks";
import type { AgentEvent, AgentRequest, Playbook } from "./types";

const MODEL = process.env.TASTECRAFT_MODEL || "claude-opus-5-5";

const SYSTEM = `You are Tastecraft, the taste-intelligence analyst for independent restaurants. Chains have insight teams; your job is to give a small restaurant the same edge using Qloo's taste graph (cross-domain affinity data across places, brands, music, film, TV, books and more).

How you work:
1. Locate the restaurant with find_restaurant. If several candidates come back, pick the one whose address matches the city; if none matches, say so in a note and work at city level using the concept the owner described.
2. Build the audience's taste DNA with audience_affinity. Always run "place" (local places the same guests love). Then pick the 3 other domains most useful for the owner's goal (usually artist, brand and one of movie/tv_show/podcast). Call independent tools in parallel.
3. Run taste_tags for "dishes", "cuisines" and "ambience" (in parallel) to learn which specific dishes, cuisines and vibes this audience over-indexes on in this city, and audience_profile to learn their age and gender skew.
4. Pick the closest rival from the "place" results (similar cuisine and price, high affinity) and run compare_rival to learn what distinguishes the two audiences.
5. Run taste_gaps to see which cuisines, dishes and formats the guests love nearby that this restaurant does not offer.
6. If the nearby_shows tool is available, run it with the top artists from the music results to find upcoming concerts near the restaurant, and turn the best ones into pre- or post-show ideas.
7. Run taste_map to see where in the city people with this taste live and go out.
8. If the goal is about a specific audience (younger crowd, families, women, men), run one audience_affinity or taste_gaps call with the matching lens and compare.
9. Finish by calling publish_playbook exactly once.
If a tool returns an error or no data, do not retry it more than once; continue with what you have and mention the gap in caveats.

Rules for the playbook:
- Every menu move, event and marketing idea must be justified by concrete Qloo evidence: name the places, artists or brands and quote their affinity scores (as 0-100) exactly as the tools returned them. Never invent a score, a place or a statistic.
- Write evidence the way you would tell an owner, not an analyst: "Vermouth scores 95/100 with your crowd", "4 of the 10 places your guests love most serve natural wine (e.g. X, Y)". Never expose internal field names such as weighted_score, share_of_loved_places_pct or entity ids.
- Be specific to this restaurant, this city and the owner's goal. Avoid generic advice that any restaurant could get.
- Menu moves must be realistic for the restaurant's kitchen and price level. Prices and costs are in the local currency.
- The shopping list covers the ingredients for testing the three menu moves for one week in a small restaurant (realistic quantities, supplier categories such as produce, meat, fish, dairy, dry goods, drinks).
- target_zones should use the neighborhood names returned by taste_map.
- week_plan turns everything into next week's schedule (supplier order early in the week, launch, posts timed to when the audience goes out, the event, a review of results).
- In caveats, state honestly what the data cannot tell (e.g. missing data, small samples).
- Write in clear, warm, practical language for a busy owner, in the language the owner asked for (default English). Keep proper names as they are.

Before each group of tool calls, write one short sentence (max 15 words) saying what you are checking and why. After publish_playbook, reply with a single short sentence.`;

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
        evidence: z.array(z.string()).describe("2-3 concrete Qloo facts with scores"),
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
      .describe("Only from nearby_shows results: a pre- or post-show menu or offer per show. Empty array if none."),
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
Then call answer_owner exactly once with a direct, practical answer (max 160 words) and 2-4 concrete Qloo facts with scores exactly as the tools returned them. Never invent data. Answer in the language the owner asked for (default English).
Before each group of tool calls, write one short sentence (max 15 words) saying what you are checking.`;

function lensFromGoal(req: AgentRequest): Lens | undefined {
  return req.lens && (req.lens.age || req.lens.gender) ? req.lens : undefined;
}

function short(err: unknown): string {
  if (err instanceof QlooError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

export async function runTastecraft(req: AgentRequest, emit: Emit, signal?: AbortSignal): Promise<void> {
  const client = new Anthropic();
  const fu = req.followup;
  let restaurant: RestaurantMatch | null = fu
    ? { entity_id: fu.restaurant.entity_id, name: fu.restaurant.name, tags: fu.restaurant.tags, all_tags: fu.restaurant.tags ?? [] }
    : null;
  let published = false;

  const findTool = betaZodTool({
    name: "find_restaurant",
    description:
      "Search Qloo's taste graph for a restaurant by name and city. Returns up to 8 candidates with Qloo entity id, address, tags (cuisine, style), price level and rating. Call this first.",
    inputSchema: z.object({ name: z.string(), city: z.string() }),
    run: async ({ name, city }, ctx) => {
      const id = ctx?.toolUse.id ?? crypto.randomUUID();
      emit({ type: "tool_start", id, tool: "find_restaurant", label: `Locating ${name} in Qloo’s taste graph`, input: { name, city } });
      try {
        const matches = await findRestaurant(name, city);
        if (matches[0]) {
          restaurant = matches[0];
          emit({ type: "restaurant", entity: matches[0] });
        }
        emit({
          type: "tool_end",
          id,
          tool: "find_restaurant",
          summary: matches[0] ? `Found ${matches[0].name}${matches[0].subtitle ? ` · ${matches[0].subtitle}` : ""}` : "No match found",
          entities: matches.slice(0, 3),
        });
        return JSON.stringify(
          matches.map((m) => ({
            entity_id: m.entity_id,
            name: m.name,
            address: m.subtitle,
            price_level: m.price_level,
            rating: m.rating,
            popularity: m.popularity,
            tags: m.all_tags.slice(0, 15),
          })),
        );
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
      "Computes taste gaps: tags (cuisines, dishes, formats, vibes) that are over-represented among the ~50 local places the restaurant's guests love most, weighted by Qloo affinity, excluding tags the restaurant already has. Returns each tag with a weighted score, the share of sampled places that carry it and example places.",
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
        const { gaps, sampled } = await tasteGaps({ restaurant, city: input.city, lens });
        emit({
          type: "tool_end",
          id,
          tool: "taste_gaps",
          summary: gaps.length ? `Top gaps: ${gaps.slice(0, 3).map((g) => g.tag).join(", ")}` : "No clear gaps",
          entities: sampled.slice(0, 5),
        });
        return JSON.stringify({
          restaurant_tags: restaurant.all_tags.slice(0, 15),
          gaps: gaps.map((g) => ({
            tag: g.tag,
            weighted_score: Number(g.score.toFixed(2)),
            share_of_loved_places_pct: Math.round(g.share * 100),
            examples: g.examples,
          })),
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
      "Qloo head-to-head analysis between the restaurant's audience (a) and a rival place's audience (b): returns the taste tags that most distinguish them. Use the rival's entity_id from audience_affinity results.",
    inputSchema: z.object({ rival_entity_id: z.string(), rival_name: z.string(), city: z.string() }),
    run: async ({ rival_entity_id, rival_name, city }, ctx) => {
      const id = ctx?.toolUse.id ?? crypto.randomUUID();
      emit({ type: "tool_start", id, tool: "compare_rival", label: `Head-to-head with ${rival_name}`, input: { rival_name } });
      if (!restaurant) {
        emit({ type: "tool_end", id, tool: "compare_rival", summary: "Needs a restaurant first", error: true });
        return "Error: call find_restaurant first.";
      }
      try {
        const tags = await compareAudiences({ a: restaurant.entity_id, b: rival_entity_id, city });
        if (tags.length) emit({ type: "compare", a: restaurant.name, b: rival_name, tags: tags.slice(0, 10) });
        emit({
          type: "tool_end",
          id,
          tool: "compare_rival",
          summary: tags.length ? `Distinctive: ${tags.slice(0, 3).map((t) => t.name).join(", ")}` : "No comparison data",
        });
        return JSON.stringify({ restaurant: restaurant.name, rival: rival_name, distinguishing_tags: tags.map((t) => ({ tag: t.name, type: t.type, score: t.score })) });
      } catch (err) {
        emit({ type: "tool_end", id, tool: "compare_rival", summary: short(err), error: true });
        return `Error: ${short(err)}`;
      }
    },
  });

  const showsTool = betaZodTool({
    name: "nearby_shows",
    description:
      "Upcoming concerts (Ticketmaster) within ~25 km of the restaurant by the given artists, sorted by date. Use the artists your guests love most (from audience_affinity with domain 'artist').",
    inputSchema: z.object({ artists: z.array(z.string()).min(1).max(8), city: z.string() }),
    run: async ({ artists, city }, ctx) => {
      const id = ctx?.toolUse.id ?? crypto.randomUUID();
      emit({ type: "tool_start", id, tool: "nearby_shows", label: "Concerts nearby by artists your guests love", input: { artists } });
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
        const shows = await nearbyShows({ artists, lat, lon });
        if (shows.length) emit({ type: "shows", shows });
        emit({
          type: "tool_end",
          id,
          tool: "nearby_shows",
          summary: shows.length ? `${shows.length} upcoming shows · next: ${shows[0].artist}, ${shows[0].date}` : "No upcoming shows nearby",
        });
        return JSON.stringify(shows);
      } catch (err) {
        emit({ type: "tool_end", id, tool: "nearby_shows", summary: short(err), error: true });
        return `Error: ${short(err)}`;
      }
    },
  });

  const publishTool = betaZodTool({
    name: "publish_playbook",
    description: "Publish the final taste playbook to the restaurant owner. Call exactly once, at the end.",
    inputSchema: PlaybookSchema,
    run: async (playbook, ctx) => {
      const id = ctx?.toolUse.id ?? crypto.randomUUID();
      emit({ type: "tool_start", id, tool: "publish_playbook", label: "Writing your playbook", input: {} });
      published = true;
      emit({ type: "playbook", playbook: playbook as Playbook });
      emit({ type: "tool_end", id, tool: "publish_playbook", summary: "Playbook ready" });
      return "Published.";
    },
  });

  const answerTool = betaZodTool({
    name: "answer_owner",
    description: "Deliver the answer to the owner's follow-up question. Call exactly once, at the end.",
    inputSchema: z.object({
      answer: z.string().describe("Direct, practical answer, max 160 words"),
      evidence: z.array(z.string()).describe("2-4 concrete Qloo facts with scores"),
    }),
    run: async ({ answer, evidence }, ctx) => {
      const id = ctx?.toolUse.id ?? crypto.randomUUID();
      emit({ type: "tool_start", id, tool: "answer_owner", label: "Answering your question", input: {} });
      published = true;
      emit({ type: "answer", question: fu?.question ?? "", answer, evidence });
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
      tools: fu
        ? [affinityTool, tagsTool, profileTool, compareTool, gapsTool, mapTool, answerTool]
        : [
            findTool,
            affinityTool,
            tagsTool,
            profileTool,
            compareTool,
            gapsTool,
            mapTool,
            ...(showsConfigured() ? [showsTool] : []),
            publishTool,
          ],
      messages: [{ role: "user", content: followupMessage ?? userMessage }],
    },
    { signal },
  );

  for await (const message of runner) {
    for (const block of message.content) {
      if (block.type === "text" && block.text.trim()) emit({ type: "note", text: block.text.trim() });
      if (block.type === "thinking" && block.thinking.trim()) emit({ type: "note", text: block.thinking.trim() });
    }
    if (message.stop_reason === "refusal") {
      emit({ type: "error", message: "The model declined this request. Try another restaurant." });
      return;
    }
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

// Same model, no tools, no Qloo: the "generic AI" answer we show side by side.
export async function genericBaseline(req: AgentRequest): Promise<string> {
  const client = new Anthropic();
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1200,
    output_config: { effort: "low" },
    messages: [
      {
        role: "user",
        content: `I own the restaurant "${req.restaurant}" in ${req.city}. My goal: ${req.goal || "grow the business"}. Suggest three dishes to add and one event idea. Plain text, max 90 words, no markdown. Answer in ${req.language ?? "English"}.`,
      },
    ],
  });
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}
