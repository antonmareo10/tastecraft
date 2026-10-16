// Higher-level Qloo operations used by the agent's tools. Each returns compact,
// model-friendly data plus richer data for the UI.

import ngeohash from "ngeohash";
import { entitiesFrom, qlooGet, tagName, toEntityRef, type RawEntity, type RawTag } from "./qloo";
import type { EntityRef, HeatCell, Zone } from "./types";

export const DOMAINS = ["place", "brand", "artist", "movie", "tv_show", "book", "podcast", "destination"] as const;
export type Domain = (typeof DOMAINS)[number];

export type Lens = { age?: string; gender?: string };

function lensParams(lens?: Lens) {
  return {
    "signal.demographics.age": lens?.age,
    "signal.demographics.gender": lens?.gender,
  };
}

// --- 1. Find the restaurant -------------------------------------------------

export type RestaurantMatch = EntityRef & {
  lat?: number;
  lon?: number;
  price_level?: number;
  rating?: number;
  all_tags: string[];
};

export async function findRestaurant(name: string, city: string): Promise<RestaurantMatch[]> {
  const json = await qlooGet("/search", {
    query: `${name} ${city}`,
    types: "urn:entity:place",
    take: 8,
  });
  const cityLc = city.toLowerCase();
  const results = entitiesFrom(json).map((e) => toRestaurantMatch(e));
  // Prefer matches whose address mentions the requested city.
  return results.sort((a, b) => {
    const am = (a.subtitle ?? "").toLowerCase().includes(cityLc) ? 1 : 0;
    const bm = (b.subtitle ?? "").toLowerCase().includes(cityLc) ? 1 : 0;
    return bm - am;
  });
}

function toRestaurantMatch(e: RawEntity): RestaurantMatch {
  const ref = toEntityRef(e, 10);
  const loc = (e.location ?? (e.properties?.geocode as unknown)) as { lat?: number; lon?: number; lng?: number } | undefined;
  return {
    ...ref,
    lat: typeof loc?.lat === "number" ? loc.lat : undefined,
    lon: typeof loc?.lon === "number" ? loc.lon : typeof loc?.lng === "number" ? loc.lng : undefined,
    price_level: typeof e.properties?.price_level === "number" ? e.properties.price_level : undefined,
    rating: typeof e.properties?.business_rating === "number" ? e.properties.business_rating : undefined,
    all_tags: (e.tags ?? []).map(tagName).filter(Boolean),
  };
}

// --- 2. Cross-domain affinity ------------------------------------------------

export async function audienceAffinity(opts: {
  entityIds: string[];
  domain: Domain;
  city?: string;
  take?: number;
  lens?: Lens;
}): Promise<EntityRef[]> {
  const isLocal = opts.domain === "place";
  const json = await qlooGet("/v2/insights", {
    "filter.type": `urn:entity:${opts.domain}`,
    "signal.interests.entities": opts.entityIds.join(","),
    // Places are filtered to the city; everything else is localised with a geo signal
    // (e.g. "artists that over-index with this audience in Madrid").
    "filter.location.query": isLocal ? opts.city : undefined,
    "signal.location.query": !isLocal ? opts.city : undefined,
    "filter.exclude.entities": isLocal ? opts.entityIds.join(",") : undefined,
    take: opts.take ?? 12,
    ...lensParams(opts.lens),
  });
  return entitiesFrom(json).map((e) => toEntityRef(e));
}

// --- 2b. Taste tags: which dishes, cuisines and vibes this audience over-indexes on

export const TAG_FAMILIES = {
  dishes: "urn:tag:specialty_dish:place,urn:tag:menu_highlight:qloo",
  cuisines: "urn:tag:genre:place,urn:tag:cuisine:qloo",
  ambience: "urn:tag:ambience:qloo,urn:tag:good_for:qloo,urn:tag:setting:qloo",
} as const;
export type TagFamily = keyof typeof TAG_FAMILIES;

export type TasteTag = { id: string; name: string; type?: string; affinity?: number };

export async function tasteTags(opts: {
  entityId: string;
  city: string;
  family: TagFamily;
  take?: number;
  lens?: Lens;
}): Promise<TasteTag[]> {
  const json = await qlooGet<{ results?: { tags?: Array<RawTag & { tag_id?: string; subtype?: string; query?: { affinity?: number } }> } }>(
    "/v2/insights",
    {
      "filter.type": "urn:tag",
      "filter.tag.types": TAG_FAMILIES[opts.family],
      "signal.interests.entities": opts.entityId,
      "signal.location.query": opts.city,
      take: opts.take ?? 15,
      ...lensParams(opts.lens),
    },
  );
  return (json.results?.tags ?? []).map((t) => ({
    id: String(t.tag_id ?? t.id ?? ""),
    name: tagName(t),
    type: t.subtype ?? t.type,
    affinity: typeof t.query?.affinity === "number" ? t.query.affinity : undefined,
  }));
}

