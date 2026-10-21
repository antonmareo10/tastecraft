// Higher-level Qloo operations used by the agent's tools. Each returns compact,
// model-friendly data plus richer data for the UI.

import ngeohash from "ngeohash";
import { rankTerms, smoothedLift, type CrowdSets, type MenuPlace } from "./lift";
import { entitiesFrom, entityId, qlooGet, tagName, toEntityRef, type RawEntity, type RawTag } from "./qloo";
import type { EntityRef, HeatCell, Zone, Resolution, ShowRef } from "./types";

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
  // true when Qloo tags the place as a restaurant (restaurant genre, cuisine or menu tags); false when it
  // has tags and none of them say so (a museum, an airport); undefined when it has no tags at all.
  is_restaurant?: boolean;
};

export async function findRestaurant(name: string, city: string): Promise<RestaurantMatch[]> {
  const search = async (query: string) =>
    entitiesFrom(await qlooGet("/search", { query, types: "urn:entity:place", take: 8 })).map((e) => toRestaurantMatch(e));
  let results = await search(`${name} ${city}`);
  // The city words can drown a short name ("Gjelina Los Angeles" returns LA landmarks only):
  // if nothing carries the name, search the name alone and keep both lists.
  if (!results.some((r) => nameScore(name, r.name) >= 2)) {
    const merged = new Map<string, RestaurantMatch>();
    for (const r of [...(await search(name)), ...results]) if (!merged.has(r.entity_id)) merged.set(r.entity_id, r);
    results = [...merged.values()];
  }
  const cityLc = city.toLowerCase();
  // Prefer matches whose address mentions the requested city.
  return results.sort((a, b) => {
    const am = (a.subtitle ?? "").toLowerCase().includes(cityLc) ? 1 : 0;
    const bm = (b.subtitle ?? "").toLowerCase().includes(cityLc) ? 1 : 0;
    return bm - am;
  });
}

// Owner-confirmed lookup when the picked entity is not in the search results.
export async function restaurantById(entityId: string): Promise<RestaurantMatch | null> {
  const json = await qlooGet("/entities", { entity_ids: entityId });
  const [e] = entitiesFrom(json);
  return e ? toRestaurantMatch(e) : null;
}

