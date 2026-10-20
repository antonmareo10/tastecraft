// DEV-ONLY synthetic events to review the UI before the Qloo key arrives.
// Enabled only when NODE_ENV=development AND TASTECRAFT_FIXTURE=1. Never shipped as real data.
import ngeohash from "ngeohash";
import type { AgentEvent, HeatCell, TrendLine } from "@/lib/types";

function cells(): HeatCell[] {
  const out: HeatCell[] = [];
  const base = ngeohash.encode(40.4153, -3.7074, 6);
  const seen = new Set<string>([base]);
  let frontier = [base];
  for (let ring = 0; ring < 5; ring++) {
    const next: string[] = [];
    for (const g of frontier) for (const n of ngeohash.neighbors(g)) {
      if (!seen.has(n)) {
        seen.add(n);
        next.push(n);
      }
    }
    frontier = next;
  }
  for (const g of seen) {
    const [a, b, c, d] = ngeohash.decode_bbox(g);
    const { latitude, longitude } = ngeohash.decode(g);
    const dist = Math.hypot(latitude - 40.425, (longitude + 3.70) * 0.8);
    out.push({ geohash: g, lat: latitude, lon: longitude, bbox: [a, b, c, d], affinity: Math.max(0, 1 - dist * 18 + Math.sin(latitude * 900) * 0.15) });
  }
  return out;
}

// 26 weekly points of a synthetic popularity percentile (0-100) moving by `slope` points per week.
function trend(entity_id: string, name: string, base: number, slope: number, direction: TrendLine["direction"], change: number | null): TrendLine {
  const t0 = Date.parse("2026-04-20T00:00:00Z");
  const points =
    direction === "no_data"
      ? []
      : Array.from({ length: 26 }, (_, i) => ({
          date: new Date(t0 + i * 7 * 86_400_000).toISOString().slice(0, 10),
          value: Number((base + slope * i + Math.sin(i * 1.3) * 0.8).toFixed(2)),
        }));
  return { entity_id, name, direction, change, metric: "percentile", points };
}

