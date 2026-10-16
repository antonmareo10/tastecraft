// DEV-ONLY mock of the Qloo API for probing @qloo/qloo-harness workflows.
// Extended copy of scripts/mock-qloo.mjs: logs every request and covers the endpoints the harness
// calls (/search, /entities, /v2/tags, /v2/insights incl. heatmap/demographics/tag, /v2/analysis/compare,
// /v2/trending). All data is synthetic ("Mock ..."); response shapes follow docs/QLOO_API_NOTES.md.
//
// Usage:  PORT=4011 node scripts/mock-qloo-harness.mjs     (default port 4011; 4010 is the classic mock)
//   GET  /__log    -> JSON array of logged requests      POST /__reset -> clears the log
// Magic inputs:
//   /search query "La Taberna"        -> 3 places with the same name           (ambiguous entity)
//   /search query "Casa Mock Madrid"  -> "Casa Mock" in Madrid and Barcelona   (contextual/semantic match)
//   /search query containing "zzz"    -> no results                            (not_found)
//   /search query starting "urn:"     -> no results (a tag URN is not an entity name)
//   /search query "force 401|429|500" -> that HTTP status
//   /v2/tags query "cozy" | "vermut"  -> semantic hits without an exact name   (ambiguous tag)
//   /v2/tags query containing "zzz"   -> no tags                                (not_found)
//   location "Nowhere"                -> empty insights results (filter./signal.location.query)
//   any query value containing "slow" -> responds after 1.5 s                   (timeouts)
//   X-Api-Key "bad-key"               -> 401 on every endpoint
import { createHash } from "node:crypto";
import http from "node:http";
import { pathToFileURL } from "node:url";

