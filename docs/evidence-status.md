# Evidence status: claim / do-not-claim

| Topic | Claim | Do not claim (until) |
|---|---|---|
| Qloo usage | 12 Qloo surfaces (`src/lib/agent/surfaces.ts`) wired into one agent loop, each visible in the trace; the hero run touches at least 10 (`tests/unit/surfaces.test.ts`) | That every surface returns data on the hackathon host (until `BLOCKED.md` is cleared) |
| Critic | The critic resolves every named entity, scores it with `filter.results.entities` + explainability, and replaces failures | That Qloo "approves" a campaign; it scores audience affinity |
| Culture Miss Rate | The method and script exist (`pnpm benchmark`) | Any number, until `docs/benchmark.md` is a live measurement with a real LLM (it currently says "No measurement yet" and shows no numbers) |
| Hallucinations | The agent detects names that don't resolve in Qloo | A hallucination rate for any specific model, until measured |
| Speed / ROI | A plan in one run; each run shows its own measured time and Qloo call count | Any dollar figure, or lift in reach/engagement |
| Ship | Sandbox schedule on the public demo; Sigmora `/v1` client exists | Real posting, until a real run is recorded (video) and the `/v1` contract is confirmed |
| Data | Aggregate-only, no PII | — |
| Simulator | Runs the full product offline, labeled simulated; its placeholder numbers are never shown in the web app (trace, Taste Map, chips and audits show words, shapes and ranks only); the developer tools (`pnpm demo`, `pnpm benchmark`, the MCP tools) print them, labelled "simulated" or "NOT A MEASUREMENT" | That simulated verdicts say anything about real audiences |
| Audit any AI's plan | A pasted plan's cultural names are judged by the same critic; with a live model the model lists the names, offline the scanner takes every name on a labelled line (invented ones included) plus names Qloo knows exactly | That the offline scanner finds every name in free prose |
| Traction | — | Users or campaign results, until measured |
