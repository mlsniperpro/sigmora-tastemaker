# Demo video script (≤ 2 minutes)

The video is optional, but judges may score on text, images and video alone, so it carries the whole pitch. `pnpm video <live demo URL>` records the screen part (1440 × 900, on-screen captions, about 90 s, every segment below) to `video/tastemaker-walkthrough.webm`. It records the segments in the table's order; record the voice-over below on top of it.

Record against the live deployment **with the Qloo and LLM keys set**. If a "simulated" data note shows at the top of the diff card, the keys aren't set: stop and fix that first, because the video must show real Qloo data.

## Shot list and voice-over

| Time | Screen | Voice-over |
|---|---|---|
| 0:00–0:10 | Home page loads; the hero preset (indie Afro-fusion single) starts running | "AI marketing agents are confident about culture they've never measured. Tastemaker is a marketing agent that checks every cultural pick with Qloo before it ships." |
| 0:10–0:25 | The agent trace fills in; open one step to show its parameters | "Every step is a Qloo call: who over-indexes, the audience's own taste vocabulary, a cross-domain culture map, where to launch, what's rising, and how this audience differs from a comparable one." |
| 0:25–0:35 | Scroll to the Taste Map | "The Taste Map shows where to play first and why, straight from Qloo's heatmap of this audience across the US." |
| 0:35–0:50 | Campaign pack; open one receipt chip | "The model proposes. Qloo is the critic: it scores every pick against this audience, and anything weak or invented gets replaced. Every pick that survives carries a receipt: the affinity, what drove it, its trend, and the exact Qloo call." |
| 0:50–1:05 | Flip **Without Qloo** | "Here's the same model with no Qloo. Names that don't exist, references this audience doesn't care about, the wrong city. The diff card puts both plans side by side on every run." |
| 1:05–1:20 | Click **Paste any AI's plan →**, then **Try a sample plan** | "And it isn't only our agent. Paste a plan from any chatbot, and the same Qloo critic checks every cultural name in it, with a receipt and a better pick for each miss." |
| 1:20–1:35 | Sports club preset, then the DTC preset | "It works across categories: a football club choosing its first US watch-party city, or a skincare brand entering Atlanta." |
| 1:35–1:45 | Ship section; click **Schedule with Sigmora** | "Then it ships: the verified pack goes straight to Sigmora's publishing engine as a schedule." |
| 1:45–1:55 | Back to the top; the tagline | "Don't guess the culture. Query it. Tastemaker by Sigmora. It's open source, and it's live now." |

## Rules for the cut

- Keep it under 2:00. If it runs long, cut the presets segment first.
- Say no number that isn't on screen in that run. Don't quote the Culture Miss Rate unless `docs/benchmark.md` is a live measurement.
- If the Ship section says "sandbox", say "scheduled in the sandbox" rather than "posted". Show a real post only if it came from a real owner-signed run.
- End on the live URL and the repo URL as on-screen text.
