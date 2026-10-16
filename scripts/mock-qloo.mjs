// DEV-ONLY mock of the Qloo hackathon API, shaped after docs/QLOO_API_NOTES.md.
// Lets us exercise the real Claude agent loop before the Qloo key arrives. Data is synthetic.
// Usage: node scripts/mock-qloo.mjs  (listens on :4010)
import http from "node:http";

const tag = (id, name, type) => ({ id, name, type });
const restaurantTags = [
  tag("urn:tag:genre:place:restaurant:spanish", "Spanish", "urn:tag:genre:place"),
  tag("urn:tag:cuisine:qloo:tapas", "Tapas", "urn:tag:cuisine:qloo"),
  tag("urn:tag:ambience:qloo:traditional", "Traditional", "urn:tag:ambience:qloo"),
];
const pick = (arr, n, seed) => arr.map((x, i) => ({ x, k: Math.sin(i * 12.9898 + seed) })).sort((a, b) => a.k - b.k).slice(0, n).map((o) => o.x);

const placeTags = [
  tag("t1", "Vermouth", "urn:tag:menu_highlight:qloo"), tag("t2", "Natural wine", "urn:tag:menu_highlight:qloo"),
  tag("t3", "Wine bar", "urn:tag:genre:place"), tag("t4", "Late night", "urn:tag:ambience:qloo"),
  tag("t5", "Japanese", "urn:tag:genre:place"), tag("t6", "Brunch", "urn:tag:dining_options:place"),
  tag("t7", "Croquetas", "urn:tag:specialty_dish:place"), tag("t8", "Lively", "urn:tag:ambience:qloo"),
];

function entities(type, n, seed) {
  return Array.from({ length: n }, (_, i) => ({
    entity_id: `MOCK-${type}-${i + 1}`,
    name: `Mock ${type} ${i + 1}`,
    types: [`urn:entity:${type}`],
    popularity: Number((0.95 - i * 0.03).toFixed(2)),
    query: { affinity: Number((0.97 - i * 0.035).toFixed(3)) },
    properties: type === "place" ? { address: `Calle Mock ${i + 1}, Madrid`, price_level: 2 + (i % 3), business_rating: 4.1 + (i % 5) / 10 } : {},
    tags: type === "place" ? pick(placeTags, 3, seed + i) : [],
  }));
}

function heatmap() {
  const out = [];
  const chars = "0123456789bcdefghjkmnpqrstuvwxyz";
  for (let i = 0; i < 60; i++) {
    const gh = "ezjmg" + chars[(i * 7) % 32] + chars[(i * 11) % 32];
    out.push({ location: { geohash: gh, latitude: 40.4 + (i % 8) * 0.01, longitude: -3.72 + Math.floor(i / 8) * 0.01 }, query: { affinity: Number(Math.abs(Math.sin(i)).toFixed(3)) } });
  }
  return out;
}

function candidates(name) {
  const place = (entity_id, n, address, lat, lon, popularity) => ({
    entity_id, name: n, types: ["urn:entity:place"], popularity,
    properties: { address, price_level: 3, business_rating: 4.5, geocode: { city: "Madrid", name: "Madrid" } },
    location: { lat, lon }, tags: restaurantTags,
  });
  return [
    place("MOCK-R1", name, "Calle Mock 35, Madrid", 40.4123, -3.7089, 0.82),
    place("MOCK-R2", name, "Avenida Mock 99, Madrid", 40.4301, -3.6912, 0.41),
    place("MOCK-R3", "Mock Bistro", "Rua Mock 7, Lisboa", 38.7223, -9.1393, 0.3),
  ];
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.searchParams;
  const send = (obj) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(obj));
  };
  if (url.pathname === "/search") {
    // Two branches with the same name plus an unrelated place, to exercise match resolution.
    const name = (p.get("query") || "Mock").split(" ").slice(0, 2).join(" ");
    return send({ results: candidates(name) });
  }
  if (url.pathname === "/entities") {
    const ids = (p.get("entity_ids") || "").split(",");
    return send({ results: candidates("Mock").filter((c) => ids.includes(c.entity_id)) });
  }
  if (url.pathname === "/v2/analysis/compare") {
    return send({ results: { tags: placeTags.slice(0, 6).map((t, i) => ({ tag_id: t.id, name: t.name, subtype: t.type, query: { score: 0.8 - i * 0.1 } })) } });
  }
  if (url.pathname === "/v2/insights") {
    const type = p.get("filter.type") || "";
    if (type === "urn:heatmap") return send({ success: true, results: { heatmap: heatmap() } });
    if (type === "urn:demographics") return send({ success: true, results: { demographics: [{ entity_id: "MOCK-R1", query: { age: { "24_and_younger": -0.12, "25_to_29": 0.31, "30_to_34": 0.52, "35_to_44": 0.18, "45_to_54": -0.21, "55_and_older": -0.4 }, gender: { male: 0.06, female: -0.06 } } }] } });
    if (type === "urn:tag") return send({ success: true, results: { tags: placeTags.map((t, i) => ({ tag_id: t.id, name: t.name, subtype: t.type, query: { affinity: 0.95 - i * 0.07 } })) } });
    const short = type.replace("urn:entity:", "");
    return send({ success: true, results: { entities: entities(short, Number(p.get("take") || 12), short.length) } });
  }
  res.writeHead(404);
  res.end("{}");
});
server.listen(4010, () => console.log("mock qloo on :4010"));