const plain = (x: string) =>
  x
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['\u2019`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// 3 = same name, 2 = one name contains the other, 1 = shares a meaningful word, 0 = unrelated.
function nameScore(query: string, candidate: string): number {
  const q = plain(query);
  const c = plain(candidate);
  if (!q || !c) return 0;
  if (q === c) return 3;
  if (c.includes(q) || q.includes(c)) return 2;
  const words = new Set(q.split(" ").filter((w) => w.length > 2 && !["the", "and", "restaurant", "bar", "cafe"].includes(w)));
  return c.split(" ").some((w) => words.has(w)) ? 1 : 0;
}

// Picks the candidate to analyse and says how sure the match is, so the owner can confirm or switch
// before relying on the results (Qloo's safe-use guidance: show resolved matches to the user).
export function resolveRestaurant(
  name: string,
  city: string,
  matches: RestaurantMatch[],
  preferredId?: string,
): { selected: RestaurantMatch | null; resolution: Resolution } {
  if (!matches.length) return { selected: null, resolution: { status: "not_found", match: "best_guess", alternatives: [] } };
  const cityKey = plain(city);
  const inCity = (m: RestaurantMatch) => (cityKey ? plain(m.subtitle ?? "").includes(cityKey) : false);
  // Name first, then the requested city, then places Qloo tags as restaurants, then Qloo's own order.
  const ranked = matches
    .map((m, i) => ({ m, name: nameScore(name, m.name), city: inCity(m), food: m.is_restaurant !== false, i }))
    .sort(
      (a, b) =>
        b.name * 2 + Number(b.city) - (a.name * 2 + Number(a.city)) || Number(b.food) - Number(a.food) || a.i - b.i,
    );
  // The candidates offered as "Not your restaurant?": the next most plausible ones, without the
  // landmarks a city-wide search also returns (places Qloo does not tag as restaurants).
  const others = (sel: RestaurantMatch) =>
    ranked
      .map((r) => r.m)
      .filter((m) => m.entity_id !== sel.entity_id && m.is_restaurant !== false)
      .slice(0, 4)
      .map((m) => ({ entity_id: m.entity_id, name: m.name, subtitle: m.subtitle }));
  const preferred = preferredId ? matches.find((m) => m.entity_id === preferredId) : undefined;
  if (preferred) {
    return { selected: preferred, resolution: { status: "resolved", match: "owner_confirmed", alternatives: others(preferred) } };
  }
  const [top, second] = ranked;
  const match: Resolution["match"] = top.name === 3 ? "exact" : top.name === 2 ? "close" : "best_guess";
  const tie = second != null && second.name === top.name && second.city === top.city;
  return {
    selected: top.m,
    resolution: { status: match === "exact" && !tie ? "resolved" : "ambiguous", match, alternatives: others(top.m) },
  };
}

// A place is a restaurant for Qloo when it carries the restaurant genre (urn:tag:genre:place:restaurant
// or a sub-genre), a cuisine or menu tags. Landmarks returned by a city-wide search carry none of them.
const FOOD_TAG_TYPE = /^urn:tag:(cuisine:qloo|specialty_dish:place|menu_highlight:qloo)$/;
export function isRestaurant(tags: RawTag[] | undefined): boolean | undefined {
  if (!tags?.length) return undefined;
  return tags.some((t) => /^urn:tag:genre:place:restaurant(:|$)/.test(String(t.id ?? t.tag_id ?? "")) || FOOD_TAG_TYPE.test(String(t.type ?? "")));
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
    is_restaurant: isRestaurant(e.tags),
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

// Tag names that say nothing about taste (shared by the head-to-head and the taste gaps).
const GENERIC_TAG = /^(restaurant|food|bar|place|point of interest|establishment|dine[- ]?in|takeout|delivery|good for|accepts|wheelchair|reservations|wi-?fi|parking|credit cards?|debit cards?|serves|price|casual|lunch|dinner|open)\b/i;

// --- 2d. Head-to-head: what only the restaurant, or only its rival, is known for ---------
// With one place on each side, /v2/analysis/compare returns each place's own Qloo tags
// (results.a, results.b) plus a merged list (results.tags) whose query.score is an undocumented
// sigmoid weight: tags both places share all sit at sigmoid(1) = 0.731. That weight is not a
// measured difference between two audiences, so it is used only to order tags, never shown.

type RawCompareTag = { tag_id?: string; name?: string; subtype?: string; query?: { score?: number } };

export type HeadToHead = { onlyA: string[]; onlyB: string[]; shared: string[] };

export async function compareAudiences(opts: { a: string; b: string; city: string }): Promise<HeadToHead> {
  const json = await qlooGet<{ results?: { tags?: RawCompareTag[]; a?: RawCompareTag[]; b?: RawCompareTag[] } }>(
    "/v2/analysis/compare",
    {
      "a.signal.interests.entities": opts.a,
      "b.signal.interests.entities": opts.b,
      "filter.location.query": opts.city,
      take: 50,
    },
  );
  return headToHead(json.results ?? {});
}

const COMPARE_SKIP_TYPE = /^urn:tag:(payments|credit_card|parking|accessibility|inclusivity|service_type|dining_options|offerings|seating|amenity|children|planning|health|nutrition)(:|$)|^urn:tag:genre:place$/;

/** Name-level set difference of the two places' tags (a "Deli" genre on one side and a "Deli" cuisine on the other count as shared). */
export function headToHead(r: { tags?: RawCompareTag[]; a?: RawCompareTag[]; b?: RawCompareTag[] }, max = 8): HeadToHead {
  const weight = new Map<string, number>();
  for (const t of r.tags ?? []) {
    const k = plain(t.name ?? "");
    if (k && typeof t.query?.score === "number") weight.set(k, Math.max(weight.get(k) ?? 0, t.query.score));
  }
  const keep = (t: RawCompareTag) => {
    const name = (t.name ?? "").trim();
    return Boolean(name) && !GENERIC_TAG.test(name) && !COMPARE_SKIP_TYPE.test(String(t.subtype ?? ""));
  };
  const names = (side: RawCompareTag[] | undefined) => {
    const out = new Map<string, string>();
    for (const t of side ?? []) if (keep(t) && !out.has(plain(t.name ?? ""))) out.set(plain(t.name ?? ""), (t.name ?? "").trim());
    return out;
  };
  const a = names(r.a);
  const b = names(r.b);
  const byWeight = (keys: string[], from: Map<string, string>) =>
    keys
      .map((k, i) => ({ k, i, w: weight.get(k) ?? 0 }))
      .sort((x, y) => y.w - x.w || x.i - y.i)
      .slice(0, max)
      .map(({ k }) => from.get(k) as string);
  return {
    onlyA: byWeight([...a.keys()].filter((k) => !b.has(k)), a),
    onlyB: byWeight([...b.keys()].filter((k) => !a.has(k)), b),
    shared: byWeight([...a.keys()].filter((k) => b.has(k)), a),
  };
}

// --- 3. Crowd vs city: the restaurant sets behind taste gaps and crowd lift ----------
// crowd = the restaurants in the city this restaurant's audience has the highest affinity for;
// city  = the city's most popular restaurants (same query without the audience signal).
// Comparing the two separates what this crowd favours from what is simply popular everywhere.

const RESTAURANT_TAG = "urn:tag:genre:place:restaurant";
const MENU_TAG = /^urn:tag:(specialty_dish:place|menu_highlight:qloo)/;
export const CROWD_PAGES = 3; // 3 x 50 restaurants per side
const PAGE_SIZE = 50;

export type CrowdData = { crowd: RawEntity[]; city: RawEntity[] };

async function restaurantsIn(opts: { city: string; exclude: string; signal?: string; lens?: Lens }): Promise<RawEntity[]> {
  const seen = new Map<string, RawEntity>();
  for (let page = 1; page <= CROWD_PAGES; page++) {
    const json = await qlooGet("/v2/insights", {
      "filter.type": "urn:entity:place",
      "filter.location.query": opts.city,
      "filter.tags": RESTAURANT_TAG,
      "filter.exclude.entities": opts.exclude,
      "signal.interests.entities": opts.signal,
      take: PAGE_SIZE,
      page,
      ...lensParams(opts.signal ? opts.lens : undefined),
    });
    const batch = entitiesFrom(json);
    for (const e of batch) {
      const id = entityId(e);
      if (id && !seen.has(id)) seen.set(id, e);
    }
    if (batch.length < PAGE_SIZE) break;
  }
  return [...seen.values()];
}

/** Both restaurant sets for a restaurant's city (cached by qlooGet, so the gaps tool and the crowd-lift score share them). */
export async function crowdAndCity(opts: { entityId: string; city: string; lens?: Lens }): Promise<CrowdData> {
  const [crowd, city] = await Promise.all([
    restaurantsIn({ city: opts.city, exclude: opts.entityId, signal: opts.entityId, lens: opts.lens }),
    restaurantsIn({ city: opts.city, exclude: opts.entityId }),
  ]);
  return { crowd, city };
}

/** Menu view of the sets for src/lib/lift.ts: places with at least one Qloo menu tag (specialty dish / menu highlight). */
export function menuSets(data: CrowdData): CrowdSets {
  const toMenu = (e: RawEntity): MenuPlace => ({
    name: e.name ?? "",
    menu: ((e.tags ?? []) as RawTag[]).filter((t) => MENU_TAG.test(String(t.type ?? ""))).map(tagName).filter(Boolean),
  });
  return {
    crowd: data.crowd.map(toMenu).filter((p) => p.menu.length > 0),
    city: data.city.map(toMenu).filter((p) => p.menu.length > 0),
  };
}

// --- 3b. Taste gaps -----------------------------------------------------------------
// Tags (cuisines, formats, vibes) that the crowd's favourite restaurants carry much more often
// than the city's most popular ones (lift), minus the tags this restaurant already has.

// Tag families that describe payment, access or location rather than taste.
const NON_TASTE_TYPE = /^urn:tag:(payments|credit_card|parking|accessibility|age_range|nearby_attraction|neighborhood_characteristic|view)(:|$)|^urn:tag:genre:place$/;

export type GapTag = { tag: string; crowd: number; city: number; crowd_pct: number; city_pct: number; lift: number; examples: string[] };

export async function tasteGaps(opts: {
  restaurant: RestaurantMatch;
  city: string;
  lens?: Lens;
}): Promise<{ gaps: GapTag[]; sampled: EntityRef[]; menu: ReturnType<typeof rankTerms>; crowd_n: number; city_n: number }> {
  const data = await crowdAndCity({ entityId: opts.restaurant.entity_id, city: opts.city, lens: opts.lens });
  const own = new Set(opts.restaurant.all_tags.map((t) => t.toLowerCase()));
  const tagsOf = (e: RawEntity) =>
    new Set(
      ((e.tags ?? []) as RawTag[])
        .filter((t) => !MENU_TAG.test(String(t.type ?? "")) && !NON_TASTE_TYPE.test(String(t.type ?? "")))
        .map(tagName)
        .filter((name) => name && !GENERIC_TAG.test(name) && !own.has(name.toLowerCase())),
    );
  const count = (places: RawEntity[]) => {
    const m = new Map<string, number>();
    for (const e of places) for (const t of tagsOf(e)) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  };
  const a = count(data.crowd);
  const b = count(data.city);
  const nA = data.crowd.length;
  const nB = data.city.length;
  const minCount = Math.max(3, Math.ceil(nA * 0.04));
  const pct = (x: number, n: number) => (n ? Math.round((x / n) * 100) : 0);
  const gaps = [...a.entries()]
    .filter(([, crowd]) => crowd >= minCount)
    .map(([tag, crowd]) => {
      const city = b.get(tag) ?? 0;
      return {
        tag,
        crowd,
        city,
        crowd_pct: pct(crowd, nA),
        city_pct: pct(city, nB),
        lift: Math.round(smoothedLift(crowd, nA, city, nB) * 10) / 10,
        examples: data.crowd.filter((e) => tagsOf(e).has(tag)).slice(0, 3).map((e) => e.name ?? ""),
      };
    })
    .filter((g) => g.lift > 1)
    .sort((x, y) => y.lift - x.lift || y.crowd - x.crowd)
    .slice(0, 10);
  const sets = menuSets(data);
  return {
    gaps,
    sampled: data.crowd.slice(0, 12).map((e) => toEntityRef(e)),
    menu: rankTerms(sets, { own: opts.restaurant.all_tags }),
    crowd_n: nA,
    city_n: nB,
  };
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
    // Several hot cells often fall in the same neighbourhood: keep the strongest one per name.
    if (!zones.some((z) => z.label === label)) zones.push({ label, lat: c.lat, lon: c.lon, affinity: c.affinity });
  }
  return zones;
}

// --- 5. Live music nearby (Ticketmaster Discovery API, optional) ---------------
// If TICKETMASTER_API_KEY is set, list upcoming concerts near the restaurant so the owner can plan
// pre-/post-show menus. src/lib/concerts.ts ranks the billed artists for the audience with Qloo.

export type Show = ShowRef & { kind?: "music" | "sports" };
/** A listed concert with every billed artist (headliner first). */
export type MusicListing = Show & { attractions: string[] };

export function showsConfigured(): boolean {
  return Boolean(process.env.TICKETMASTER_API_KEY);
}

// Ticketmaster lists test events, stadium tours, parking passes and tribute nights next to real shows.
const NOT_A_SHOW = /\b(test|tribute|tour of|stadium tour|classic tour|parking|suite|premium seating|season tickets?|membership|package|tailgate|karaoke|dance party|candlelight|experience|night of|celebration of)\b/i;
const norm = (x: string) => x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

type TmEvent = {
  name?: string;
  url?: string;
  distance?: number;
  dates?: { start?: { localDate?: string } };
  classifications?: Array<{ genre?: { name?: string } }>;
  _embedded?: { venues?: Array<{ name?: string }>; attractions?: Array<{ name?: string }> };
};

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
    url.searchParams.set("size", "10");
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const j = (await res.json()) as { _embedded?: { events?: TmEvent[] } };
      const real = (j._embedded?.events ?? []).filter(
        (e) => !NOT_A_SHOW.test(e.name ?? "") && (e._embedded?.attractions ?? []).some((a) => norm(a.name ?? "") === norm(artist)),
      );
      for (const e of real.slice(0, 2)) {
        shows.push({
          artist,
          event: e.name ?? artist,
          venue: e._embedded?.venues?.[0]?.name ?? "",
          date: e.dates?.start?.localDate ?? "",
          url: e.url,
          distance_km: typeof e.distance === "number" ? Number(e.distance.toFixed(1)) : undefined,
          kind: "music",
        });
      }
    } catch {
      // ignore one artist's failure
    }
  }
  return dedupe(shows).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);
}

