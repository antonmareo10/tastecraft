"use client";

import { useCallback, useId, useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import { shortLabel } from "@/lib/labels";
import type { EntityRef } from "@/lib/types";

/*
 * Taste constellation: the restaurant sits at the centre, every Qloo domain owns an
 * angular sector, and each related entity is a "star" whose distance from the centre
 * shrinks as its affinity grows. Pure SVG with a deterministic layout (same data and
 * width always produce the same picture, so SSR and the client agree).
 */

export type TasteConstellationProps = {
  center: { name: string; tags?: string[] };
  domains: Record<string, EntityRef[]>;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const MAX_PER_DOMAIN = 6;
/** Minimum affinity spread mapped onto the full radius, so near-identical scores are not exaggerated. */
const MIN_SPAN = 0.1;

const DOMAIN_ORDER = ["place", "artist", "brand", "movie", "tv_show", "book", "podcast", "destination"];

const DOMAIN_NAME: Record<string, string> = {
  place: "Places",
  artist: "Music",
  brand: "Brands",
  movie: "Movies",
  tv_show: "TV",
  book: "Books",
  podcast: "Podcasts",
  destination: "Travel",
  video_game: "Games",
  person: "People",
};

const OLIVE = "#2f4a35";
const OLIVE_2 = "#46684d";
const TERRACOTTA = "#c0532c";
const SAFFRON = "#dd9a2e";
const PLUM = "#6b3b5a";
const INK_2 = "#4a4539";
const PAPER = "#f6f1e7";
const PALETTE = [OLIVE, TERRACOTTA, SAFFRON, PLUM, INK_2, OLIVE_2];

const DOMAIN_COLOR: Record<string, string> = {
  place: OLIVE,
  artist: TERRACOTTA,
  brand: SAFFRON,
  movie: PLUM,
  tv_show: INK_2,
  book: OLIVE_2,
  podcast: PLUM,
  destination: SAFFRON,
  video_game: TERRACOTTA,
  person: OLIVE_2,
};

/**
 * Slot (angular position inside a sector) -> rank. The strongest star sits mid-sector,
 * under its domain title, and angular neighbours never hold consecutive ranks, so the
 * strongest stars do not crowd each other near the hub.
 */
const SLOT_PATTERNS: number[][] = [[], [0], [0, 1], [1, 0, 2], [2, 0, 3, 1], [1, 3, 0, 2, 4], [5, 2, 0, 3, 1, 4]];

const S = Math.SQRT1_2;
type Anchor = "start" | "middle" | "end";
const LABEL_DIRS: { dx: number; dy: number; anchor: Anchor }[] = [
  { dx: 1, dy: 0, anchor: "start" },
  { dx: -1, dy: 0, anchor: "end" },
  { dx: 0, dy: -1, anchor: "middle" },
  { dx: 0, dy: 1, anchor: "middle" },
  { dx: S, dy: -S, anchor: "start" },
  { dx: S, dy: S, anchor: "start" },
  { dx: -S, dy: -S, anchor: "end" },
  { dx: -S, dy: S, anchor: "end" },
];

const CSS = `
@keyframes tc-pop{from{opacity:0;transform:scale(.3)}to{opacity:1;transform:scale(1)}}
@keyframes tc-fade{from{opacity:0}to{opacity:1}}
@keyframes tc-draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
.tc-pop{transform-box:fill-box;transform-origin:center;animation:tc-pop .6s cubic-bezier(.2,.8,.25,1.15) both}
.tc-fade{animation:tc-fade .6s ease-out both}
.tc-draw{stroke-dasharray:1 1;animation:tc-draw .9s cubic-bezier(.3,.6,.2,1) both}
.tc-dim{transition:opacity .18s ease,stroke-opacity .18s ease}
.tc-star{outline:none}
.tc-star:focus-visible .tc-ring{stroke:#1d1b17;stroke-width:2;stroke-opacity:1}
@media (prefers-reduced-motion:reduce){.tc-pop,.tc-fade,.tc-draw{animation:none}.tc-dim{transition:none}}
`;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const f = (v: number) => Math.round(v * 10) / 10;

function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10007) / 10007;
}