// --- 2c. Who the guests are (age / gender over- and under-indexing) -------------

export type Demographics = { age: Record<string, number>; gender: Record<string, number> };

export async function audienceDemographics(entityId: string): Promise<Demographics | null> {
  const json = await qlooGet<{
    results?: { demographics?: Array<{ query?: { age?: Record<string, number>; gender?: Record<string, number> } }> };
  }>("/v2/insights", {
    "filter.type": "urn:demographics",
    "signal.interests.entities": entityId,
  });
  const q = json.results?.demographics?.[0]?.query;
  if (!q?.age && !q?.gender) return null;
  return { age: q.age ?? {}, gender: q.gender ?? {} };
}

// --- 2d. Head-to-head: what distinguishes the restaurant's audience from a rival's

export type CompareTag = { name: string; score?: number; type?: string };

export async function compareAudiences(opts: { a: string; b: string; city: string }): Promise<CompareTag[]> {
  const json = await qlooGet<{ results?: { tags?: Array<{ name?: string; tag_id?: string; subtype?: string; query?: { score?: number } }> } }>(
    "/v2/analysis/compare",
    {
      "a.signal.interests.entities": opts.a,
      "b.signal.interests.entities": opts.b,
      "filter.location.query": opts.city,
      take: 20,
    },
  );
  return (json.results?.tags ?? []).map((t) => ({
    name: String(t.name ?? t.tag_id ?? ""),
    score: typeof t.query?.score === "number" ? t.query.score : undefined,
    type: t.subtype,
  }));
}

// --- 3. Taste gaps -------------------------------------------------------------
// Tags that are strongly over-represented among the local places your guests love,
// weighted by Qloo affinity, minus the tags your own restaurant already has.

const GENERIC_TAG = /^(restaurant|food|bar|place|point of interest|establishment|dine[- ]?in|takeout|delivery|good for|accepts|wheelchair|reservations|wi-?fi|parking|credit cards?|serves|price|casual|lunch|dinner|open)/i;

export type GapTag = { tag: string; score: number; share: number; examples: string[] };

export async function tasteGaps(opts: {
  restaurant: RestaurantMatch;
  city: string;
  lens?: Lens;
}): Promise<{ gaps: GapTag[]; sampled: EntityRef[] }> {
  const json = await qlooGet("/v2/insights", {
    "filter.type": "urn:entity:place",
    "signal.interests.entities": opts.restaurant.entity_id,
    "filter.location.query": opts.city,
    "filter.exclude.entities": opts.restaurant.entity_id,
    take: 50,
    ...lensParams(opts.lens),
  });
  const raw = entitiesFrom(json);
  const own = new Set(opts.restaurant.all_tags.map((t) => t.toLowerCase()));
  const scores = new Map<string, { score: number; count: number; examples: string[] }>();
  for (const e of raw) {
    const a = typeof e.query?.affinity === "number" ? e.query.affinity : 0.5;
    for (const t of (e.tags ?? []) as RawTag[]) {
      const name = tagName(t);
      if (!name || GENERIC_TAG.test(name) || own.has(name.toLowerCase())) continue;
      const cur = scores.get(name) ?? { score: 0, count: 0, examples: [] };
      cur.score += a;
      cur.count += 1;
      if (cur.examples.length < 3 && e.name) cur.examples.push(e.name);
      scores.set(name, cur);
    }
  }
  const n = Math.max(1, raw.length);
  const gaps = [...scores.entries()]
    .map(([tag, v]) => ({ tag, score: v.score, share: v.count / n, examples: v.examples }))
    .filter((g) => g.share >= 0.08)
    .sort((x, y) => y.score - x.score)
    .slice(0, 10);
  return { gaps, sampled: raw.slice(0, 12).map((e) => toEntityRef(e)) };
}

// --- 4. Taste heatmap ---------------------------------------------------------------

type RawHeat = {
  location?: { geohash?: string; latitude?: number; longitude?: number; lat?: number; lon?: number };
  geohash?: string;
  query?: { affinity?: number; affinity_rank?: number; popularity?: number };
  affinity?: number;
};

function heatRows(json: unknown): RawHeat[] {
  const j = json as { results?: { heatmap?: RawHeat[] } | RawHeat[] };
  if (j?.results && !Array.isArray(j.results) && Array.isArray(j.results.heatmap)) return j.results.heatmap;
  if (Array.isArray(j?.results)) return j.results as RawHeat[];
  return [];
}