/** Deterministic, RFC-4122-shaped (v4) uppercase UUID, like real Qloo entity IDs. */
export function mockUuid(seed) {
  const h = createHash("sha1").update(String(seed)).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`.toUpperCase();
}

const tag = (id, name, type) => ({ id, name, type });
const restaurantTags = [
  tag("urn:tag:genre:place:restaurant:spanish", "Spanish", "urn:tag:genre:place"),
  tag("urn:tag:cuisine:qloo:tapas", "Tapas", "urn:tag:cuisine:qloo"),
  tag("urn:tag:ambience:qloo:traditional", "Traditional", "urn:tag:ambience:qloo"),
];
const placeTags = [
  tag("urn:tag:menu_highlight:qloo:vermouth", "Vermouth", "urn:tag:menu_highlight:qloo"),
  tag("urn:tag:menu_highlight:qloo:natural_wine", "Natural wine", "urn:tag:menu_highlight:qloo"),
  tag("urn:tag:genre:place:wine_bar", "Wine bar", "urn:tag:genre:place"),
  tag("urn:tag:ambience:qloo:late_night", "Late night", "urn:tag:ambience:qloo"),
  tag("urn:tag:genre:place:restaurant:japanese", "Japanese", "urn:tag:genre:place"),
  tag("urn:tag:dining_options:place:brunch", "Brunch", "urn:tag:dining_options:place"),
  tag("urn:tag:specialty_dish:place:croquetas", "Croquetas", "urn:tag:specialty_dish:place"),
  tag("urn:tag:ambience:qloo:lively", "Lively", "urn:tag:ambience:qloo"),
];

function place(name, city, i = 0) {
  return {
    entity_id: mockUuid(`place:${name}:${city}`),
    name,
    types: ["urn:entity:place"],
    popularity: Number((0.9 - i * 0.05).toFixed(2)),
    properties: {
      address: `Calle Mock ${35 + i}, ${city}`,
      price_level: 2 + (i % 3),
      business_rating: 4.1 + (i % 5) / 10,
      geocode: { city, name: city },
      short_description: `Synthetic ${city} restaurant for tests.`,
    },
    location: { lat: 40.4123 + i / 100, lon: -3.7089 },
    tags: restaurantTags,
  };
}

function genericEntity(name, typeUrn) {
  const urn = typeUrn || "urn:entity:place";
  if (urn === "urn:entity:place") return place(name, "Madrid");
  return {
    entity_id: mockUuid(`${urn}:${name}`),
    name,
    types: [urn],
    popularity: 0.77,
    properties: { short_description: `Synthetic ${urn.replace("urn:entity:", "")} for tests.`, release_year: 2019 },
  };
}

// Every entity the mock has handed out, so /entities and insights can echo names back.
const registry = new Map();
function remember(e) {
  registry.set(e.entity_id, e);
  return e;
}

// Fixed fixtures are known up front, so /entities can answer for their IDs before any /search.
const fixtures = {
  casa: [place("Casa Mock", "Madrid", 0), place("Casa Mock", "Barcelona", 1)],
  taberna: ["Madrid", "Sevilla", "Valencia"].map((c, i) => place("La Taberna", c, i)),
};
[...fixtures.casa, ...fixtures.taberna].forEach(remember);

function searchResults(query, types, take) {
  const q = query.trim();
  const lc = q.toLowerCase();
  const typeUrn = (types || "").split(",")[0] || "urn:entity:place";
  if (lc.includes("zzz") || lc.startsWith("urn:")) return [];
  if (lc === "la taberna") return fixtures.taberna;
  if (lc === "casa mock madrid") return fixtures.casa;
  const exact = remember(genericEntity(q, typeUrn));
  const related = remember(genericEntity(`${q} Annex`, typeUrn));
  return [exact, related].slice(0, take);
}

function tagSearch(query) {
  const lc = query.trim().toLowerCase();
  const withParents = (t, parents = ["urn:entity:place"]) => ({ ...t, parents: parents.map((type) => ({ type })), popularity: 0.8 });
  if (lc.includes("zzz")) return [];
  if (lc === "cozy")
    return [
      withParents(tag("urn:tag:ambience:qloo:cozy_atmosphere", "Cozy Atmosphere", "urn:tag:ambience:qloo")),
      withParents(tag("urn:tag:genre:place:cozy_cafe", "Cozy Cafe", "urn:tag:genre:place")),
      withParents(tag("urn:tag:genre:media:cozy_mystery", "Cozy Mystery", "urn:tag:genre:media"), ["urn:entity:book", "urn:entity:movie"]),
    ];
  if (lc === "vermut") return [withParents(placeTags[0]), withParents(placeTags[2])];
  const known = placeTags.find((t) => t.name.toLowerCase() === lc);
  const exact = known ?? tag(`urn:tag:keyword:qloo:${lc.replace(/[^a-z0-9]+/g, "_")}`, query.trim(), "urn:tag:keyword:qloo");
  return [withParents(exact), withParents(placeTags[7])];
}

function insightEntities(type, ids, n, seed) {
  const short = type.replace("urn:entity:", "");
  const base = ids.length
    ? ids.map((id) => registry.get(id) ?? { entity_id: id, name: `Mock ${short} ${id.slice(0, 4)}`, types: [type] })
    : Array.from({ length: n }, (_, i) => remember(genericEntity(`Mock ${short} ${i + 1}`, type)));
  return base
    .map((e, i) => ({
      ...e,
      type: "urn:entity",
      subtype: type,
      query: { affinity: Number(Math.abs(Math.sin(i * 7.1 + seed)).toFixed(3)) },
    }))
    .sort((a, b) => b.query.affinity - a.query.affinity);
}

function heatmap(n) {
  const out = [];
  const chars = "0123456789bcdefghjkmnpqrstuvwxyz";
  for (let i = 0; i < Math.max(n, 15); i++) {
    const gh = "ezjmg" + chars[(i * 7) % 32] + chars[(i * 11) % 32];
    out.push({
      location: { geohash: gh, latitude: 40.4 + (i % 8) * 0.01, longitude: -3.72 + Math.floor(i / 8) * 0.01 },
      query: { affinity: Number(Math.abs(Math.sin(i)).toFixed(3)), affinity_rank: Number((i / 20).toFixed(2)), popularity: 0.5 },
    });
  }
  return out;
}

function trending(start, end, take) {
  const out = [];
  const s = Date.parse(`${start}T00:00:00Z`);
  const e = Date.parse(`${end}T00:00:00Z`);
  for (let t = e, i = 0; t >= s && i < take; t -= 7 * 86400000, i++) {
    out.push({
      date: new Date(t).toISOString().slice(0, 10),
      population_percentile: Number((0.6 + 0.03 * (take - i) / take).toFixed(3)),
      population_rank: 1200 + i * 40,
      population_rank_velocity: -40 + i,
      velocity_fold_change: Number((1.2 - i * 0.02).toFixed(3)),
      population_percent_delta: Number((0.05 - i * 0.004).toFixed(4)),
    });
  }
  return out; // date descending, as documented
}

export function createMockQlooServer(options = {}) {
  const log = options.log ?? [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://mock");
    const p = url.searchParams;
    const send = (obj, status = 200, headers = {}) => {
      res.writeHead(status, { "content-type": "application/json", "x-request-id": `mock-${log.length}`, ...headers });
      res.end(JSON.stringify(obj));
    };
    if (url.pathname === "/__log") return send(log);
    if (url.pathname === "/__reset") {
      log.length = 0;
      return send({ ok: true });
    }
    const respond = () => route(req, res, url, p, send);
    const entry = {
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(p.entries()),
      has_api_key: Boolean(req.headers["x-api-key"]),
      correlation_id: req.headers["x-correlation-id"],
      user_agent: req.headers["user-agent"],
    };
    log.push(entry);
    if (!options.quiet) console.log(JSON.stringify(entry));
    if ([...p.values()].some((v) => v.toLowerCase().includes("slow"))) {
      const timer = setTimeout(() => respond(), 1500);
      res.on("close", () => clearTimeout(timer)); // client gave up (e.g. a timeout)
      return;
    }
    respond();
  });

  function route(req, res, url, p, send) {
    if (req.headers["x-api-key"] === "bad-key") return send({ code: 401, reason: "Unauthorized", message: "Invalid API key" }, 401);

    const take = Number(p.get("take") || 10);
    if (url.pathname === "/") return send({ success: true, name: "mock qloo" });
    if (url.pathname === "/search") {
      const q = p.get("query") || "";
      const forced = /^force (\d{3})$/.exec(q.toLowerCase());
      if (forced) return send({ code: Number(forced[1]), reason: "forced", message: `Forced ${forced[1]} from mock` }, Number(forced[1]), { "retry-after": "0" });
      return send({ success: true, duration: 0.01, results: searchResults(q, p.get("types"), take) });
    }
    if (url.pathname === "/entities") {
      const ids = (p.get("entity_ids") || "").split(",").filter(Boolean);
      return send({ success: true, results: ids.map((id) => registry.get(id)).filter(Boolean) });
    }
    if (url.pathname === "/v2/tags") return send({ success: true, results: { tags: tagSearch(p.get("filter.query") || "").slice(0, take) } });
    if (url.pathname === "/v2/analysis/compare") {
      return send({ duration: 0.4, results: { tags: placeTags.slice(0, Math.min(take, 6)).map((t, i) => ({ tag_id: t.id, name: t.name, type: "urn:tag", subtype: t.type, popularity: 0.9, query: { score: Number((0.8 - i * 0.1).toFixed(2)) } })) } });
    }
    if (url.pathname === "/v2/trending") {
      return send({ success: true, results: { trending: trending(p.get("filter.start_date"), p.get("filter.end_date"), take) } });
    }
    if (url.pathname === "/v2/insights") {
      const type = p.get("filter.type") || "";
      if ([p.get("filter.location.query"), p.get("signal.location.query")].includes("Nowhere")) {
        return send({ success: true, results: { entities: [], heatmap: [], tags: [], demographics: [] } });
      }
      if (type === "urn:heatmap") return send({ success: true, results: { heatmap: heatmap(take) } });
      if (type === "urn:demographics") {
        return send({ success: true, results: { demographics: [{ entity_id: p.get("signal.interests.entities"), query: { age: { "24_and_younger": -0.12, "25_to_29": 0.31, "30_to_34": 0.52, "35_to_44": 0.18, "45_to_54": -0.21, "55_and_older": -0.4 }, gender: { male: 0.06, female: -0.06 } } }] } });
      }
      if (type === "urn:tag") return send({ success: true, results: { tags: placeTags.slice(0, take).map((t, i) => ({ tag_id: t.id, name: t.name, subtype: t.type, types: ["urn:tag"], query: { affinity: Number((0.95 - i * 0.07).toFixed(2)) } })) } });
      if (type.startsWith("urn:entity:")) {
        const ids = (p.get("filter.results.entities") || "").split(",").filter(Boolean);
        return send({ success: true, results: { entities: insightEntities(type, ids, take, type.length).slice(0, take) } });
      }
      return send({ code: 400, reason: "Bad Request", message: `Unsupported filter.type ${type}` }, 400);
    }
    send({ code: 404, reason: "Not Found", message: "No path matching request parameters" }, 404);
  }
  return { server, log };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const port = Number(process.env.PORT || 4011);
  createMockQlooServer().server.listen(port, "127.0.0.1", () => console.log(`mock qloo (harness probe) on http://127.0.0.1:${port}`));
}
