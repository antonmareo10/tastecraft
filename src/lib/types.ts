// Shared types between the agent (server) and the UI (client).

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

export type MenuMove = {
  dish: string;
  description: string;
  price: number;
  why: string;
  evidence: string[];
  ingredients: Ingredient[];
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
  };
  marketing: {
    target_zones: { name: string; reason: string }[];
    instagram_post: string;
    collab_partners: { name: string; why: string }[];
  };
  shopping_list: (Ingredient & { est_cost: number })[];
  caveats: string[];
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
  | { type: "restaurant"; entity: EntityRef & { lat?: number; lon?: number } }
  | { type: "baseline"; text: string }
  | { type: "compare"; a: string; b: string; tags: { name: string; score?: number }[] }
  | { type: "demographics"; age: Record<string, number>; gender: Record<string, number> }
  | { type: "taste_tags"; family: "dishes" | "cuisines" | "ambience"; tags: { name: string; affinity?: number }[] }
  | { type: "playbook"; playbook: Playbook }
  | { type: "error"; message: string }
  | { type: "done"; elapsed_ms: number };

export type AgentRequest = {
  restaurant: string; // name of the restaurant
  city: string;
  goal?: string; // optional free-text goal ("fill Tuesday nights", "launch brunch")
  lens?: { age?: string; gender?: string }; // optional audience lens
  language?: "English" | "Español";
};