export const FIXTURE: AgentEvent[] = [
  { type: "note", text: "[DEV FIXTURE] Locating the restaurant first, then reading its audience." },
  { type: "tool_start", id: "t1", tool: "find_restaurant", label: "Locating Casa Lucio in Qloo’s taste graph", input: {} },
  { type: "restaurant", entity: { entity_id: "dev-1", name: "Casa Lucio", subtitle: "Calle Cava Baja 35, Madrid", tags: ["Spanish", "Tapas", "Traditional"], lat: 40.4123, lon: -3.7089 }, resolution: { status: "ambiguous", match: "exact", alternatives: [{ entity_id: "dev-2", name: "Casa Lucio", subtitle: "Calle de Alcalá 99, Madrid" }, { entity_id: "dev-3", name: "Lucio Bistró", subtitle: "Calle Mayor 12, Madrid" }] } },
  { type: "tool_end", id: "t1", tool: "find_restaurant", summary: "Found Casa Lucio · Calle Cava Baja 35" },
  { type: "tool_start", id: "t2", tool: "audience_affinity", label: "Places your guests also love nearby", input: {} },
  { type: "tool_end", id: "t2", tool: "audience_affinity", summary: "12 results", domain: "place", entities: [
    { entity_id: "p1", name: "Sample Bodega", affinity: 0.92 }, { entity_id: "p2", name: "Sample Vermutería", affinity: 0.88 }, { entity_id: "p3", name: "Sample Asador", affinity: 0.81 }, { entity_id: "p4", name: "Sample Taberna", affinity: 0.77 } ] },
  { type: "tool_start", id: "t2b", tool: "rising_nearby", label: "Which places nearby are rising", input: {} },
  { type: "trends", series: [
    trend("dev-1", "Casa Lucio", 71, 0.05, "steady", 1),
    trend("p2", "Sample Vermutería", 58, 0.5, "rising", 12),
    trend("p1", "Sample Bodega", 66, 0.2, "rising", 5),
    trend("p3", "Sample Asador", 74, -0.3, "falling", -7),
    trend("p4", "Sample Taberna", 0, 0, "no_data", null),
  ] },
  { type: "tool_end", id: "t2b", tool: "rising_nearby", summary: "Sample Vermutería ↑12 · Sample Bodega ↑5 · Sample Asador ↓7" },
  { type: "tool_start", id: "t3", tool: "audience_affinity", label: "Music your guests love", input: {} },
  { type: "tool_end", id: "t3", tool: "audience_affinity", summary: "12 results", domain: "artist", entities: [
    { entity_id: "a1", name: "Sample Artist A", affinity: 0.9 }, { entity_id: "a2", name: "Sample Artist B", affinity: 0.84 }, { entity_id: "a3", name: "Sample Artist C", affinity: 0.71 } ] },
  { type: "tool_start", id: "t4", tool: "taste_tags", label: "Dishes your audience craves", input: {} },
  { type: "taste_tags", family: "dishes", tags: [{ name: "Croquetas", affinity: 0.93 }, { name: "Vermouth", affinity: 0.86 }, { name: "Huevos rotos", affinity: 0.8 }] },
  { type: "taste_tags", family: "ambience", tags: [{ name: "Lively", affinity: 0.9 }, { name: "Late night", affinity: 0.82 }] },
  { type: "tool_end", id: "t4", tool: "taste_tags", summary: "Croquetas · Vermouth · Huevos rotos" },
  { type: "demographics", age: { "24_and_younger": -0.2, "25_to_29": 0.35, "30_to_34": 0.5, "35_to_44": 0.2, "45_to_54": -0.1, "55_and_older": -0.3 }, gender: { male: 0.05, female: -0.05 } },
  { type: "tool_start", id: "t5", tool: "taste_map", label: "Mapping where your taste audience lives in Madrid", input: {} },
  { type: "heatmap", cells: cells(), zones: [ { label: "Malasaña", lat: 40.4255, lon: -3.7043, affinity: 1 }, { label: "Lavapiés", lat: 40.4085, lon: -3.7006, affinity: 0.84 }, { label: "Chamberí", lat: 40.4345, lon: -3.7038, affinity: 0.76 } ], center: [40.4153, -3.7074] },
  { type: "tool_end", id: "t5", tool: "taste_map", summary: "Hotspots: Malasaña, Lavapiés, Chamberí" },
  { type: "tool_start", id: "t5b", tool: "nearby_shows", label: "Concerts nearby that your guests would love", input: {} },
  { type: "shows", shows: [
    { artist: "Sample Artist A", event: "Sample Artist A live", venue: "Sample Hall", date: "2026-11-07", distance_km: 1.8, fan_match: 87 },
    { artist: "Sample Artist C", event: "Sample Artist C in concert", venue: "Sample Club", date: "2026-11-14", distance_km: 3.2, fan_match: 64 },
  ] },
  { type: "tool_end", id: "t5b", tool: "nearby_shows", summary: "2 concerts ranked for your crowd · best: Sample Artist A (fan match 87)" },
  { type: "baseline", text: "[DEV FIXTURE] Generic answer: add a seasonal tapas board, a vegan paella and a dessert tasting; host a flamenco night." },
  { type: "tool_start", id: "t6", tool: "publish_playbook", label: "Writing your playbook", input: {} },
  { type: "playbook", playbook: {
    restaurant: { name: "Casa Lucio", city: "Madrid", concept: "Classic Castilian tavern, mid-high price", qloo_entity_id: "dev-1" },
    currency: "EUR",
    headline: "[DEV FIXTURE] Your guests are vermouth-hour regulars who live 15 minutes north.",
    audience_dna: { summary: "[DEV FIXTURE] Synthetic summary for layout review.", signals: [] },
    taste_gaps: [ { tag: "Vermouth bar", evidence: "Sample evidence", opportunity: "Sample opportunity text for layout." }, { tag: "Late-night menu", evidence: "Sample evidence", opportunity: "Sample opportunity text." } ],
    menu_moves: [
      { dish: "Sample dish one", description: "Layout text.", price: 14, why: "Layout text.", evidence: [{ text: "Sample fact 1", cites: [{ name: "Croquetas", score: 93 }], verified: true }, { text: "Sample fact 2", cites: [{ name: "Unknown", score: 50 }], verified: false }], ingredients: [], lift: 2.1, lift_terms: [{ term: "Sample term", crowd: 9, city: 4, lift: 2.1 }] },
      { dish: "Sample dish two", description: "Layout text.", price: 9.5, why: "Layout text.", evidence: [{ text: "Sample fact 1", cites: [{ name: "Vermouth", score: 86 }], verified: true }], ingredients: [], lift: 1.4, lift_terms: [{ term: "Sample term", crowd: 6, city: 4, lift: 1.4 }] },
      { dish: "Sample dish three", description: "Layout text.", price: 12, why: "Layout text.", evidence: [{ text: "Sample fact 1", cites: [{ name: "Vermouth", score: 86 }], verified: true }], ingredients: [], lift: 1.4, lift_terms: [{ term: "Sample term", crowd: 6, city: 4, lift: 1.4 }] },
    ],
    experience: {
      event_idea: "Sample event title",
      event_why: "Layout text.",
      playlist: ["Sample Artist A", "Sample Artist B"],
      ambience: "Layout text.",
      show_tieins: [
        { artist: "Sample Artist A", event: "Sample Artist A live", date: "2026-11-07", venue: "Sample Hall", idea: "Layout text for a pre-show menu idea." },
        { artist: "Sample Artist C", event: "Sample Artist C in concert", date: "2026-11-14", venue: "Sample Club", idea: "Layout text for a post-show offer." },
      ],
    },
    marketing: { target_zones: [ { name: "Malasaña", reason: "Layout text." }, { name: "Lavapiés", reason: "Layout text." }, { name: "Chamberí", reason: "Layout text." } ], instagram_post: "Sample post text #madrid", collab_partners: [ { name: "Sample partner", why: "Layout text." } ] },
    shopping_list: [ { item: "Sample item", qty: 3, unit: "kg", supplier_category: "Produce", est_cost: 12.4 }, { item: "Sample item 2", qty: 6, unit: "bottles", supplier_category: "Drinks", est_cost: 54 } ],
    week_plan: [
      { day: "Mon", action: "Order vermouth and produce for the test week", owner: "Owner" },
      { day: "Tue", action: "Prep and taste the three new dishes", owner: "Kitchen" },
      { day: "Wed", action: "Launch specials and post the board", owner: "Marketing" },
      { day: "Thu", action: "Run the event", owner: "Front of house" },
      { day: "Sun", action: "Review sales of each new dish", owner: "Owner" },
    ],
    caveats: ["[DEV FIXTURE] synthetic data"],
    verification: { checked: 4, verified: 3, qloo_facts: 40 },
    crowd_lift: { score: 1.6, matched: 3, total: 3, crowd_n: 140, city_n: 140, city: "Madrid", baseline: { score: 0.9, matched: 2, total: 3, dishes: [] } },
  } },
  { type: "tool_end", id: "t6", tool: "publish_playbook", summary: "Playbook ready" },
];