export async function tasteHeatmap(opts: {
  entityId: string;
  city: string;
  lens?: Lens;
}): Promise<{ cells: HeatCell[]; top: HeatCell[] }> {
  const json = await qlooGet("/v2/insights", {
    "filter.type": "urn:heatmap",
    "signal.interests.entities": opts.entityId,
    "filter.location.query": opts.city,
    ...lensParams(opts.lens),
  });
  const rows = heatRows(json);
  const cells: HeatCell[] = [];
  for (const r of rows) {
    const gh = r.location?.geohash ?? r.geohash;
    if (!gh) continue;
    const [minLat, minLon, maxLat, maxLon] = ngeohash.decode_bbox(gh);
    const center = ngeohash.decode(gh);
    const affinity = r.query?.affinity ?? r.query?.affinity_rank ?? r.affinity ?? 0;
    cells.push({
      geohash: gh,
      lat: center.latitude,
      lon: center.longitude,
      bbox: [minLat, minLon, maxLat, maxLon],
      affinity: Math.max(0, Math.min(1, affinity)),
    });
  }
  // Normalise affinities to 0..1 within the city so the map has contrast.
  const max = Math.max(0.0001, ...cells.map((c) => c.affinity));
  const min = Math.min(...cells.map((c) => c.affinity), max);
  for (const c of cells) c.affinity = max === min ? 1 : (c.affinity - min) / (max - min);
  const top = pickSpreadTop(cells, 4);
  return { cells, top };
}

// Pick the highest cells but skip ones adjacent to an already-picked cell, so the
// zones are distinct neighborhoods rather than four tiles of the same block.
function pickSpreadTop(cells: HeatCell[], k: number): HeatCell[] {
  const sorted = [...cells].sort((a, b) => b.affinity - a.affinity);
  const picked: HeatCell[] = [];
  for (const c of sorted) {
    if (picked.some((p) => distanceKm(p, c) < 1.2)) continue;
    picked.push(c);
    if (picked.length === k) break;
  }
  return picked;
}

function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Neighborhood names for the top cells (OpenStreetMap Nominatim, cached, polite).
const placeNameCache = new Map<string, string>();

export async function nameZones(cells: HeatCell[]): Promise<Zone[]> {
  const zones: Zone[] = [];
  for (const c of cells) {
    const key = c.geohash.slice(0, 6);
    let label = placeNameCache.get(key);
    if (!label) {
      label = `Area ${zones.length + 1}`;
      try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&lat=${c.lat}&lon=${c.lon}`;
        const res = await fetch(url, {
          headers: { "User-Agent": "Tastecraft/1.0 (Qloo hackathon demo)", "Accept-Language": "en" },
          signal: AbortSignal.timeout(4000),
        });
        if (res.ok) {
          const j = (await res.json()) as { address?: Record<string, string> };
          const a = j.address ?? {};
          label = a.neighbourhood || a.suburb || a.quarter || a.city_district || a.borough || a.town || label;
        }
      } catch {
        // keep the generic label
      }
      placeNameCache.set(key, label);
    }
    zones.push({ label, lat: c.lat, lon: c.lon, affinity: c.affinity });
  }
  return zones;
}

// --- 5. Live music nearby (Ticketmaster Discovery API, optional) ---------------
// If TICKETMASTER_API_KEY is set, find upcoming concerts near the restaurant by artists
// the audience loves, so the owner can plan pre-/post-show menus.

export type Show = { artist: string; event: string; venue: string; date: string; url?: string; distance_km?: number };

export function showsConfigured(): boolean {
  return Boolean(process.env.TICKETMASTER_API_KEY);
}

export async function nearbyShows(opts: { artists: string[]; lat: number; lon: number; radiusKm?: number }): Promise<Show[]> {
  const key = process.env.TICKETMASTER_API_KEY;
  if (!key) return [];
  const shows: Show[] = [];
  for (const artist of opts.artists.slice(0, 8)) {
    const url = new URL("https://app.ticketmaster.com/discovery/v2/events.json");
    url.searchParams.set("apikey", key);
    url.searchParams.set("keyword", artist);
    url.searchParams.set("classificationName", "music");
    url.searchParams.set("latlong", `${opts.lat},${opts.lon}`);
    url.searchParams.set("radius", String(opts.radiusKm ?? 25));
    url.searchParams.set("unit", "km");
    url.searchParams.set("sort", "date,asc");
    url.searchParams.set("size", "3");
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const j = (await res.json()) as {
        _embedded?: {
          events?: Array<{
            name?: string;
            url?: string;
            distance?: number;
            dates?: { start?: { localDate?: string } };
            _embedded?: { venues?: Array<{ name?: string }> };
          }>;
        };
      };
      for (const e of j._embedded?.events ?? []) {
        shows.push({
          artist,
          event: e.name ?? artist,
          venue: e._embedded?.venues?.[0]?.name ?? "",
          date: e.dates?.start?.localDate ?? "",
          url: e.url,
          distance_km: typeof e.distance === "number" ? Number(e.distance.toFixed(1)) : undefined,
        });
      }
    } catch {
      // ignore one artist's failure
    }
  }
  return shows.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);
}
