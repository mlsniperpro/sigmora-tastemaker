"use client";

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { HeatCell } from "@/lib/agent/types";

const LABEL_H = 20;
const overlaps = (a: { x0: number; x1: number; y0: number; y1: number }, b: typeof a) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

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
        map = new Map({ container: el, style: TILE_STYLE, bounds, fitBoundsOptions: { padding: { top: 48, bottom: 24, left: 24, right: 24 } }, attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false });
        map.on("error", (e: { error?: unknown }) => {
          // A failed style or tile request before the map is drawn means no basemap: fall back.
          if (!map?.loaded()) fail();
          console.warn(`[map] ${e.error instanceof Error ? e.error.message : String(e.error)}`);
        });
        // The basemap style names sprite icons (e.g. "circle-11") it doesn't ship; supply a transparent 1×1 so none are missing.
        map.on("styleimagemissing", (e: { id: string }) => {
          if (map && !map.hasImage(e.id)) map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
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
          // Labels grow away from the nearer edge (east-coast metros extend west), and a label that would overlap one
          // already placed moves up a row, so every name stays readable on a phone.
          const width = el.clientWidth;
          const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
          cities.slice(0, 4).forEach((c, i) => {
            if (!map) return;
            const label = document.createElement("div");
            label.className = `whitespace-nowrap rounded-full px-2 py-0.5 text-caption font-semibold shadow ${i === 0 ? "bg-accent text-accent-ink" : "bg-panel text-ink"}`;
            label.textContent = `${i + 1}. ${c.name}`;
            const at = map.project([c.lon, c.lat]);
            const east = at.x > width / 2;
            const w = label.textContent.length * 7 + 18;
            let lift = 4;
            const box = () => ({ x0: east ? at.x - w : at.x, x1: east ? at.x : at.x + w, y0: at.y - lift - LABEL_H, y1: at.y - lift });
            for (let tries = 0; tries < 4 && placed.some((p) => overlaps(p, box())); tries++) lift += LABEL_H + 2;
            placed.push(box());
            new Marker({ element: label, anchor: east ? "bottom-right" : "bottom-left", offset: [east ? 6 : -6, -lift] }).setLngLat([c.lon, c.lat]).addTo(map);
          });
          // On a phone the open attribution card would cover the map; the (i) button keeps it one tap away.
          if (width < 640) el.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
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
