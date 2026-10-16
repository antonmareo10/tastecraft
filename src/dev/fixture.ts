// DEV-ONLY synthetic events to review the UI before the Qloo key arrives.
// Enabled only when NODE_ENV=development AND TASTECRAFT_FIXTURE=1. Never shipped as real data.
import ngeohash from "ngeohash";
import type { AgentEvent, HeatCell } from "@/lib/types";

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

export const FIXTURE: AgentEvent[] = [
  { type: "note", text: "[DEV FIXTURE] Locating the restaurant first, then reading its audience." },
  { type: "tool_start", id: "t1", tool: "find_restaurant", label: "Locating Casa Lucio in Qloo’s taste graph", input: {} },
  { type: "restaurant", entity: { entity_id: "dev-1", name: "Casa Lucio", subtitle: "Calle Cava Baja 35, Madrid", tags: ["Spanish", "Tapas", "Traditional"], lat: 40.4123, lon: -3.7089 } },
  { type: "tool_end", id: "t1", tool: "find_restaurant", summary: "Found Casa Lucio · Calle Cava Baja 35" },
  { type: "tool_start", id: "t2", tool: "audience_affinity", label: "Places your guests also love nearby", input: {} },
  { type: "tool_end", id: "t2", tool: "audience_affinity", summary: "12 results", domain: "place", entities: [
    { entity_id: "p1", name: "Sample Bodega", affinity: 0.92 }, { entity_id: "p2", name: "Sample Vermutería", affinity: 0.88 }, { entity_id: "p3", name: "Sample Asador", affinity: 0.81 }, { entity_id: "p4", name: "Sample Taberna", affinity: 0.77 } ] },
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
  { type: "baseline", text: "[DEV FIXTURE] Generic answer: add a seasonal tapas board, a vegan paella and a dessert tasting; host a flamenco night." },
  { type: "tool_start", id: "t6", tool: "publish_playbook", label: "Writing your playbook", input: {} },
  { type: "playbook", playbook: {
    restaurant: { name: "Casa Lucio", city: "Madrid", concept: "Classic Castilian tavern, mid-high price", qloo_entity_id: "dev-1" },
    currency: "EUR",
    headline: "[DEV FIXTURE] Your guests are vermouth-hour regulars who live 15 minutes north.",
    audience_dna: { summary: "[DEV FIXTURE] Synthetic summary for layout review.", signals: [] },
    taste_gaps: [ { tag: "Vermouth bar", evidence: "Sample evidence", opportunity: "Sample opportunity text for layout." }, { tag: "Late-night menu", evidence: "Sample evidence", opportunity: "Sample opportunity text." } ],
    menu_moves: [
      { dish: "Sample dish one", description: "Layout text.", price: 14, why: "Layout text.", evidence: ["Sample fact 1", "Sample fact 2"], ingredients: [] },
      { dish: "Sample dish two", description: "Layout text.", price: 9.5, why: "Layout text.", evidence: ["Sample fact 1"], ingredients: [] },
      { dish: "Sample dish three", description: "Layout text.", price: 12, why: "Layout text.", evidence: ["Sample fact 1"], ingredients: [] },
    ],
    experience: { event_idea: "Sample event title", event_why: "Layout text.", playlist: ["Sample Artist A", "Sample Artist B"], ambience: "Layout text." },
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
  } },
  { type: "tool_end", id: "t6", tool: "publish_playbook", summary: "Playbook ready" },
];
