// Shared types between the agent (server) and the UI (client).

import type { TermLift } from "./lift";

export type EntityRef = {
  entity_id: string;
  name: string;
  affinity?: number; // 0-1, Qloo query.affinity when available
  popularity?: number; // 0-1 percentile
  subtitle?: string; // address, genre, year...
  tags?: string[];
  image?: string;
};

export type HeatCell = {
  geohash: string;
  lat: number;
  lon: number;
  bbox: [number, number, number, number]; // [minLat, minLon, maxLat, maxLon]
  affinity: number; // 0-1
};

export type Zone = {
  label: string;
  lat: number;
  lon: number;
  affinity: number;
};

export type Ingredient = {
  item: string;
  qty: number;
  unit: string;
  supplier_category: string;
};

export type Evidence = {
  text: string; // owner-friendly sentence
  cites: { name: string; score?: number | null }[]; // exact Qloo names (and 0-100 scores) the sentence relies on
  verified?: boolean; // set by the server after checking the cites against this run's Qloo responses
};

export type MenuMove = {
  dish: string;
  description: string;
  price: number;
  why: string;
  evidence: Evidence[];
  ingredients: Ingredient[];
  // Per-dish crowd lift (see src/lib/lift.ts), computed server-side from Qloo data and the dish
  // name, never asked of the model. null when no food term of the dish appears on local menus.
  lift?: number | null;
  lift_terms?: TermLift[];
};

// How much more this restaurant's crowd favours the plan's dishes than the city at large
// (geometric mean of per-dish lifts; 1 = same as the city). Server-computed from Qloo.
export type CrowdLift = {
  score: number | null;
  matched: number; // dishes with at least one food term on local menus
  total: number;
  crowd_n: number; // restaurants (with menu data) the crowd loves most
  city_n: number; // the city's most popular restaurants (with menu data)
  city: string;
  // The same formula applied to the "same model, no Qloo" baseline's dishes, when available.
  baseline?: { score: number | null; matched: number; total: number; dishes: { dish: string; lift: number | null; terms: TermLift[] }[] };
};

export type Playbook = {
  restaurant: {
    name: string;
    city: string;
    concept: string;
    qloo_entity_id: string | null;
  };
  currency: string; // ISO 4217, e.g. EUR, USD, GBP
  headline: string;
  audience_dna: {
    summary: string;
    signals: { domain: string; items: string[] }[];
  };
  taste_gaps: { tag: string; evidence: string; opportunity: string }[];
  menu_moves: MenuMove[];
  experience: {
    event_idea: string;
    event_why: string;
    playlist: string[];
    ambience: string;
    show_tieins?: { artist: string; event: string; date: string; venue: string; idea: string }[];
  };
  marketing: {
    target_zones: { name: string; reason: string }[];
    instagram_post: string;
    collab_partners: { name: string; why: string }[];
  };
  shopping_list: (Ingredient & { est_cost: number })[];
  week_plan: { day: string; action: string; owner: string }[];
  caveats: string[];
  verification?: { checked: number; verified: number; qloo_facts: number };
  crowd_lift?: CrowdLift;
};

export type AgentEvent =
  | { type: "status"; message: string }
  | { type: "note"; text: string }
  | {
      type: "tool_start";
      id: string;
      tool: string;
      label: string;
      input: Record<string, unknown>;
    }
  | {
      type: "tool_end";
      id: string;
      tool: string;
      summary: string;
      entities?: EntityRef[];
      domain?: string;
      error?: boolean;
    }
  | { type: "heatmap"; cells: HeatCell[]; zones: Zone[]; center: [number, number] }
  | { type: "restaurant"; entity: EntityRef & { lat?: number; lon?: number }; resolution?: Resolution }
  | { type: "baseline"; text: string }
  // Head-to-head with a rival (Qloo /v2/analysis/compare): tags only one of the two places carries.
  | { type: "compare"; a: string; b: string; only_a: string[]; only_b: string[]; shared: string[] }
  | { type: "shows"; shows: ShowRef[] }
  | { type: "trends"; series: TrendLine[] }
  | { type: "demographics"; age: Record<string, number>; gender: Record<string, number> }
  | { type: "taste_tags"; family: "dishes" | "cuisines" | "ambience"; tags: { name: string; affinity?: number }[] }
  | { type: "playbook"; playbook: Playbook }
  | { type: "playbook_draft"; draft: Record<string, unknown> }
  | { type: "answer"; question: string; answer: string; evidence: Evidence[] }
  | { type: "error"; message: string }
  | { type: "done"; elapsed_ms: number };

// A live event near the restaurant. fan_match (0-100) is the Qloo affinity of the billed artist for
// this restaurant's audience, when the concert was ranked through Qloo.
export type ShowRef = {
  artist: string;
  event: string;
  venue: string;
  date: string;
  url?: string;
  distance_km?: number;
  fan_match?: number;
};

export type TrendDirection = "rising" | "falling" | "steady" | "no_data";

// One place's popularity trend (Qloo /v2/trending), summarised by Tastecraft. change is in percentile
// points (metric "percentile") or rank positions gained (metric "rank"); points are downsampled for the UI.
export type TrendLine = {
  entity_id: string;
  name: string;
  direction: TrendDirection;
  change: number | null;
  metric?: "percentile" | "rank";
  points: { date: string; value: number }[];
};

// How sure we are that the Qloo entity is the owner's restaurant (shown to the owner, who can switch).
export type Resolution = {
  status: "resolved" | "ambiguous" | "not_found";
  match: "owner_confirmed" | "exact" | "close" | "best_guess";
  alternatives: { entity_id: string; name: string; subtitle?: string }[];
};

export type AgentRequest = {
  restaurant: string; // name of the restaurant
  city: string;
  entity_id?: string; // Qloo entity the owner picked after a wrong or ambiguous match
  goal?: string; // optional free-text goal ("fill Tuesday nights", "launch brunch")
  lens?: { age?: string; gender?: string }; // optional audience lens
  language?: "English" | "Español";
  followup?: {
    question: string;
    restaurant: { entity_id: string; name: string; tags?: string[] };
    playbook_headline?: string;
  };
};