// Every upcoming music event near the restaurant in the next `days` (one Ticketmaster call, no artist filter).
// Returns null when the listing could not be fetched, so callers can fall back to an artist search.
export async function upcomingMusicEvents(opts: {
  lat: number;
  lon: number;
  radiusKm?: number;
  days?: number;
  size?: number;
}): Promise<MusicListing[] | null> {
  const key = process.env.TICKETMASTER_API_KEY;
  if (!key) return [];
  const url = new URL("https://app.ticketmaster.com/discovery/v2/events.json");
  const start = new Date();
  const end = new Date(start.getTime() + (opts.days ?? 35) * 24 * 3600 * 1000);
  url.searchParams.set("apikey", key);
  url.searchParams.set("classificationName", "music");
  url.searchParams.set("latlong", `${opts.lat},${opts.lon}`);
  url.searchParams.set("radius", String(opts.radiusKm ?? 25));
  url.searchParams.set("unit", "km");
  url.searchParams.set("startDateTime", start.toISOString().slice(0, 19) + "Z");
  url.searchParams.set("endDateTime", end.toISOString().slice(0, 19) + "Z");
  url.searchParams.set("sort", "date,asc");
  url.searchParams.set("size", String(Math.min(50, opts.size ?? 50)));
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const j = (await res.json()) as { _embedded?: { events?: TmEvent[] } };
    const listings: MusicListing[] = [];
    for (const e of j._embedded?.events ?? []) {
      if (NOT_A_SHOW.test(e.name ?? "")) continue;
      const attractions: string[] = [];
      for (const a of e._embedded?.attractions ?? []) {
        const n = (a.name ?? "").trim();
        if (n && !NOT_A_SHOW.test(n) && !attractions.some((x) => norm(x) === norm(n))) attractions.push(n);
      }
      if (!attractions.length) continue; // only billed artists
      listings.push({
        artist: attractions[0],
        attractions,
        event: e.name ?? attractions[0],
        venue: e._embedded?.venues?.[0]?.name ?? "",
        date: e.dates?.start?.localDate ?? "",
        url: e.url,
        distance_km: typeof e.distance === "number" ? Number(e.distance.toFixed(1)) : undefined,
        kind: "music",
      });
    }
    return dedupe(listings);
  } catch {
    return null;
  }
}

