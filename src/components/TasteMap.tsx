"use client";

import "leaflet/dist/leaflet.css";
import { CircleMarker, MapContainer, Rectangle, TileLayer, Tooltip } from "react-leaflet";
import type { HeatCell, Zone } from "@/lib/types";

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
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <MapContainer
        center={center}
        zoom={12}
        scrollWheelZoom={false}
        style={{ height: 380, width: "100%" }}
        attributionControl
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
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
            }}
          >
            <Tooltip sticky>Taste affinity {Math.round(c.affinity * 100)}</Tooltip>
          </Rectangle>
        ))}
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png"
          attribution=""
          pane="shadowPane"
        />
        {zones.map((z, i) => (
          <CircleMarker
            key={`${z.label}-${i}`}
            center={[z.lat, z.lon]}
            radius={7}
            pathOptions={{ color: "#1d1b17", weight: 1.5, fillColor: "#fffdf8", fillOpacity: 1 }}
          >
            <Tooltip direction="top" offset={[0, -6]} permanent={i < 3}>
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
          className="h-2 flex-1 rounded-full"
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
