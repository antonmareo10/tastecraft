"use client";

import "leaflet/dist/leaflet.css";
import type { LeafletEvent, Path } from "leaflet";
import { useEffect } from "react";
import { CircleMarker, MapContainer, Rectangle, TileLayer, Tooltip, useMap } from "react-leaflet";
import type { HeatCell, Zone } from "@/lib/types";
import { useScrollReveal } from "./fx";

// Warm sequential ramp (paper -> saffron -> terracotta -> plum) for affinity 0..1.
function heatColor(a: number): string {
  const stops: [number, [number, number, number]][] = [
    [0, [239, 231, 216]],
    [0.45, [221, 154, 46]],
    [0.75, [192, 83, 44]],
    [1, [107, 59, 90]],
  ];
  const t = Math.min(1, Math.max(0, a));
  for (let i = 1; i < stops.length; i++) {
    const [p1, c1] = stops[i];
    const [p0, c0] = stops[i - 1];
    if (t <= p1) {
      const k = (t - p0) / (p1 - p0);
      const c = c0.map((v, j) => Math.round(v + (c1[j] - v) * k));
      return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
    }
  }
  return "rgb(107, 59, 90)";
}

type Bounds = [[number, number], [number, number]];

/** The box around the restaurant and the named hotspots: what the owner needs to see, not the whole metro heatmap. */
function focusBounds(points: [number, number][]): Bounds | null {
  const pts = points.filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon));
  if (pts.length < 2) return null;
  return [
    [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))],
    [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))],
  ];
}

// MapContainer only reads its view props once (and ignores bounds when a zoom is given), so the
// view is fitted here, again whenever the restaurant or the hotspots change.
function FitView({ bounds, center }: { bounds: Bounds | null; center: [number, number] }) {
  const map = useMap();
  const key = JSON.stringify(bounds ?? center);
  useEffect(() => {
    const view = JSON.parse(key) as Bounds | [number, number];
    if (Array.isArray(view[0])) map.fitBounds(view as Bounds, { padding: [36, 36], maxZoom: 14 });
    else map.setView(view as [number, number], 12);
  }, [map, key]);
  return null;
}

export default function TasteMap({
  cells,
  zones,
  center,
  restaurant,
}: {
  cells: HeatCell[];
  zones: Zone[];
  center: [number, number];
  restaurant?: { name: string; lat?: number; lon?: number };
}) {
  const here: [number, number][] = restaurant?.lat != null && restaurant?.lon != null ? [[restaurant.lat, restaurant.lon]] : [];
  const bounds = focusBounds([...here, ...zones.map((z): [number, number] => [z.lat, z.lon])]);
  // When the map appears, and below the fold as the person scrolls to it, the heat cells bloom
  // outwards from the restaurant (or the city centre), then the hotspots pop in (CSS in globals.css,
  // off with reduced motion; the cells are visible by default).
  const ref = useScrollReveal<HTMLDivElement>({ amount: 0.3, margin: "0px 0px -8% 0px" });
  const [oLat, oLon] = here[0] ?? center;
  const far = Math.max(1e-6, ...cells.map((c) => Math.hypot(c.lat - oLat, c.lon - oLon)));
  const delayFrom = (lat: number, lon: number, span: number) => (e: LeafletEvent) =>
    ((e.target as Path).getElement() as SVGElement | undefined)?.style.setProperty("--d", `${Math.round((Math.hypot(lat - oLat, lon - oLon) / far) * span)}ms`);
  return (
    <div
      ref={ref}
      data-bars=""
      className="tm-wrap overflow-hidden rounded-xl border border-line"
    >
      <MapContainer
        center={center}
        zoom={12}
        scrollWheelZoom={false}
        style={{ height: 380, width: "100%" }}
        attributionControl
        className="taste-map"
      >
        <FitView bounds={bounds} center={center} />
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          maxZoom={18}
        />
        {cells.map((c) => (
          <Rectangle
            key={c.geohash}
            bounds={[
              [c.bbox[0], c.bbox[1]],
              [c.bbox[2], c.bbox[3]],
            ]}
            pathOptions={{
              stroke: false,
              fillColor: heatColor(c.affinity),
              fillOpacity: 0.15 + c.affinity * 0.55,
              className: "tm-cell",
            }}
            eventHandlers={{ add: delayFrom(c.lat, c.lon, 650) }}
          >
            <Tooltip sticky>Taste affinity {Math.round(c.affinity * 100)}</Tooltip>
          </Rectangle>
        ))}
        {zones.map((z, i) => (
          <CircleMarker
            key={`${z.label}-${i}`}
            center={[z.lat, z.lon]}
            radius={7}
            pathOptions={{ color: "#1d1b17", weight: 1.5, fillColor: "#fffdf8", fillOpacity: 1, className: "tm-zone" }}
            eventHandlers={{ add: (e) => ((e.target as Path).getElement() as SVGElement | undefined)?.style.setProperty("--d", `${i * 90}ms`) }}
          >
            <Tooltip direction={i % 2 ? "bottom" : "top"} offset={[0, i % 2 ? 6 : -6]} permanent={i < 3}>
              <span className="text-[11px] font-medium">
                {i + 1}. {z.label}
              </span>
            </Tooltip>
          </CircleMarker>
        ))}
        {restaurant?.lat != null && restaurant?.lon != null && (
          <CircleMarker
            center={[restaurant.lat, restaurant.lon]}
            radius={9}
            interactive={false}
            pathOptions={{ stroke: false, fillColor: "#2f4a35", fillOpacity: 0.35, className: "tm-pulse" }}
          />
        )}
        {restaurant?.lat != null && restaurant?.lon != null && (
          <CircleMarker
            center={[restaurant.lat, restaurant.lon]}
            radius={9}
            pathOptions={{ color: "#fffdf8", weight: 3, fillColor: "#2f4a35", fillOpacity: 1 }}
          >
            <Tooltip direction="top" offset={[0, -8]}>
              <span className="text-[11px] font-semibold">{restaurant.name}</span>
            </Tooltip>
          </CircleMarker>
        )}
      </MapContainer>
      <div className="flex items-center gap-3 border-t border-line bg-card px-3 py-2 text-[11px] text-muted">
        <span>Lower affinity</span>
        <span
          className="bar-fill h-2 flex-1 rounded-full"
          style={{
            background:
              "linear-gradient(90deg, rgb(239,231,216), rgb(221,154,46), rgb(192,83,44), rgb(107,59,90))",
          }}
        />
        <span>Higher affinity</span>
      </div>
    </div>
  );
}
