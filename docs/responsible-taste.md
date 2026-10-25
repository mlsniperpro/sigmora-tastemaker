# Responsible taste

- **Aggregate only.** Inputs are public catalog entities (artists, brands, shows, places), taste tags and demographic *buckets*. No person's data is collected, sent to Qloo or stored.
- **Audience-level claims.** Results are audience affinity ("people who love Tems over-index on…"), never "this user likes X".
- **Every number is sourced.** Each receipt names the Qloo requests behind its number, each Taste Map panel names its endpoint, and the trace lists every request with all its parameters. Requests carry no credentials and no user identifiers.
- **Labeled provenance.** Live, replayed (recorded) and simulated results are labeled in the trace, on every receipt, and in a source note on the first screen. Simulated numbers are placeholders and never appear in the README, benchmark or submission.
- **The model never holds secrets.** Qloo, LLM and Sigmora keys stay server-side; the model sees only aggregate taste data.
- **Honest benchmark.** The Culture Miss Rate uses the same pass bar the critic uses and says so. It is reported only from live runs with a real model.
