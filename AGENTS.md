# AGENTS.md: Tastemaker by Sigmora (Qloo Agentic Hackathon entry)

**Read [docs/PLAYBOOK.md](docs/PLAYBOOK.md) in full before any change.** It's the winning plan (written 2026-10-06), with the rules, the product, the Qloo depth map, the architecture, the benchmark, the design spec, the P0/P1/P2 cutoff ladder and the submission copy. This file adds what changed since then and how to work in this repo.

## What changed since the playbook (re-verified 2026-10-20)

- **Deadline is unchanged:** Oct 30, 2026 23:45 ET = **Oct 31 06:45 EAT**. **Internal feature freeze: Oct 29 18:00 EAT.** Judging Nov 2–16; winners ~Nov 23. **The demo must stay live and free, with no restriction, through Nov 16.**
- **New on the overview page (not in the Official Rules):** "Jason Calacanis … will personally invest an additional $25,000 into his favorite entry". So traction and an investable story matter: real users, a real ROI line, and a clear market. Keep the "dogfood" P1 item.
- **Hard requirements:**
  - a **publicly hosted live demo** ("only run locally … will not qualify");
  - a **public** repo with **all source needed to run it** and an open-source licence visible in About (MIT, per the playbook);
  - a text description.
  - No video is required, but the judges may judge on text, images and video alone, so make the ≤ 2-minute video anyway.
- **Nothing is built yet.** You're starting from this repo with only these docs. The schedule in playbook §10 is out of date. **Use the dates below.**

## The schedule from today (EAT)

| When | Goal |
|---|---|
| Oct 20–22 | Scaffold with official CLIs (`create-next-app`, pnpm); typed Qloo client (live + replay fixtures); deterministic providers so the repo runs with **zero credentials**; agent loop skeleton; `pnpm test` green |
| Oct 23–25 | Critic loop + explainability receipts; "Without Qloo" toggle; Taste Map UI; hero preset end to end on the hosted URL with no login (**all P0**) |
| Oct 26–28 | P1 in ladder order (heatmap, trending, compare, entity seeding, the 2 extra presets, the Culture Miss Rate benchmark, Sigmora `/v1` sandbox publisher); polish at 390 px and desktop; `SUBMISSION.md` + all repo docs |
| **Oct 29 18:00** | Freeze. Fixes only. The owner submits Oct 29–30 |

## How to work here

- **Branch:** `tastemaker`. Commit and push after every green step. Open a PR to `main` with evidence (test output, screenshots, hosted-preview URL if available).
- **Checks before each push:** `pnpm lint && pnpm typecheck && pnpm test`. Don't run `next build` locally; the hosted deploy builds it.
- **Qloo key:** the hackathon key works only on `hackathon.api.qloo.com` (header `X-Api-Key`, GET). Unsupported params are silently dropped and return empty results; see the playbook's engineering rules.
  - In the cloud session the key is a **network secret** if the owner has added it. Otherwise, build against replay fixtures and add `BLOCKED.md` listing the live calls still to verify.
- **Sigmora:** call it only through HTTPS `/v1` with a bearer token from env that the model never sees (sandbox publisher by default). **Nothing in this repo may import private Sigmora code.** The "wired into an agent we already have" items in playbook §5 live in the private `sigmora-platform` repo and are **out of scope here**.
- **Model-swappable:** provider and model from env; never pin a vendor.
- **Every number in the README, benchmark or submission comes from a script in this repo.**

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
