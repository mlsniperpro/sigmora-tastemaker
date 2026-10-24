/**
 * The Qloo surfaces of the playbook's depth map, and which one a request key
 * belongs to. The trace counts these, not every distinct filter.type.
 */
export const SURFACES = {
  entities: "/entities (external IDs)",
  search: "/search",
  insights: "/v2/insights, cross-domain types",
  critic: "filter.results.entities + feature.explainability (critic)",
  demographics: "urn:demographics",
  tag: "urn:tag",
  heatmap: "urn:heatmap",
  locality: "urn:entity:locality",
  location: "place + filter.location",
  trending: "/v2/trending",
  compare: "/v2/analysis/compare",
  tags: "/v2/tags (semantic search)",
} as const;
export type Surface = (typeof SURFACES)[keyof typeof SURFACES];

/** The surface a request belongs to, from its credential-free request key (`path?query`). */
export function surfaceOf(key: string): Surface {
  const [path = "", qs = ""] = key.split("?");
  const p = new URLSearchParams(qs);
  const type = p.get("filter.type") ?? "";
  if (path === "/entities") return SURFACES.entities;
  if (path === "/search") return SURFACES.search;
  if (path === "/v2/trending") return SURFACES.trending;
  if (path === "/v2/analysis/compare") return SURFACES.compare;
  if (path === "/v2/tags") return SURFACES.tags;
  if (type === "urn:demographics") return SURFACES.demographics;
  if (type === "urn:tag") return SURFACES.tag;
  if (type === "urn:heatmap") return SURFACES.heatmap;
  if (type === "urn:entity:locality") return SURFACES.locality;
  if (p.has("filter.location.query") || p.has("filter.location")) return SURFACES.location;
  if (p.has("filter.results.entities")) return SURFACES.critic;
  return SURFACES.insights;
}