/** Distinct billed artists, nearest events first (then earliest), at most `max`. */
export function billedArtists(listings: MusicListing[], max = 10): string[] {
  const ordered = [...listings].sort(
    (a, b) => (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity) || a.date.localeCompare(b.date),
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of ordered) {
    for (const name of l.attractions) {
      const k = norm(name);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(name);
      if (out.length === max) return out;
    }
  }
  return out;
}

export function normalizeArtist(name: string): string {
  return norm(name);
}

function dedupe<T extends Show>(shows: T[]): T[] {
  const seen = new Set<string>();
  return shows.filter((s) => {
    const k = `${norm(s.event)}|${s.date}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Big sports fixtures near the restaurant in the next ~5 weeks (game-day menus).
export async function nearbyGames(opts: { lat: number; lon: number; radiusKm?: number }): Promise<Show[]> {
  const key = process.env.TICKETMASTER_API_KEY;
  if (!key) return [];
  const url = new URL("https://app.ticketmaster.com/discovery/v2/events.json");
  const start = new Date();
  const end = new Date(start.getTime() + 35 * 24 * 3600 * 1000);
  url.searchParams.set("apikey", key);
  url.searchParams.set("classificationName", "sports");
  url.searchParams.set("latlong", `${opts.lat},${opts.lon}`);
  url.searchParams.set("radius", String(opts.radiusKm ?? 15));
  url.searchParams.set("unit", "km");
  url.searchParams.set("startDateTime", start.toISOString().slice(0, 19) + "Z");
  url.searchParams.set("endDateTime", end.toISOString().slice(0, 19) + "Z");
  url.searchParams.set("sort", "date,asc");
  url.searchParams.set("size", "30");
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const j = (await res.json()) as { _embedded?: { events?: TmEvent[] } };
    const games = (j._embedded?.events ?? []).filter((e) => {
      const genre = e.classifications?.[0]?.genre?.name ?? "";
      return !NOT_A_SHOW.test(e.name ?? "") && !/^(miscellaneous|undefined)$/i.test(genre);
    });
    return dedupe(games.map((e) => ({
      artist: e._embedded?.attractions?.[0]?.name ?? e.name ?? "Game",
      event: e.name ?? "Game",
      venue: e._embedded?.venues?.[0]?.name ?? "",
      date: e.dates?.start?.localDate ?? "",
      url: e.url,
      distance_km: typeof e.distance === "number" ? Number(e.distance.toFixed(1)) : undefined,
      kind: "sports" as const,
    }))).slice(0, 8);
  } catch {
    return [];
  }
}
