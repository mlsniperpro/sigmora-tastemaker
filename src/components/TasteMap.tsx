"use client";

import { useCallback, useMemo, useState } from "react";
import type { HeatCell, RunResult } from "@/lib/agent/types";
import { CityTileMap, type MapCity } from "./CityTileMap";
import { affinityWeb } from "@/lib/agent/web";

const pct = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v * 100)}`;

function Panel({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-panel-2/60 p-2.5 sm:p-3">
      <h3 className="text-meta font-semibold uppercase tracking-wider text-muted">{title}</h3>
      {sub && <p className="mb-2 text-caption text-muted/80">{sub}</p>}
      {children}
    </div>
  );
}

/**
 * Signed over-index bars around a zero line (diverging: violet = over, grey = under).
 * `plain`: simulated data, so the bars keep their shape and sign but print no value.
 */
function Diverging({ rows, plain }: { rows: { label: string; value: number; hint?: string }[]; plain: boolean }) {
  const max = Math.max(0.01, ...rows.map((r) => Math.abs(r.value)));
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => {
        const w = (Math.abs(r.value) / max) * 50;
        return (
          <li
            key={r.label}
            className={`grid items-center gap-2 text-caption ${plain ? "grid-cols-[6.5rem_1fr]" : "grid-cols-[6.5rem_1fr_2.5rem]"}`}
            title={plain ? `${r.label}: ${r.value >= 0 ? "over-indexes" : "under-indexes"} (simulated)` : (r.hint ?? `${r.label}: ${pct(r.value)}`)}
          >
            <span className="truncate text-ink/80">{r.label}</span>
            <span className="relative h-3">
              <span className="absolute left-1/2 top-0 h-3 w-px bg-line" aria-hidden />
              <span
                className={`absolute top-0.5 h-2 rounded ${r.value >= 0 ? "bg-violet" : "bg-muted/50"}`}
                style={r.value >= 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }}
              />
            </span>
            {!plain && <span className="text-right font-mono text-muted">{pct(r.value)}</span>}
          </li>
        );
      })}
    </ul>
  );
}

// Stylized outline of the contiguous US (lon, lat); decorative context only.
const US: [number, number][] = [
  [-124.7, 48.4], [-124.2, 42], [-124.4, 40.4], [-122.4, 37.8], [-120.6, 34.6], [-117.1, 32.5], [-114.7, 32.7], [-111, 31.3],
  [-108.2, 31.3], [-106.5, 31.8], [-104.5, 29.6], [-103, 29], [-101.4, 29.8], [-99.5, 27.5], [-97.4, 25.9], [-97.4, 27.8],
  [-94.7, 29.4], [-90, 29.1], [-89.2, 30.3], [-85.3, 29.7], [-84, 30.1], [-82.8, 27.9], [-81.7, 25.2], [-80.4, 25.2],
  [-80, 26.8], [-81.3, 30.7], [-79.2, 33.2], [-75.5, 35.2], [-76.3, 37], [-75, 38.6], [-74, 40.5], [-71.9, 41.3],
  [-70, 41.8], [-70.6, 42.9], [-67, 44.8], [-67.8, 47.1], [-69.2, 47.4], [-71.5, 45], [-74.9, 45], [-76.8, 43.6],
  [-79, 43.3], [-82.4, 41.7], [-82.5, 45.3], [-84.6, 46.5], [-88.4, 48.3], [-89.6, 48], [-95.2, 49], [-123, 49],
];
const W = 320;
const H = 190;
const px = (lon: number) => ((lon + 125) / 59) * W;
const py = (lat: number) => ((50 - lat) / 26) * H;

/** Tiles unless they're switched off (NEXT_PUBLIC_MAP_TILES=off) or fail to load; then the SVG map below. */
function CityMap({ result }: { result: RunResult }) {
  const located = useMemo(() => locatedCities(result), [result]);
  const cells = useMemo(() => (result.heatmap.length ? result.heatmap : located.map((c) => ({ lat: c.lat, lon: c.lon, affinity: c.affinity }))), [result.heatmap, located]);
  const [tiles, setTiles] = useState(process.env.NEXT_PUBLIC_MAP_TILES !== "off");
  const noTiles = useCallback(() => setTiles(false), []);
  if (!cells.length) return null;
  const caption = (
    <p className="mt-1 text-meta text-muted">
      {result.heatmap.length ? `${result.heatmap.length} urn:heatmap cells; brighter = higher affinity.` : "Metro affinity."}
      {result.cities[0] ? ` Numbered: top metros, ${result.cities[0].name} first (ranked by ${result.citiesRankedBy}).` : ""}
    </p>
  );
  if (tiles) {
    return (
      <div>
        <CityTileMap cells={cells} cities={located} onFail={noTiles} />
        {caption}
      </div>
    );
  }
  return <SvgCityMap result={result} cells={cells} located={located} />;
}

/** Whether a map label at this longitude reads leftward: in the East (it would leave the drawing) or the centre. */
const leftward = (lon: number) => px(lon) > W * 0.7 || (px(lon) > W * 0.3 && px(lon) < W * 0.5);

/** The located top metros, in rank order. */
const locatedCities = (result: RunResult) => result.cities.filter((c): c is typeof c & { lat: number; lon: number } => c.lat !== undefined && c.lon !== undefined);

/** Dots sized by affinity on the stylized US outline, with the top metros labelled; no network, no WebGL. */
function UsDots({
  result,
  cells,
  located,
  className = "h-auto w-full",
  label = "Audience demand across the US",
  labelSize = 12,
}: {
  result: RunResult;
  cells: readonly HeatCell[];
  located: readonly MapCity[];
  className?: string;
  label?: string;
  /** In viewBox units: a smaller drawing needs larger units for the same on-screen size. */
  labelSize?: number;
}) {
  const plain = result.qloo.simulated > 0;
  const max = Math.max(...cells.map((p) => p.affinity), 0.01);
  // Draw weakest first so the strongest cells sit on top.
  const ordered = [...cells].sort((a, b) => a.affinity - b.affinity);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} role="img" aria-label={label}>
      <polygon points={US.map(([lo, la]) => `${px(lo)},${py(la)}`).join(" ")} className="fill-panel-2 stroke-line" strokeWidth={1} />
      {ordered.map((p, i) => (
        <circle key={i} cx={px(p.lon)} cy={py(p.lat)} r={2 + (p.affinity / max) * 7} className="fill-violet/40 stroke-bg" strokeWidth={1}>
          {!plain && <title>{`affinity ${p.affinity.toFixed(2)}`}</title>}
        </circle>
      ))}
      {located.slice(0, 4).map((c, i) => (
        <g key={c.name}>
          <circle cx={px(c.lon)} cy={py(c.lat)} r={i === 0 ? 5 : 3} className={i === 0 ? "fill-accent stroke-bg" : "fill-ink stroke-bg"} strokeWidth={1.5} />
          {/* East-coast labels run leftward so they stay inside the drawing, and so do central ones, clear of the South-East's. */}
          <text
            x={px(c.lon) + (leftward(c.lon) ? -7 : 7)}
            y={py(c.lat) - 6}
            textAnchor={leftward(c.lon) ? "end" : "start"}
            className={i === 0 ? "fill-accent" : "fill-ink"}
            style={{ fontSize: labelSize, fontWeight: i === 0 ? 600 : 400 }}
          >
            {i + 1}. {c.name}
          </text>
        </g>
      ))}
    </svg>
  );
}

function SvgCityMap({ result, cells, located }: { result: RunResult; cells: readonly HeatCell[]; located: readonly MapCity[] }) {
  const winner = result.cities[0];
  return (
    <div>
      {/* 13 units: the drawing is a little narrower than its viewBox at phone width, and labels stay at 12 px or more. */}
      <UsDots result={result} cells={cells} located={located} labelSize={13} />
      <p className="mt-1 text-meta text-muted">
        {result.heatmap.length ? `${result.heatmap.length} urn:heatmap cells; size = affinity.` : "Metro affinity."} Labels: top metros
        {winner ? `, ${winner.name} first` : ""} (ranked by {result.citiesRankedBy}). Outline is stylized.
      </p>
    </div>
  );
}

/** Whether the run ranked metros to launch in (not a fixed market), with at least one on the map. */
export const hasLaunchMap = (result: RunResult) => (result.citiesRankedBy === "locality" || result.citiesRankedBy === "heatmap") && locatedCities(result).length > 0;

/**
 * The launch decision at a glance, for the first screen on desktop: the ranked metros on the stylized
 * outline, no values (the Taste Map below has the tiles, the numbers and the full ranking).
 */
export function LaunchMap({ result }: { result: RunResult }) {
  const located = locatedCities(result);
  const cells = result.heatmap.length ? result.heatmap : located.map((c) => ({ lat: c.lat, lon: c.lon, affinity: c.affinity }));
  const top = result.cities.slice(0, 3).map((c) => c.name);
  return (
    <div className="min-w-0">
      <h3 className="text-meta font-semibold text-ink">Where to launch</h3>
      <UsDots result={result} cells={cells} located={located} className="mt-1 h-40 w-full" labelSize={15} label={`Where to launch: ${top.join(", ")}, ranked by audience affinity`} />
      <p className="mt-1 text-meta leading-snug text-muted">
        Ranked by {result.citiesRankedBy === "heatmap" ? "the urn:heatmap cells around each metro" : "audience affinity (urn:entity:locality)"}
        {result.qloo.simulated > 0 ? " in the simulator" : ""}. Stylized outline; the Taste Map has the full map.
      </p>
    </div>
  );
}

/** Ranked bars; `plain` (simulated data) keeps the rank order and bar lengths but prints no score. */
function Rank({ rows, plain }: { rows: { name: string; affinity: number }[]; plain: boolean }) {
  const max = Math.max(0.01, ...rows.map((r) => r.affinity));
  return (
    <ol className="space-y-1">
      {rows.map((r, i) => (
        <li
          key={r.name}
          className={`grid items-center gap-2 text-caption ${plain ? "grid-cols-[1rem_6rem_1fr]" : "grid-cols-[1rem_6rem_1fr_2.2rem]"}`}
          title={plain ? `${r.name}: rank ${i + 1} (simulated)` : `${r.name}: ${r.affinity.toFixed(2)}`}
        >
          <span className="font-mono text-muted">{i + 1}</span>
          <span className={`truncate ${i === 0 ? "font-semibold text-accent" : "text-ink/80"}`}>{r.name}</span>
          <span className="h-2 rounded bg-panel">
            <span className={`block h-2 rounded ${i === 0 ? "bg-accent" : "bg-violet/70"}`} style={{ width: `${(r.affinity / max) * 100}%` }} />
          </span>
          {!plain && <span className="text-right font-mono text-muted">{r.affinity.toFixed(2)}</span>}
        </li>
      ))}
    </ol>
  );
}

const TYPE_LABEL: Record<string, string> = {
  artist: "artist",
  brand: "brand",
  tv_show: "show",
  movie: "film",
  podcast: "podcast",
  person: "creator",
  place: "venue",
  locality: "city",
};

/** Inputs (left) → picks (right); an edge where Qloo's explainability says that input drove that pick. */
function AffinityWeb({ result }: { result: RunResult }) {
  const plain = result.qloo.simulated > 0;
  const web = affinityWeb(result);
  if (!web.picks.length || !web.inputs.length) return null;
  // Sized so the 12-unit labels draw at 12 px or more at phone width (the panel is ~314 px wide at 390), and capped on desktop.
  const W = 300;
  const ROW = 24;
  const H = Math.max(web.picks.length, web.inputs.length) * ROW + 8;
  const xIn = 88;
  const xPick = 158;
  const yPick = (i: number) => 14 + i * ROW;
  const yIn = (i: number) => 14 + ((web.picks.length - 1) * ROW * (i + 0.5)) / web.inputs.length;
  const max = Math.max(...web.edges.map((e) => e.weight), 0.01);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto h-auto w-full max-w-[360px]" role="img" aria-label="Cross-domain affinity web: which seed drove which pick">
      {web.edges.map((e, i) => (
        <path
          key={i}
          d={`M ${xIn} ${yIn(e.input)} C ${(xIn + xPick) / 2} ${yIn(e.input)}, ${(xIn + xPick) / 2} ${yPick(e.pick)}, ${xPick} ${yPick(e.pick)}`}
          className="fill-none stroke-violet"
          strokeOpacity={0.2 + (e.weight / max) * 0.7}
          strokeWidth={0.75 + (e.weight / max) * 3}
        >
          <title>{`${web.inputs[e.input] ?? ""} → ${web.picks[e.pick]?.name ?? ""}${plain ? " (simulated)" : `: explainability ${e.weight.toFixed(2)}`}`}</title>
        </path>
      ))}
      {web.inputs.map((n, i) => (
        <g key={n}>
          <circle cx={xIn} cy={yIn(i)} r={5} className="fill-accent" />
          <text x={xIn - 9} y={yIn(i)} textAnchor="end" dominantBaseline="middle" className="fill-ink" style={{ fontSize: 12 }}>
            {n.length > 11 ? `${n.slice(0, 10)}…` : n}
          </text>
        </g>
      ))}
      {web.picks.map((p, i) => (
        <g key={`${p.role}-${p.name}`}>
          <circle cx={xPick} cy={yPick(i)} r={4.5} className={p.verdict === "pass" ? "fill-pass" : p.verdict === "fading" ? "fill-fade" : "fill-miss"}>
            <title>{`${p.name} (${TYPE_LABEL[p.type] ?? p.type})${plain ? "" : `: affinity ${p.affinity?.toFixed(2) ?? "—"}`}`}</title>
          </circle>
          <text x={xPick + 9} y={yPick(i)} dominantBaseline="middle" className="fill-ink" style={{ fontSize: 12 }}>
            {p.name.length > 12 ? `${p.name.slice(0, 11)}…` : p.name}
            <tspan className="fill-muted" style={{ fontSize: 12 }}>{` ${TYPE_LABEL[p.type] ?? p.type}`}</tspan>
          </text>
        </g>
      ))}
    </svg>
  );
}

/**
 * The Taste Map. On simulated data (no Qloo key) every panel keeps its shapes and ranks but prints no
 * value: the simulator's numbers are placeholders, and the header says the data is simulated.
 */
export function TasteMap({ result }: { result: RunResult }) {
  const { audience } = result;
  const plain = result.qloo.simulated > 0;
  const gap = result.positioning.slice(0, 6);
  return (
    <section aria-label="Taste Map" className="space-y-3 rounded-2xl border border-line bg-panel p-3 sm:p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <h2 className="text-sm font-semibold tracking-wide text-ink">
          Taste Map
          {result.qloo.simulated > 0 && <span className="ml-2 rounded bg-fade/15 px-1.5 py-0.5 text-caption font-medium text-fade">simulated data, not Qloo</span>}
        </h2>
        <span className="text-meta text-muted">seeded from {result.seeds.filter((s) => s.entityId).map((s) => s.name).join(", ")}</span>
      </header>

      {audience.age.length > 0 && (
        <Panel
          title="Who over-indexes"
          sub={plain ? "urn:demographics — bar length and side show the simulated over- (right) or under-index (left); values hidden" : "urn:demographics — signed affinity vs. the average audience, ×100 (+ over-indexes, − under)"}
        >
          <Diverging
            plain={plain}
            rows={[
              ...audience.age.map((a) => ({ label: a.bucket.replace(/_/g, " "), value: a.value })),
              ...audience.gender.map((g) => ({ label: g.bucket, value: g.value })),
            ]}
          />
        </Panel>
      )}

      {audience.tags.length > 0 && (
        <Panel title="Taste vocabulary" sub="urn:tag — the words this audience's taste is described in (feeds the copy)">
          <ul className="flex flex-wrap gap-1.5">
            {audience.tags.map((t) => (
              <li key={t.name} className="rounded-full border border-line px-2 py-0.5 text-caption text-ink/85" title={plain ? undefined : `affinity ${t.affinity.toFixed(2)}`}>
                {t.name}
                {!plain && <span className="font-mono text-muted"> {t.affinity.toFixed(2)}</span>}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {(result.heatmap.length > 0 || result.cities.length > 0) && (
        <Panel
          title={result.citiesRankedBy === "in-city" ? `Where in ${result.brief.targetCity ?? "the city"}` : "Where to launch"}
          sub={
            result.citiesRankedBy === "in-city"
              ? `Neighbourhood-scale audience affinity inside the brief's market (urn:heatmap + filter.location.query=${result.brief.targetCity ?? ""})`
              : result.citiesRankedBy === "heatmap"
                ? "Candidate metros ranked by the urn:heatmap cells around them (locality ranking came back empty)"
                : "Candidate metros ranked by audience affinity (urn:entity:locality + filter.results.entities)"
          }
        >
          <CityMap result={result} />
          {result.cities.length > 0 && (
            <div className="mt-2">
              <Rank rows={result.cities.slice(0, 6)} plain={plain} />
            </div>
          )}
        </Panel>
      )}

      <Panel title="Cross-domain affinity web" sub="Which of your seeds drove each pick, across domains (Qloo explainability); line weight = contribution">
        <AffinityWeb result={result} />
      </Panel>

      {gap.length > 0 && (
        <Panel title={`Positioning vs. ${result.compareTo}`} sub="/v2/analysis/compare — where your audience leans (+) or doesn't (−) vs. theirs">
          <Diverging plain={plain} rows={gap.map((g) => ({ label: g.name, value: g.delta, hint: `${g.name}: yours ${g.a.toFixed(2)} vs theirs ${g.b.toFixed(2)}` }))} />
        </Panel>
      )}
    </section>
  );
}