function truncate(s: string, max: number): string {
  const clean = s.trim().replace(/\s+/g, " ");
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function friendlyDomain(d: string): string {
  return DOMAIN_NAME[d] ?? d.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function affinityOf(e: EntityRef): number | null {
  return typeof e.affinity === "number" && Number.isFinite(e.affinity) ? clamp(e.affinity, 0, 1) : null;
}

/** Polar radius of an axis-aligned ellipse with semi-axes a (x) and b (y) at angle `ang`. */
function ellipseR(a: number, b: number, ang: number): number {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return (a * b) / Math.sqrt((b * c) ** 2 + (a * s) ** 2);
}

/**
 * Distance from the hub for strength t (1 = strongest). Equal-area mapping: each step of
 * affinity gets the same ring area, which gives the crowded inner orbits more room while
 * keeping the order strictly monotonic (closer = stronger).
 */
function radiusFor(rIn: number, rOut: number, t: number): number {
  return Math.sqrt(rIn ** 2 + (1 - t) * (rOut ** 2 - rIn ** 2));
}

type Box = { l: number; t: number; r: number; b: number };
type Circle = { x: number; y: number; r: number };

const boxesOverlap = (a: Box, b: Box, pad: number) =>
  a.l < b.r + pad && a.r > b.l - pad && a.t < b.b + pad && a.b > b.t - pad;

function boxHitsCircle(a: Box, c: Circle): boolean {
  const nx = clamp(c.x, a.l, a.r);
  const ny = clamp(c.y, a.t, a.b);
  return (nx - c.x) ** 2 + (ny - c.y) ** 2 < c.r ** 2;
}

function textBox(anchor: Anchor, x: number, baseline: number, w: number, fs: number): Box {
  const l = anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2;
  return { l, r: l + w, t: baseline - fs * 0.8, b: baseline + fs * 0.25 };
}

/** Greedy word wrap; words longer than `max` stay on their own (over-long) line. */
function wrapWords(words: string[], max: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= max || !cur) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Fit the restaurant name inside the hub disc: the largest font at which it wraps onto
 * 1–3 lines that each fit the chord of the circle at that height; otherwise truncate.
 */
function fitName(name: string, hubR: number): { lines: string[]; fs: number } {
  const maxFs = hubR >= 40 ? 15 : 12;
  const minFs = hubR >= 40 ? 9.5 : 8;
  const words = name.split(/\s+/).filter(Boolean);
  // Characters that fit on a line when `count` lines are stacked (narrowest chord = block edge).
  const capacity = (fs: number, count: number) => {
    const edge = (count / 2) * fs * 1.08;
    return Math.floor((2 * Math.sqrt(Math.max(hubR ** 2 - edge ** 2, 0)) * 0.84) / (fs * 0.54));
  };
  for (let fs = maxFs; fs >= minFs; fs -= 0.5) {
    for (const count of [1, 2, 3]) {
      if (count === 3 && fs > 11) continue;
      const max = capacity(fs, count);
      const lines = wrapWords(words, max);
      if (lines.length <= count && lines.every((l) => l.length <= max)) return { lines, fs };
    }
  }
  const max = Math.max(4, capacity(minFs, 3));
  const lines = wrapWords(words, max);
  const kept = lines.slice(0, 3).map((l) => truncate(l, max));
  if (lines.length > 3) kept[2] = `${kept[2].slice(0, Math.max(1, max - 1)).trimEnd()}…`;
  return { lines: kept, fs: minFs };
}

// ---------------------------------------------------------------------------
// Model (width independent): domains, strengths, colours, text for AT
// ---------------------------------------------------------------------------

type ModelNode = {
  key: string;
  entity: EntityRef;
  name: string;
  domainLabel: string;
  color: string;
  rank: number;
  /** Affinity as 0–100, or null when Qloo returned no score. */
  score: number | null;
  /** Visual strength 0..1 (1 = innermost orbit, largest star). */
  t: number;
  tooltip: string;
  /** Full name, place, domain and score, for screen readers and keyboard focus. */
  ariaLabel: string;
};

type ModelSector = { domain: string; label: string; color: string; nodes: ModelNode[] };

type Model = {
  name: string;
  tags: string[];
  sectors: ModelSector[];
  total: number;
  hi: number;
  span: number;
  showTicks: boolean;
  hasUnscored: boolean;
  summary: string;
};

function buildModel(center: TasteConstellationProps["center"], domains: TasteConstellationProps["domains"]): Model | null {
  const keys = Object.keys(domains ?? {});
  const ordered = keys
    .map((d, i) => ({ d, i, o: DOMAIN_ORDER.indexOf(d) }))
    .sort((a, b) => (a.o < 0 ? 100 + a.i : a.o) - (b.o < 0 ? 100 + b.i : b.o))
    .map((x) => x.d);

  const picked = ordered
    .map((domain) => ({
      domain,
      items: (Array.isArray(domains[domain]) ? domains[domain] : [])
        .filter((e): e is EntityRef => Boolean(e && typeof e.name === "string" && e.name.trim()))
        .slice(0, MAX_PER_DOMAIN),
    }))
    .filter((p) => p.items.length > 0);
  if (!picked.length) return null;

  const scored = picked.flatMap((p) => p.items.map(affinityOf)).filter((v): v is number => v !== null);
  const hi = scored.length ? Math.max(...scored) : 1;
  const lo = scored.length ? Math.min(...scored) : 0;
  const flat = hi - lo < 0.005;
  const span = Math.max(hi - lo, MIN_SPAN);

  // Domain colours, with neighbouring sectors never sharing a colour.
  const n = picked.length;
  const colors = picked.map((p, i) => DOMAIN_COLOR[p.domain] ?? PALETTE[i % PALETTE.length]);
  for (let i = 1; i < n; i++) {
    const prev = colors[i - 1];
    const next = i === n - 1 ? (n > 2 ? colors[0] : undefined) : colors[i + 1];
    if (colors[i] === prev || colors[i] === next) {
      colors[i] = PALETTE.find((c) => c !== prev && c !== next && c !== colors[i]) ?? colors[i];
    }
  }

  let hasUnscored = false;
  const sectors: ModelSector[] = picked.map((p, si) => {
    const label = friendlyDomain(p.domain);
    const m = p.items.length;
    const nodes = p.items
      .map((entity, idx) => {
        const a = affinityOf(entity);
        if (a === null) hasUnscored = true;
        const t = a === null ? 0.72 - 0.52 * (idx / Math.max(m - 1, 1)) : flat ? 0.6 : clamp(1 - (hi - a) / span, 0, 1);
        return { entity, a, t, idx };
      })
      .sort((x, y) => y.t - x.t || x.idx - y.idx)
      .map(({ entity, a, t, idx }, rank): ModelNode => {
        const name = entity.name.trim().replace(/\s+/g, " ");
        const score = a === null ? null : Math.round(a * 100);
        const subtitle = entity.subtitle?.trim();
        const scoreText = score === null ? `affinity not scored (rank #${rank + 1})` : `affinity ${score}/100`;
        return {
          key: `${p.domain}:${entity.entity_id || name}:${idx}`,
          entity,
          name,
          domainLabel: label,
          color: colors[si],
          rank,
          score,
          t,
          tooltip: `${name}${subtitle ? ` · ${subtitle}` : ""}\n${label} — ${scoreText}`,
          ariaLabel: `${name}${subtitle ? ` (${subtitle})` : ""}, ${label}, ${score === null ? "affinity not scored" : `affinity ${score} out of 100`}`,
        };
      });
    return { domain: p.domain, label, color: colors[si], nodes };
  });

  const name = center?.name?.trim() || "Your restaurant";
  const total = sectors.reduce((s, x) => s + x.nodes.length, 0);
  const tops = sectors
    .map((s) => {
      const top = s.nodes[0];
      return `${s.label}: ${top.name}${top.score !== null ? ` (affinity ${top.score})` : ""}`;
    })
    .join("; ");
  const summary =
    `Taste constellation for ${name}: ${total} related ${total === 1 ? "entity" : "entities"} across ` +
    `${n} ${n === 1 ? "domain" : "domains"}. Strongest link per domain — ${tops}. ` +
    `Closer to the center means stronger taste affinity.`;

  return {
    name,
    tags: (center?.tags ?? []).map((t) => t?.trim()).filter((t): t is string => Boolean(t)),
    sectors,
    total,
    hi,
    span,
    showTicks: scored.length >= 2 && !flat,
    hasUnscored,
    summary,
  };
}

// ---------------------------------------------------------------------------
// Layout (width dependent, in CSS pixels: 1 viewBox unit = 1px)
// ---------------------------------------------------------------------------

type Geo = {
  W: number;
  H: number;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  hubR: number;
  rIn: number;
  nodeMin: number;
  nodeMax: number;
  compact: boolean;
  labelFs: number;
  maxChars: number;
};

function geometry(width: number, sectorCount: number): Geo {
  const W = Math.max(280, Math.round(width));
  const compact = W < 560;
  const H = Math.round(compact ? clamp(W * 1.1, 340, 480) : clamp(W * 0.6, 420, 520));
  const mx = compact ? 30 : clamp(W * 0.14, 96, 150);
  const my = compact ? 40 : 48;
  const hubR = compact ? 30 : 40;
  const nodeMax = compact ? 8.5 : 11;
  const ry = H / 2 - my;
  return {
    W,
    H,
    cx: W / 2,
    cy: H / 2,
    rx: Math.min(W / 2 - mx, ry * 1.85),
    ry,
    hubR,
    // Narrow sectors need a longer inner orbit so the strongest stars have room to breathe.
    rIn: hubR + 22 + nodeMax + 2 + clamp(sectorCount - 4, 0, 4) * (compact ? 3 : 5),
    nodeMin: compact ? 3.5 : 4,
    nodeMax,
    compact,
    labelFs: compact ? 10.5 : 11.5,
    maxChars: compact ? 14 : 18,
  };
}

type Label = { x: number; y: number; anchor: Anchor; text: string };

type LaidNode = ModelNode & {
  ang: number;
  d: number;
  x: number;
  y: number;
  r: number;
  link: string;
  label: Label | null;
  labelBox: Box | null;
  focus: Label;
  focusBox: Box;
  a0: number;
  a1: number;
};

type SectorTitle =
  | { kind: "arc"; d: string; text: string; fs: number }
  | { kind: "flat"; x: number; y: number; anchor: Anchor; text: string; fs: number };

type LaidSector = ModelSector & { wedge: string; rim: string; title: SectorTitle; nodes: LaidNode[] };

type Layout = {
  geo: Geo;
  sectors: LaidSector[];
  nodes: LaidNode[];
  orbits: string[];
  ticks: { x: number; y: number; text: string }[];
  name: { lines: string[]; fs: number };
  tags: { text: string; d: string; fs: number } | null;
};

function computeLayout(model: Model, width: number): Layout {
  const g = geometry(width, model.sectors.length);
  const { W, H, cx, cy } = g;
  const n = model.sectors.length;
  const step = TAU / n;
  const gap = Math.min(14 * DEG, step * 0.18);
  const rimOff = 7;
  const wedgeIn = g.hubR + 20;
  const pt = (ra: number, rb: number, a: number) => {
    const r = ellipseR(ra, rb, a);
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  };
  const ps = (p: { x: number; y: number }) => `${f(p.x)} ${f(p.y)}`;
  const inBounds = (b: Box) => b.l >= 4 && b.r <= W - 4 && b.t >= 4 && b.b <= H - 4;

  const obstacleBoxes: Box[] = [];
  const nodes: LaidNode[] = [];

  const sectors: LaidSector[] = model.sectors.map((s, i) => {
    const a0 = -Math.PI / 2 + i * step + gap / 2;
    const a1 = -Math.PI / 2 + (i + 1) * step - gap / 2;
    const ac = (a0 + a1) / 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;

    // --- stars -----------------------------------------------------------
    const m = s.nodes.length;
    const base = SLOT_PATTERNS[m] ?? SLOT_PATTERNS[MAX_PER_DOMAIN];
    const pattern = i % 2 ? [...base].reverse() : base;
    const slotOf: number[] = [];
    pattern.forEach((rank, slot) => {
      slotOf[rank] = slot;
    });
    const slotW = (a1 - a0) / m;

    const place = (nd: LaidNode) => {
      nd.d = radiusFor(g.rIn, ellipseR(g.rx, g.ry, nd.ang), nd.t);
      nd.x = cx + nd.d * Math.cos(nd.ang);
      nd.y = cy + nd.d * Math.sin(nd.ang);
    };
    const keepInside = (nd: LaidNode) => {
      const pad = (nd.r + 3) / Math.max(nd.d, 1);
      nd.ang = a1 - a0 > 2 * pad ? clamp(nd.ang, a0 + pad, a1 - pad) : ac;
    };

    const local = s.nodes.map((mn): LaidNode => {
      const slot = slotOf[mn.rank] ?? mn.rank;
      const nd: LaidNode = {
        ...mn,
        ang: a0 + (slot + 0.5) * slotW + (hash01(mn.key) - 0.5) * 0.36 * slotW,
        d: 0,
        x: 0,
        y: 0,
        r: g.nodeMin + (g.nodeMax - g.nodeMin) * mn.t,
        link: "",
        label: null,
        labelBox: null,
        focus: { x: 0, y: 0, anchor: "start", text: "" },
        focusBox: { l: 0, t: 0, r: 0, b: 0 },
        a0,
        a1,
      };
      place(nd);
      keepInside(nd);
      place(nd);
      return nd;
    });

    // Separate overlapping stars by sliding them along their orbit only:
    // the radius encodes affinity and must not change.
    for (let it = 0; it < 80; it++) {
      let moved = false;
      for (let p = 0; p < local.length; p++) {
        for (let q = p + 1; q < local.length; q++) {
          const A = local[p];
          const B = local[q];
          const dd = Math.hypot(B.x - A.x, B.y - A.y);
          const need = A.r + B.r + (g.compact ? 6 : 9);
          if (dd >= need) continue;
          const push = (need - dd) * 0.5 + 0.25;
          const sign = A.ang <= B.ang ? 1 : -1;
          A.ang -= (sign * push) / Math.max(A.d, 1);
          B.ang += (sign * push) / Math.max(B.d, 1);
          for (const nd of [A, B]) {
            keepInside(nd);
            place(nd);
          }
          moved = true;
        }
      }
      if (!moved) break;
    }

    for (const nd of local) {
      const sweep = 0.42;
      const start = { x: cx + (g.hubR - 2) * Math.cos(nd.ang - sweep), y: cy + (g.hubR - 2) * Math.sin(nd.ang - sweep) };
      const ctrlR = (g.hubR + nd.d) * 0.55;
      const ctrl = { x: cx + ctrlR * Math.cos(nd.ang - sweep * 0.2), y: cy + ctrlR * Math.sin(nd.ang - sweep * 0.2) };
      const endR = nd.d - nd.r - 1.5;
      const end = { x: cx + endR * Math.cos(nd.ang), y: cy + endR * Math.sin(nd.ang) };
      nd.link = `M${ps(start)} Q${ps(ctrl)} ${ps(end)}`;
      nodes.push(nd);
    }

    // --- sector furniture ------------------------------------------------
    const ra = g.rx + rimOff;
    const rb = g.ry + rimOff;
    const rim = `M${ps(pt(ra, rb, a0))} A${f(ra)} ${f(rb)} 0 ${large} 1 ${ps(pt(ra, rb, a1))}`;
    const wedge =
      `M${ps(pt(wedgeIn, wedgeIn, a0))} L${ps(pt(ra, rb, a0))} ` +
      `A${f(ra)} ${f(rb)} 0 ${large} 1 ${ps(pt(ra, rb, a1))} ` +
      `L${ps(pt(wedgeIn, wedgeIn, a1))} A${wedgeIn} ${wedgeIn} 0 ${large} 0 ${ps(pt(wedgeIn, wedgeIn, a0))}Z`;

    // --- sector title: curved along the rim, or flat on the left/right flanks ---
    const fs = g.compact ? 9.5 : 10;
    const text = s.label.toUpperCase();
    const tw = text.length * fs * 0.82 + 4;
    const off = rimOff + 10;
    const capH = fs * 0.72;
    const sinC = Math.sin(ac);
    const cosC = Math.cos(ac);

    const flatAt = () => {
      const p = pt(g.rx + off, g.ry + off, ac);
      const anchor: Anchor = Math.abs(cosC) < 0.2 ? "middle" : cosC > 0 ? "start" : "end";
      const y = p.y + fs * 0.35;
      const box = textBox(anchor, p.x, y, tw, fs);
      const shift = Math.max(4 - box.l, 0) - Math.max(box.r - (W - 4), 0);
      return {
        title: { kind: "flat", x: p.x + shift, y, anchor, text, fs } as SectorTitle,
        box: { ...box, l: box.l + shift, r: box.r + shift },
        fits: shift === 0 && inBounds(box),
      };
    };

    let title: SectorTitle | null = null;
    const flat = flatAt();
    if (Math.abs(sinC) < 0.42 && flat.fits) {
      title = flat.title;
      obstacleBoxes.push(flat.box);
    } else {
      const bottom = sinC > 0.3;
      const ta = g.rx + off + (bottom ? capH : 0);
      const tb = g.ry + off + (bottom ? capH : 0);
      const N = 360;
      const samples: { x: number; y: number; a: number; s: number }[] = [];
      let len = 0;
      for (let k = 0; k <= N; k++) {
        const a = a0 + ((a1 - a0) * k) / N;
        const p = pt(ta, tb, a);
        const prev = samples[k - 1];
        if (prev) len += Math.hypot(p.x - prev.x, p.y - prev.y);
        samples.push({ ...p, a, s: len });
      }
      if (tw + 12 <= len) {
        const s0 = len / 2 - tw / 2;
        const s1 = len / 2 + tw / 2;
        const half = fs * 0.55;
        for (const smp of samples) {
          if (smp.s < s0 || smp.s > s1) continue;
          const toward = bottom ? -capH / 2 : capH / 2; // glyphs sit outward (top) or inward (bottom) of the path
          const gx = smp.x + Math.cos(smp.a) * toward;
          const gy = smp.y + Math.sin(smp.a) * toward;
          obstacleBoxes.push({ l: gx - half, r: gx + half, t: gy - half, b: gy + half });
        }
        const d = bottom
          ? `M${ps(pt(ta, tb, a1))} A${f(ta)} ${f(tb)} 0 ${large} 0 ${ps(pt(ta, tb, a0))}`
          : `M${ps(pt(ta, tb, a0))} A${f(ta)} ${f(tb)} 0 ${large} 1 ${ps(pt(ta, tb, a1))}`;
        title = { kind: "arc", d, text, fs };
      } else {
        title = flat.title;
        obstacleBoxes.push(flat.box);
      }
    }

    return { ...s, wedge, rim, title, nodes: local };
  });

  // --- orbit guides + affinity ticks on the top axis (always a sector gap) ---
  const orbitTs = [1, 0.5, 0];
  const orbits = orbitTs.map((t) => {
    let d = "";
    const N = 144;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * TAU;
      const r = radiusFor(g.rIn, ellipseR(g.rx, g.ry, a), t);
      d += `${k ? "L" : "M"}${f(cx + r * Math.cos(a))} ${f(cy + r * Math.sin(a))}`;
    }
    return `${d}Z`;
  });

  const ticks: Layout["ticks"] = [];
  if (model.showTicks) {
    const seen = new Set<string>();
    for (const t of orbitTs) {
      const text = String(Math.round(clamp(model.hi - (1 - t) * model.span, 0, 1) * 100));
      if (seen.has(text)) continue;
      seen.add(text);
      const y = cy - radiusFor(g.rIn, g.ry, t) + 3;
      ticks.push({ x: cx, y, text });
      obstacleBoxes.push(textBox("middle", cx, y, text.length * 9 * 0.62 + 4, 9));
    }
  }

  // --- labels: greedy placement, strongest stars first, outward side only ---
  const fs = g.labelFs;
  const circles: (Circle & { key: string })[] = [
    { key: "", x: cx, y: cy, r: g.hubR + 20 },
    ...nodes.map((nd) => ({ key: nd.key, x: nd.x, y: nd.y, r: nd.r + 1.5 })),
  ];
  const widthOf = (text: string, bold: boolean, score: number | null) =>
    text.length * fs * (bold ? 0.58 : 0.54) + (score !== null && !g.compact ? 4 + String(score).length * fs * 0.85 * 0.6 : 0);

  /**
   * Label spots around a star, most outward first. Each direction also gets a nudged
   * variant (slid along the star's edge) that is tried only after every primary spot.
   */
  const candidatesFor = (nd: LaidNode, text: string, w: number, outwardOnly: boolean) => {
    const ux = Math.cos(nd.ang);
    const uy = Math.sin(nd.ang);
    const gp = 4;
    const dirs = LABEL_DIRS.map((dir) => ({ dir, score: dir.dx * ux + dir.dy * uy }))
      .filter((c) => !outwardOnly || c.score > -0.05)
      .sort((a, b) => b.score - a.score);
    const make = (dir: (typeof LABEL_DIRS)[number], nudge: number) => {
      let x: number;
      let y: number;
      if (dir.dy === 0) {
        // Beside the star: slide up or down, whichever is more outward.
        x = nd.x + dir.dx * (nd.r + gp);
        y = nd.y + fs * 0.34 + nudge * (uy < 0 ? -1 : 1) * fs * 0.6;
      } else if (dir.dx === 0) {
        // Above/below: slide sideways, toward the outward side.
        x = nd.x + nudge * (ux < 0 ? -1 : 1) * w * 0.3;
        y = dir.dy < 0 ? nd.y - nd.r - gp - fs * 0.25 : nd.y + nd.r + gp + fs * 0.8;
      } else {
        // Diagonals: move a little further away vertically.
        x = nd.x + Math.sign(dir.dx) * (nd.r * 0.72 + gp * 0.5);
        y = (dir.dy < 0 ? nd.y - nd.r * 0.72 - fs * 0.22 : nd.y + nd.r * 0.72 + fs * 0.74) + nudge * dir.dy * fs * 0.5;
      }
      const label: Label = { x, y, anchor: dir.anchor, text };
      return { label, box: textBox(dir.anchor, x, y, w, fs) };
    };
    return [...dirs.map(({ dir }) => make(dir, 0)), ...dirs.map(({ dir }) => make(dir, 1))];
  };

  /** A label must read as belonging to its own domain: its centre stays inside the star's sector. */
  const inOwnSector = (nd: LaidNode, box: Box) => {
    const theta = Math.atan2((box.t + box.b) / 2 - cy, (box.l + box.r) / 2 - cx);
    const mid = (nd.a0 + nd.a1) / 2;
    const diff = Math.atan2(Math.sin(theta - mid), Math.cos(theta - mid));
    return Math.abs(diff) <= (nd.a1 - nd.a0) / 2 + gap * 0.5;
  };

  /** How far a label box cuts into other stars (0 = clear). */
  const intrusion = (box: Box, others: Circle[]) =>
    others.reduce((sum, o) => {
      const nx = clamp(o.x, box.l, box.r);
      const ny = clamp(o.y, box.t, box.b);
      return sum + Math.max(0, o.r - Math.hypot(nx - o.x, ny - o.y));
    }, 0);

  const byPriority = [...nodes].sort((a, b) => a.rank - b.rank || b.t - a.t);
  const placed: Box[] = [];
  for (const nd of byPriority) {
    const text = shortLabel(nd.name, g.maxChars);
    const w = widthOf(text, nd.rank === 0, nd.score);
    const options = candidatesFor(nd, text, w, true).filter(
      (c) =>
        inBounds(c.box) &&
        inOwnSector(nd, c.box) &&
        !placed.some((b) => boxesOverlap(c.box, b, 2)) &&
        !obstacleBoxes.some((b) => boxesOverlap(c.box, b, 1)) &&
        !boxHitsCircle(c.box, circles[0]),
    );
    const others = circles.slice(1).filter((o) => o.key !== nd.key);
    let pick = options.find((c) => !others.some((o) => boxHitsCircle(c.box, o)));
    if (!pick && nd.rank < (g.compact ? 1 : 2)) {
      // A domain's leading stars keep their names: they may graze other stars (least
      // intrusion wins) but never hide a star's core.
      let best = Infinity;
      for (const c of options) {
        if (others.some((o) => boxHitsCircle(c.box, { ...o, r: 3.5 }))) continue;
        const cost = intrusion(c.box, others);
        if (cost < best - 0.01) {
          best = cost;
          pick = c;
        }
      }
    }
    if (pick) {
      nd.label = pick.label;
      nd.labelBox = pick.box;
      placed.push(pick.box);
    }
    // Hover/tap label: longer text, only needs to stay inside the canvas.
    const full = shortLabel(nd.name, g.compact ? 26 : 34);
    const fw = full.length * (fs + 0.5) * 0.58 + 5 + 3 * fs * 0.6; // name + "· score" tspan, always shown
    const focusOptions = candidatesFor(nd, full, fw, false);
    const fit = focusOptions.find((c) => inBounds(c.box)) ?? focusOptions[0];
    const shift = Math.max(4 - fit.box.l, 0) - Math.max(fit.box.r - (W - 4), 0);
    nd.focus = { ...fit.label, x: fit.label.x + shift };
    nd.focusBox = { ...fit.box, l: fit.box.l + shift, r: fit.box.r + shift };
  }

  // --- hub: name inside, tags curving under it ---
  let tags: Layout["tags"] = null;
  if (model.tags.length) {
    const tfs = g.compact ? 8 : 8.5;
    const rho = g.hubR + 14;
    const maxLen = Math.PI * rho * 0.86;
    let text = "";
    for (const tag of model.tags.slice(0, 6)) {
      const next = text ? `${text} · ${tag}` : tag;
      if (next.length * tfs * 0.8 > maxLen) break;
      text = next;
    }
    if (text) {
      tags = {
        text: text.toUpperCase(),
        fs: tfs,
        d: `M${f(cx - rho)} ${f(cy)} A${rho} ${rho} 0 0 0 ${f(cx + rho)} ${f(cy)}`,
      };
    }
  }

  return { geo: g, sectors, nodes, orbits, ticks, name: fitName(model.name, g.hubR), tags };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function LegendGlyph() {
  return (
    <svg width="58" height="16" viewBox="0 0 58 16" aria-hidden="true" className="shrink-0">
      <path d="M6 8 Q 30 2 52 8" fill="none" stroke={OLIVE} strokeOpacity={0.25} strokeDasharray="2 3" />
      <circle cx="6" cy="8" r="4.5" fill={OLIVE} />
      <circle cx="21" cy="6.2" r="4.2" fill={TERRACOTTA} stroke="#fffdf8" strokeWidth="1.2" />
      <circle cx="51" cy="8" r="2.4" fill={TERRACOTTA} fillOpacity={0.75} />
    </svg>
  );
}

export default function TasteConstellation({ center, domains }: TasteConstellationProps) {
  const uid = `tc${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const [width, setWidth] = useState<number | null>(null);
  const [active, setActive] = useState<string | null>(null);

  // 1 viewBox unit = 1 CSS pixel, so text stays legible from phones to wide screens.
  const measureRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    if (typeof ResizeObserver === "undefined") {
      setWidth(el.clientWidth || 720);
      return;
    }
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setWidth((prev) => (prev !== null && Math.abs(prev - w) < 1 ? prev : Math.round(w)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const model = useMemo(() => buildModel(center, domains), [center, domains]);
  const layout = useMemo(() => (model && width !== null ? computeLayout(model, width) : null), [model, width]);

  if (!model) return null;

  const activeNode = layout?.nodes.find((nd) => nd.key === active) ?? null;
  const onEnter = (key: string) => (e: ReactPointerEvent) => {
    if (e.pointerType === "mouse") setActive(key);
  };
  const onLeave = (e: ReactPointerEvent) => {
    if (e.pointerType === "mouse") setActive(null);
  };
  const onTap = (key: string) => (e: ReactPointerEvent) => {
    if (e.pointerType === "mouse") return;
    e.stopPropagation();
    setActive((cur) => (cur === key ? null : key));
  };
  const dimFor = (nd: LaidNode) =>
    !activeNode || activeNode.key === nd.key ? 1 : activeNode.domainLabel === nd.domainLabel ? 0.55 : 0.22;
  // Stars bloom outward rank by rank. The delay depends only on the star itself, so a domain
  // streaming in later never re-times (and briefly hides) stars that are already visible.
  const delay = (nd: LaidNode) => Math.round(140 + nd.rank * 110 + hash01(nd.key) * 90);

  const g = layout?.geo;

  return (
    <figure className="overflow-hidden rounded-2xl border border-line bg-card">
      <style>{CSS}</style>
      <div ref={measureRef} className="relative w-full">
        {layout && g ? (
          <svg
            viewBox={`0 0 ${g.W} ${g.H}`}
            width="100%"
            role="group"
            aria-label={model.summary}
            className="block h-auto max-h-[520px] w-full select-none"
            onPointerDown={(e) => {
              if (e.pointerType !== "mouse") setActive(null);
            }}
            onPointerLeave={onLeave}
          >
            <defs>
              <radialGradient id={`${uid}-glow`}>
                <stop offset="0%" stopColor={OLIVE} stopOpacity={0.13} />
                <stop offset="55%" stopColor={OLIVE} stopOpacity={0.04} />
                <stop offset="100%" stopColor={OLIVE} stopOpacity={0} />
              </radialGradient>
              {layout.sectors.map((s, i) =>
                s.title.kind === "arc" ? <path key={s.domain} id={`${uid}-t${i}`} d={s.title.d} fill="none" /> : null,
              )}
              {layout.tags && <path id={`${uid}-tags`} d={layout.tags.d} fill="none" />}
            </defs>

            {/* sky: centre glow, sector wedges, orbit guides, coloured rims */}
            <circle cx={g.cx} cy={g.cy} r={g.rIn + 70} fill={`url(#${uid}-glow)`} />
            {layout.sectors.map((s) => (
              <path key={`w-${s.domain}`} className="tc-fade" d={s.wedge} fill={s.color} fillOpacity={0.045} />
            ))}
            {layout.orbits.map((d, i) => (
              <path
                key={`o-${i}`}
                d={d}
                fill="none"
                className="stroke-line"
                strokeWidth={1}
                strokeDasharray={i === 2 ? undefined : "2 5"}
                strokeOpacity={i === 2 ? 0.9 : 1}
              />
            ))}
            {layout.sectors.map((s) => (
              <path
                key={`r-${s.domain}`}
                className="tc-fade"
                d={s.rim}
                fill="none"
                stroke={s.color}
                strokeOpacity={0.75}
                strokeWidth={2}
                strokeLinecap="round"
              />
            ))}

            {/* links */}
            {layout.nodes.map((nd) => {
              const on = activeNode?.key === nd.key;
              const base = 0.14 + 0.56 * nd.t;
              return (
                <path
                  key={`l-${nd.key}`}
                  className="tc-draw tc-dim"
                  pathLength={1}
                  d={nd.link}
                  fill="none"
                  stroke={nd.color}
                  strokeWidth={on ? 1.8 : 0.75 + 0.9 * nd.t}
                  strokeOpacity={on ? 0.95 : activeNode ? base * 0.3 : base}
                  strokeLinecap="round"
                  style={{ animationDelay: `${Math.max(0, delay(nd) - 120)}ms` }}
                />
              );
            })}

            {/* hub */}
            <g className="tc-pop" aria-hidden="true">
              <circle cx={g.cx} cy={g.cy} r={g.hubR + 4} fill="none" stroke={OLIVE} strokeOpacity={0.25} />
              <circle cx={g.cx} cy={g.cy} r={g.hubR} fill={OLIVE} />
              <circle cx={g.cx} cy={g.cy} r={g.hubR - 4} fill="none" stroke={PAPER} strokeOpacity={0.16} />
              <text
                x={g.cx}
                textAnchor="middle"
                className="font-display"
                fontSize={layout.name.fs}
                fill={PAPER}
              >
                <title>{model.name}</title>
                {layout.name.lines.map((line, i, all) => (
                  <tspan
                    key={i}
                    x={g.cx}
                    y={g.cy + (i - (all.length - 1) / 2) * layout.name.fs * 1.08 + layout.name.fs * 0.34}
                  >
                    {line}
                  </tspan>
                ))}
              </text>
            </g>
            {layout.tags && (
              <text
                aria-hidden="true"
                className="tc-fade fill-muted stroke-card"
                fontSize={layout.tags.fs}
                fontWeight={500}
                letterSpacing="0.14em"
                strokeWidth={3}
                paintOrder="stroke"
                strokeLinejoin="round"
                textAnchor="middle"
              >
                <textPath href={`#${uid}-tags`} startOffset="50%">
                  {layout.tags.text}
                </textPath>
              </text>
            )}

            {/* stars: each one is focusable and named in full (keyboard focus shows the full label, like hover) */}
            {layout.nodes.map((nd) => (
              <g
                key={`n-${nd.key}`}
                className="tc-dim tc-star"
                opacity={dimFor(nd)}
                role="img"
                aria-label={nd.ariaLabel}
                tabIndex={0}
                onFocus={() => setActive(nd.key)}
                onBlur={() => setActive((cur) => (cur === nd.key ? null : cur))}
                onPointerEnter={onEnter(nd.key)}
                onPointerLeave={onLeave}
                onPointerDown={onTap(nd.key)}
              >
                <g className="tc-pop" style={{ animationDelay: `${delay(nd)}ms` }}>
                  <title>{nd.tooltip}</title>
                  <circle cx={nd.x} cy={nd.y} r={Math.max(nd.r + 6, 12)} fill="transparent" />
                  {nd.rank === 0 && <circle cx={nd.x} cy={nd.y} r={nd.r + 4.5} fill={nd.color} fillOpacity={0.16} />}
                  {nd.score === null ? (
                    <circle cx={nd.x} cy={nd.y} r={nd.r - 0.8} className="fill-card" stroke={nd.color} strokeWidth={1.6} />
                  ) : (
                    <circle cx={nd.x} cy={nd.y} r={nd.r} fill={nd.color} className="stroke-card" strokeWidth={1.5} />
                  )}
                  {activeNode?.key === nd.key && (
                    <circle className="tc-ring" cx={nd.x} cy={nd.y} r={nd.r + 3} fill="none" stroke={nd.color} strokeWidth={1.2} />
                  )}
                </g>
              </g>
            ))}

            {/* affinity scale on the top axis */}
            {layout.ticks.map((t) => (
              <text
                key={`t-${t.text}`}
                aria-hidden="true"
                x={t.x}
                y={t.y}
                textAnchor="middle"
                fontSize={9}
                className="tc-fade fill-muted stroke-card tabular-nums"
                strokeWidth={3}
                paintOrder="stroke"
                strokeLinejoin="round"
              >
                {t.text}
              </text>
            ))}

            {/* sector titles */}
            {layout.sectors.map((s, i) => {
              const common = {
                fontSize: s.title.fs,
                fontWeight: 600,
                letterSpacing: "0.16em",
                strokeWidth: 3,
                paintOrder: "stroke",
                strokeLinejoin: "round" as const,
                className: "tc-fade fill-ink-2 stroke-card",
                "aria-hidden": true,
              };
              return s.title.kind === "arc" ? (
                <text key={`s-${s.domain}`} {...common} textAnchor="middle">
                  <textPath href={`#${uid}-t${i}`} startOffset="50%">
                    {s.title.text}
                  </textPath>
                </text>
              ) : (
                <text key={`s-${s.domain}`} {...common} x={s.title.x} y={s.title.y} textAnchor={s.title.anchor}>
                  {s.title.text}
                </text>
              );
            })}

            {/* labels */}
            {layout.nodes.map((nd) =>
              nd.label &&
              nd.labelBox &&
              (!activeNode || (activeNode.key !== nd.key && !boxesOverlap(nd.labelBox, activeNode.focusBox, 3))) ? (
                <g key={`lb-${nd.key}`} aria-hidden="true" className="tc-dim" opacity={dimFor(nd)}>
                  <text
                    x={nd.label.x}
                    y={nd.label.y}
                    textAnchor={nd.label.anchor}
                    fontSize={g.labelFs}
                    fontWeight={nd.rank === 0 ? 600 : 400}
                    className={`tc-fade stroke-card ${nd.rank === 0 ? "fill-ink" : "fill-ink-2"}`}
                    strokeWidth={3}
                    paintOrder="stroke"
                    strokeLinejoin="round"
                    style={{ animationDelay: `${delay(nd) + 120}ms` }}
                    onPointerEnter={onEnter(nd.key)}
                    onPointerLeave={onLeave}
                    onPointerDown={onTap(nd.key)}
                  >
                    <title>{nd.tooltip}</title>
                    {nd.label.text}
                    {nd.score !== null && !g.compact && (
                      <tspan dx={4} fontSize={g.labelFs * 0.85} fontWeight={500} className="fill-muted tabular-nums">
                        {nd.score}
                      </tspan>
                    )}
                  </text>
                </g>
              ) : null,
            )}

            {/* focused star: full name + score, drawn last so it sits on top */}
            {activeNode && (
              <text
                aria-hidden="true"
                x={activeNode.focus.x}
                y={activeNode.focus.y}
                textAnchor={activeNode.focus.anchor}
                fontSize={g.labelFs + 0.5}
                fontWeight={600}
                className="pointer-events-none fill-ink stroke-card"
                strokeWidth={4}
                paintOrder="stroke"
                strokeLinejoin="round"
              >
                {activeNode.focus.text}
                <tspan dx={5} fontWeight={500} className="fill-muted tabular-nums">
                  {activeNode.score !== null ? activeNode.score : "n/a"}
                </tspan>
              </text>
            )}
          </svg>
        ) : (
          <div aria-hidden="true" className="h-[400px] sm:h-[480px]" />
        )}
      </div>

      <figcaption className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-line px-4 py-2.5 text-[11px] leading-tight text-muted">
        <span className="inline-flex items-center gap-2">
          <LegendGlyph />
          <span>
            <span className="font-semibold text-ink-2">closer</span> = stronger taste affinity
          </span>
        </span>
        {model.showTicks && <span>rings = affinity score (0–100)</span>}
        {model.hasUnscored && (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full border border-ink-2" />
            hollow = ranked, no score
          </span>
        )}
        <span className="sm:ml-auto">Hover, tap or tab to a star for details</span>
      </figcaption>

    </figure>
  );
}
