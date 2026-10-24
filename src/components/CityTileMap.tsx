"use client";

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { HeatCell } from "@/lib/agent/types";

/** Free, keyless vector tiles (OpenFreeMap, OpenStreetMap data); attribution is shown by the map. */
export const TILE_STYLE = "https://tiles.openfreemap.org/styles/dark";

export interface MapCity {
  name: string;
  lat: number;
  lon: number;
  affinity: number;
}

/**
 * Real map tiles with the urn:heatmap cells as a heat layer and the top metros
 * marked. Loads MapLibre only when shown; calls `onFail` (the caller then draws
 * its SVG map) if WebGL or the tile host isn't available.
 */
export function CityTileMap({ cells, cities, onFail }: { cells: readonly HeatCell[]; cities: readonly MapCity[]; onFail: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let map: import("maplibre-gl").Map | undefined;
    let cancelled = false;
    const fail = () => {
      if (!cancelled) onFail();
    };
    void import("maplibre-gl")
      .then(({ Map, Marker, LngLatBounds }) => {
        if (cancelled) return;
        const points = [...cells.map((c) => [c.lon, c.lat] as [number, number]), ...cities.map((c) => [c.lon, c.lat] as [number, number])];
        const bounds = points.reduce((b, p) => b.extend(p), new LngLatBounds(points[0], points[0]));
        map = new Map({ container: el, style: TILE_STYLE, bounds, fitBoundsOptions: { padding: 28 }, attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false });
        map.on("error", (e: { error?: unknown }) => {
          // A failed style or tile request before the map is drawn means no basemap: fall back.
          if (!map?.loaded()) fail();
          console.warn(`[map] ${e.error instanceof Error ? e.error.message : String(e.error)}`);
        });
        map.on("load", () => {
          if (!map) return;
          const max = Math.max(...cells.map((c) => c.affinity), 0.01);
          map.addSource("heat", {
            type: "geojson",
            data: {
              type: "FeatureCollection",
              features: cells.map((c) => ({ type: "Feature", properties: { w: c.affinity / max }, geometry: { type: "Point", coordinates: [c.lon, c.lat] } })),
            },
          });
          map.addLayer({
            id: "heat",
            type: "heatmap",
            source: "heat",
            paint: {
              "heatmap-weight": ["get", "w"],
              "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 2, 22, 6, 48],
              "heatmap-intensity": 1.6,
              "heatmap-opacity": 0.9,
              "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(143,123,255,0)", 0.3, "rgba(143,123,255,0.45)", 0.7, "#8f7bff", 1, "#b9f227"],
            },
          });
          cities.slice(0, 4).forEach((c, i) => {
            const label = document.createElement("div");
            label.className = `rounded-full px-2 py-0.5 text-caption font-semibold shadow ${i === 0 ? "bg-accent text-accent-ink" : "bg-panel text-ink"}`;
            label.textContent = `${i + 1}. ${c.name}`;
            if (map) new Marker({ element: label, anchor: "bottom", offset: [0, -4] }).setLngLat([c.lon, c.lat]).addTo(map);
          });
          setReady(true);
        });
      })
      .catch(fail);
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [cells, cities, onFail]);

  return (
    <div className="relative">
      <div ref={box} data-testid="tile-map" data-ready={ready} className="h-56 w-full overflow-hidden rounded-lg sm:h-64" aria-label="Map of audience demand by metro" role="img" />
      {!ready && <p className="absolute inset-0 grid place-items-center text-caption text-muted">Loading map…</p>}
    </div>
  );
}
